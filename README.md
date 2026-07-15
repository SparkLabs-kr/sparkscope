# SparkScope

스파크랩 커뮤니케이션 본부 전용 뉴스 모니터링·인사이트 시스템입니다.
외부 서비스(연 250만 원)를 대체하면서 본부 의사결정 인프라까지 함께 만듭니다.

매주 월·수·금 오전 9시 자동으로 다이제스트 메일이 임직원 전체(`all@sparklabs.co.kr`)에게 발송되고,
본부 임직원은 `/dashboard`에서 인사이트 차트와 검색·필터를 사용할 수 있습니다.

---

## 🚀 5단계 배포 가이드

기술 지식이 없어도 따라갈 수 있도록 작성했습니다. 각 단계가 막히면 Eunbit이 Claude에게 그대로 물어보세요.

### 1단계 — API 키와 계정 준비

이미 보유하고 계신 것:
- ✅ Anthropic Claude API 키
- ✅ Vercel 계정
- ✅ Resend 계정

추가로 해야 할 것:
- Resend에서 `sparklabs.co.kr` 도메인을 인증해야 메일 발신이 가능합니다 (Resend Dashboard → Domains → Add Domain → DNS 레코드 3건 등록).
- (옵션) Vercel Postgres 데이터베이스 1개 생성 (Storage → Create Database → Postgres)

### 2단계 — GitHub에 코드 올리기

이 폴더(`sparkscope/`)를 GitHub 새 레포로 푸시합니다. 깃 명령어를 모르시면 GitHub Desktop 앱으로도 가능합니다.

```bash
cd sparkscope
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/sparklabs-org/sparkscope.git
git push -u origin main
```

### 3단계 — Vercel에 배포

1. [vercel.com/new](https://vercel.com/new) → "Import Git Repository" → 방금 푸시한 sparkscope 레포 선택
2. **Root Directory**를 비워두고 (기본값) Framework Preset은 자동으로 Next.js 잡힙니다
3. **Add Environment Variables**에서 아래 값들을 채워 넣습니다:

| 변수명 | 값 | 어디서 |
|-------|-----|--------|
| `DATABASE_URL` | `postgresql://user:password@host/db` | Vercel Storage → 만든 Postgres → Connection String |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Anthropic Console |
| `RESEND_API_KEY` | `re_...` | Resend Dashboard |
| `DIGEST_FROM_EMAIL` | `sparkscope@sparklabs.co.kr` | (직접 입력) |
| `DIGEST_TO_GROUP` | `all@sparklabs.co.kr` | (직접 입력) |
| `DIGEST_TEST_RECIPIENT` | `mido.jang@gmail.com` | 시범 운영 중 본인 메일만 받게 |
| `CRON_SECRET` | (랜덤 32자 문자열) | https://generate-secret.vercel.app/32 에서 생성 |
| `NEXTAUTH_URL` | `https://sparkscope.vercel.app` | 배포 후 자동 부여되는 URL |
| `NEXTAUTH_SECRET` | (랜덤 32자 문자열) | 위와 마찬가지로 생성 |
| `ALLOWED_EMAIL_DOMAIN` | `sparklabs.co.kr` | (직접 입력) |

4. "Deploy" 버튼 클릭 → 1~2분 대기

### 4단계 — DB 초기화 및 키워드 시드

배포가 완료되면 한 번 데이터베이스를 초기화해야 합니다. Vercel CLI 또는 Vercel 대시보드의 "Functions" 콘솔에서:

```bash
# 로컬에서 실행 (.env.local에 위 환경변수 동일하게 입력 후)
npm install
npx prisma db push
npm run db:seed
```

이 명령으로 DB에 235개 모니터링 키워드(포트폴리오사 186, 스파크랩 엔티티 9, 임원진 3, 경쟁사 16, 업계 키워드 21)가 자동 등록됩니다.

### 5단계 — 첫 발송 테스트

배포된 URL에 접속해 테스트:

1. `https://sparkscope.vercel.app/dashboard` → 로그인 페이지로 자동 리다이렉트
2. `mido.jang@gmail.com` 으로 로그인 (시범 운영 단계에서 본인 메일도 허용됨)
3. 받은 매직 링크를 클릭하면 대시보드 진입 (이 시점엔 데이터가 비어있음)
4. 첫 다이제스트를 즉시 생성하려면 다음 URL을 브라우저에서 호출:
   ```
   https://sparkscope.vercel.app/api/cron/daily-digest
   ```
   단, `Authorization: Bearer <CRON_SECRET>` 헤더가 필요합니다. 가장 쉬운 방법은 [reqbin.com](https://reqbin.com) 같은 도구로 호출하는 것입니다.
5. 1~2분 후 본인 메일함에 다이제스트 도착 확인 → 대시보드에 데이터 표시 확인

이후엔 Vercel Cron이 매주 월·수·금 오전 9시(KST)에 자동 실행합니다.

---

## 📦 무엇이 들어 있는가

```
sparkscope/
├── prisma/
│   ├── schema.prisma         # DB 스키마 (User, Article, Digest, MonitoringTarget...)
│   └── seed.ts               # 키워드 235개 시드
├── data/
│   └── master-keywords.json  # 마스터 시트에서 자동 추출한 키워드
├── src/
│   ├── app/
│   │   ├── page.tsx          # 랜딩 페이지
│   │   ├── login/page.tsx    # 매직 링크 로그인
│   │   ├── dashboard/        # 본부 인사이트 대시보드
│   │   └── api/
│   │       ├── cron/daily-digest/  # 정기(월·수·금) 자동 실행되는 파이프라인
│   │       ├── articles/           # 대시보드용 데이터 API
│   │       └── auth/[...nextauth]/ # NextAuth 매직 링크
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── auth.ts           # NextAuth 설정 + 도메인 화이트리스트
│   │   └── sparkscope/
│   │       ├── collector.ts  # Google News RSS 수집
│   │       ├── analyzer.ts   # Claude Haiku + Sonnet 분석
│   │       ├── digest.ts     # 다이제스트 데이터·HTML 생성
│   │       ├── mailer.ts     # Resend 발송
│   │       ├── runner.ts     # 전체 파이프라인 오케스트레이션
│   │       ├── prompts.ts    # Claude 프롬프트
│   │       └── types.ts
│   └── components/           # 차트·테이블 React 컴포넌트
├── scripts/
│   └── run-digest.ts         # npm run digest:run 으로 수동 실행
├── vercel.json               # 매주 월·수·금 23:30 UTC (= 08:30 KST) Cron
├── package.json
└── README.md
```

---

## 🔐 보안: Pre-commit 훅 (Gitleaks)

### 개요
이 저장소는 API 키, 토큰, 비밀번호 같은 민감한 정보가 실수로 커밋되는 것을 방지하기 위해 **gitleaks** pre-commit 훅을 사용합니다.

### 인턴들이 클론 후 해야 할 일

```bash
cd sparkscope
npm install    # → prepare 스크립트가 자동으로 husky를 활성화합니다
```

**그게 전부입니다.** 이제 커밋할 때마다 자동으로 시크릿 검사가 실행됩니다.

### 커밋할 때 어떻게 되는가

```bash
git commit -m "메시지"

# 자동으로 실행됨 ↓
# 🔐 API 키·토큰·시크릿 검사 중...
# ✅ 보안 검사 통과

# 만약 민감한 정보가 포함되면:
# ❌ 검사 실패: 커밋에 민감한 정보가 포함되어 있습니다.
#    - 파일에서 API 키, 토큰, 비밀번호를 제거한 후 다시 시도하세요.
```

### 거짓 양성 (False Positive) 처리

테스트나 예시 데이터에서 실수로 패턴이 감지된 경우:

1. 거짓 양성을 발견했으면, 커밋 시 오류 메시지에서 hash를 확인합니다
2. `.gitleaksignore` 파일에 그 hash를 추가합니다:

```
# .gitleaksignore
sha256:abcd1234...
```

3. 다시 커밋하면 통과합니다

### 긴급: 훅 우회가 필요한 경우 (권장하지 않음)

```bash
git commit --no-verify -m "메시지"  # ⚠️ 가능한 피하세요
```

검사를 우회하지 않고 파일을 수정하는 것이 안전합니다.

---

## 🛠 자주 하는 작업

### 키워드 추가/수정
1. `data/master-keywords.json`을 직접 편집 (또는 마스터 Excel 시트 → Eunbit이 Claude에게 변환 부탁)
2. `npm run db:seed` 실행 (upsert 방식이라 안전)

### 다이제스트 양식 수정
`src/lib/sparkscope/digest.ts`의 `EMAIL_CSS` 또는 렌더 함수 수정 → 재배포

### 발송 시각 변경
`vercel.json`의 cron 스케줄 수정 (`30 23 * * 0,2,4` = UTC 23:30, 일·화·목 = KST 08:30, 월·수·금)

### 시범 운영 → 정식 운영 전환
`DIGEST_TEST_RECIPIENT` 환경변수를 비우거나 삭제. 그러면 자동으로 `DIGEST_TO_GROUP`(`all@sparklabs.co.kr`)으로 발송됩니다.

---

## 🔍 동작 원리 한눈에

```
월·수·금 23:30 UTC (08:30 KST)
   ↓
Vercel Cron → /api/cron/daily-digest
   ↓
collector.ts: 마스터 시트 키워드로 Google News RSS 호출 → 중복 제거
   ↓
analyzer.ts: Claude Haiku 1차 분류 (전체) → Sonnet 심층 분석 (중요 기사만)
   ↓
DB 저장 (Article 테이블)
   ↓
digest.ts: 카테고리별 정리 + Sonnet으로 편집자 한 줄 생성 → HTML 빌드
   ↓
mailer.ts: Resend로 발송
   ↓
대시보드(/dashboard)는 같은 DB에서 실시간으로 차트 그림
```

---

## 💰 운영 비용 (월간 예상)

| 항목 | 예상 |
|------|------|
| Anthropic Claude API | 5~10만 원 |
| Vercel (Pro 플랜) | 사용 중인 sparklabs-web과 동일 |
| Vercel Postgres | 0~3만 원 |
| Resend | 0원 (무료 한도 내) |
| **합계** | **5~13만 원/월** |

기존 외부 서비스 연 250만 원 대비 **연 60~150만 원 (38~76% 절감)**.

---

## 🆘 문제 해결

**"메일이 안 와요"**
- Resend Dashboard → Logs에서 발송 시도 확인
- `DIGEST_FROM_EMAIL`의 도메인이 Resend에 인증됐는지 확인
- 스팸함 확인

**"대시보드에 데이터가 없어요"**
- 첫 발송 후 데이터가 채워집니다. `/api/cron/daily-digest`를 한 번 수동 호출하세요.

**"Claude API 비용이 너무 많이 나와요"**
- `src/lib/sparkscope/collector.ts`의 `maxKeywordsPerCategory`를 줄이세요 (기본 30 → 15).
- Anthropic Console에서 월 예산 알림 설정.

**"키워드가 노이즈를 너무 많이 잡아요"**
- 마스터 시트에 `helperKeywords`(보조 키워드)를 추가하세요. (예: "비트바이트" → "PlayKeyboard")

---

## 📚 관련 문서

- `../01_뉴스모니터링_시스템_청사진.md` — 시스템 설계 v0.2
- `../06_Claude_분석_프롬프트_v0.1.md` — 프롬프트 상세 설계
- `../07_Newsral_벤치마크_분석.md` — 외부 서비스 비교 분석
- `../11_프로덕션_핸드오프_문서.md` — 기술 핸드오프

---

**버전**: v0.1
**마지막 업데이트**: 2026-05-11
**오너**: Eunbit (스파크랩 커뮤니케이션 본부)
