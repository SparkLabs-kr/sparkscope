# SparkScope — Claude 협업 규칙

## 🔒 Git 워크플로우

### 브랜치 정책

**이수(isujang-ctrl), 소윤:**
- ✅ main에서 직접 작업 및 커밋
- ❌ 브랜치 생성 불필요
- ✅ 모든 변경사항 직접 main에 푸시

**그 외 인턴:**
- ✅ main에 **직접 커밋 & 푸시 가능**
- ✅ 자신의 브랜치(leeryeong-Branch 등)에서 작업
- ✅ **자신의 브랜치 → Intern-Branch로 PR 생성** (자동 병합)
- ✅ Intern-Branch → main은 **직접 푸시 가능**
- ❌ 다른 사람의 브랜치로 push 금지
- ❌ force push 절대 금지
- ❌ main에서 직접 작업 금지 (반드시 자신의 브랜치에서 PR로)

### 원격 저장소 — `SparkLabs-kr/sparkscope` 한 곳

운영 저장소는 `SparkLabs-kr/sparkscope`(remote 이름 `origin`) **하나뿐**이다.

- ✅ "main에 푸시"는 `git push origin main` 하나로 끝난다. fast-forward로만 진행한다(`--force` 금지).
  > 2026-08-06~08-07, 한때 `Sparklabs-AI-Org/SparkScope`로 이전했다가 두 저장소가 서로 갈라져
  > (양쪽에 상대에 없는 커밋이 쌓임) 매번 merge해서 양쪽에 푸시해야 했다. 2026-08-07에 두 저장소를
  > 완전히 동기화한 뒤 AI-Org 저장소를 삭제하고 SparkLabs-kr로 일원화함. 옛 문서·메모에 "두 곳에
  > 동시 푸시" 규칙이 남아 있으면 그건 더 이상 유효하지 않다.

### 브랜치 네이밍
- 개인 작업: `이수브랜치` (담당자가 이수일 때)
- 협업 기능: `feature/기능명` 또는 `fix/버그명`

### 커밋 메시지
- 한글 또는 영문 모두 가능
- 형식: `[type]: 설명`
  - `feat:` 새 기능
  - `fix:` 버그 수정
  - `docs:` 문서 변경
  - `refactor:` 코드 정리
  - `test:` 테스트 추가

---

## 📋 저장소 관리자

- **관리자**: 이수 (isujang-ctrl), 은빛 (eubit)
- **권한**: PR 승인, main 브랜치 병합

---

## ⏰ 크론 구조 (건드리기 전에 반드시 읽을 것)

### 현재 설정

**수집:**
- GitHub Actions: `.github/workflows/daily-collect.yml`
- 일정: 매일 06:13 KST (UTC 21:13) — 정각(0분)은 GitHub 전역 혼잡으로 매일 ~1시간씩 지연돼서 2026-08-05에 07:07로 이동했으나, 2026-08-06에 그마저도 지연(08:14 시작·09:08 종료)돼 발송 크론(09:00 KST) 전 완료를 보장하기 위해 06:13으로 재조정함. 기사 발행량이 06~11시에 집중돼(특히 08~10시 최고조) 이보다 더 이르게 당기면 그 물량을 놓치므로 이 정도가 절충선.
- 작업: 수집 → 분석 → DB 저장 → **대시보드 AI 요약 사전계산** (아래 참고)
- 엔드포인트: `GET /api/cron/daily-collect`

**발송:**
- Vercel Cron: `vercel.json`
- 일정: 월·수·금 09:00 KST (UTC 00:00)
- 작업: DB에 있는 것만 발송, 수집 안 함 (`skipCollect=true`)
- 엔드포인트: `GET /api/cron/daily-send-only`

### 규칙

- ✅ 발송 크론은 **수집하지 않는다**. 수집은 반드시 별도 크론이 담당한다.
- ✅ 같은 작업을 **Vercel과 GitHub Actions 양쪽에 만들지 않는다**.
  > 과거 `daily-digest-send.yml`이 Vercel 발송과 중복으로 돌다가 실패만 반복했고, 2026-07-16에 삭제함.
- ✅ 크론 작동 여부를 물을 땐 **추측하지 말고** `vercel.json`과 `.github/workflows/` 파일을 직접 읽고 답한다.

### 대시보드 AI 요약 사전계산 (`DashboardInsight` 테이블)

대시보드는 예전엔 탭을 클릭할 때마다 위기 원인·경쟁사 트렌드를 그 자리에서 AI로 다시 계산해서
느렸다(탭 하나 볼 때도 최대 20번 가까이 LLM 호출). 지금은 `daily-collect.yml` 끝에서
(`computeAndStoreDashboardInsights()`, [dashboard-insights.ts](src/lib/sparkscope/dashboard-insights.ts))
하루 1회 미리 계산해 `DashboardInsight`에 저장하고, 대시보드는 읽기만 한다. 다이제스트 메일이
이미 쓰던 "미리 계산 → 읽기만" 패턴을 대시보드에도 그대로 적용한 것.

- ✅ **요약 계산은 기본 하루 1회**(수집 직후)로 유지한다. 낮 시간대 추가 실행을 먼저 넣지 않는다.
  "위기 원인이 낮 동안 오래된 느낌"이라는 **실제 불만이 나오면 그때** 늘리는 것으로 충분하다 —
  처음부터 자주 돌려서 LLM 비용을 쓸 이유가 없다(2026-07-29 이수·소윤 합의).
- ✅ 숫자(위기 급증 여부·건수·기사 목록)는 항상 실시간 DB 조회이고, **이 사전계산의 영향을 받지
  않는다.** 사전계산 대상은 "원인 설명 문장"뿐이다(최대 24시간 지연).
- ✅ 화면에 뜨는 원인 요약은 출처를 항상 구분해서 보여준다 — AI가 실제로 분석한 건지
  (`🤖 AI 요약 · HH:MM 기준`), 아직 분석 전이라 키워드 매칭 기본 문구인지(`⚙️ 기본 요약`)를
  섞어서 보여주지 않는다.
- ✅ 그날 배치 자체가 실패했으면(RunLog `dashboard-insights` 성공 기록이 오늘 없음) 조용히
  예전처럼 그 자리에서 실시간 AI 호출로 자동 대체한다 — 화면은 평소와 동일하게 정상 작동하고,
  장애는 `RunLog`에만 남는다.

---

## 🚨 Pre-commit 보안 훅

이 저장소는 API 키, 토큰, 시크릿이 커밋되는 것을 자동으로 차단합니다.

```bash
npm install  # 자동으로 husky 활성화
git commit -m "메시지"  # 자동으로 보안 검사 실행
```

시크릿이 감지되면 커밋이 중단됩니다. 파일에서 민감한 정보를 제거 후 다시 시도하세요.

**우회가 필요한 경우** (권장하지 않음):
```bash
git commit --no-verify
```

---

## 🔑 키워드 마스터 시트 (data/master-keywords.json)

### 규칙

- ✅ `data/master-keywords.json`을 수정하면 **반드시 DB에도 반영**해야 한다. 파일만 고치고 커밋해도 실제 발송 서버가 쓰는 DB는 자동으로 바뀌지 않는다.
  - main에 push하면 `.github/workflows/sync-keywords.yml`이 자동으로 `/api/cron/seed-keywords`를 호출해 DB에 동기화한다.
  - 로컬에서 즉시 반영하고 싶으면 `npm run db:seed` 직접 실행.
  > 2026-07-27, 이 동기화가 누락된 채로 6회(7/13~7/27) 다이제스트가 발송돼 문맥어(contextWords) 필터가 실제로는 적용 안 된 상태로 나갔던 사고가 있었음. 동명이인·부분문자열 오탐(예: "노리"→"노리뜰점", "김유진"/"이한주" 동명이인) 5건 발생.
- ✅ `primaryKeyword`가 **짧거나(2자 이하) 흔한 단어/이름**이면 `contextWords`(문맥어)를 반드시 채운다. 비워두면 동명이인·부분문자열 기사가 그대로 통과한다.
  - 예: `노리` → `KnowRe, 김용재, 수학, 교육, 이러닝, 에듀테크, 학습`
  - 예: `김유진`, `이한주` 등 대표자명 → 회사명·직함 등 확실한 문맥어 필수

---

## 🌐 한국어 / 영어 (i18n)

화면 우측 상단 `KO | EN` 토글로 전환한다. 쿠키(`sparkscope-lang`) 하나를 서버·클라이언트가 같이
읽으므로, 서버 컴포넌트가 그린 문구까지 함께 바뀐다.

### 두 종류를 구분해서 다룬다

| 대상 | 담당 | 비고 |
|---|---|---|
| UI 문구(버튼·라벨·안내문) | `src/lib/i18n/en.ts` 사전 | 키가 **한국어 원문 그 자체**다 |
| 기사 제목·AI 문장 | `Article.titleEn` 등 번역 캐시 | `translate-content.ts`가 gpt-4o-mini로 채운다 |

- ✅ 새 UI 문구는 `t('한국어 원문')`으로 감싸고 `en.ts`에 영어를 추가한다. **사전에 없으면
  한국어가 그대로 나온다** — 빠뜨려도 화면이 깨지지 않지만, EN 화면에 한국어가 섞인다.
- ✅ 번역 대상이 아닌 것: 발송되는 다이제스트 메일 본문(수신자가 한국어 사용자다),
  LLM에 넘기는 프롬프트·검색어(DB와 감시 키워드가 한국어라 영어로 바꾸면 결과가 0건이 된다).
- ❌ `title`(한국어 원문)을 영어로 덮어쓰지 마라. 군집화(`cluster.ts`)와 노이즈 필터가
  한국어 제목을 기준으로 매칭하므로, 표시만 `titleEn`으로 하고 로직은 원문을 쓴다.
- ❌ `src/lib/inter-sample-data.ts`처럼 **클라이언트 컴포넌트도 import 하는 모듈**에서
  `translate-content.ts`를 import 하지 마라. OpenAI SDK가 클라이언트 번들로 딸려 들어가
  "Missing credentials"로 화면이 죽는다. 번역은 서버 라우트/페이지에서만 호출한다.

### 회사명·매체명

1순위는 `MonitoringTarget.englishName`이다. **이 컬럼은 수집 단계의 매칭 키로도 쓰이므로**
표시용으로 임의로 채우지 말고, 화면 표기만 필요하면 `en.ts` 사전에 넣는다.
반대로 영문명이 비어 EN 화면에 한국어로 뜨는 회사는 **키워드 관리 화면에서 영문명을 채우면**
사전보다 우선해서 바로 반영된다.

### 번역 캐시 채우기

- 새 기사는 수집 크론(`runner.ts` 4.56단계)이 하루 1회 자동으로 채운다.
- 수동/전체 백필: `npx tsx --env-file=.env.local scripts/backfill-title-en.ts`
  (`--inter`는 Inter 탭 판정·매칭 사유, `--limit N`·`--days N`으로 범위 제한)
  중간에 끊겨도 이미 채운 건 건너뛰므로 그냥 다시 실행하면 이어서 진행된다.
- 비어 있어도 조회 때 즉석 번역으로 채워지므로 화면은 정상 작동한다(첫 조회만 느려진다).

### 스키마 변경 시 주의

번역 캐시 컬럼은 `prisma/migrations/20260824_add_article_en_columns/migration.sql`로 추가했다.
**`prisma db push`를 쓰지 마라** — 프로덕션에 schema.prisma가 모르는 컬럼이 남아 있어(drift)
db push가 그것들을 DROP 하려 든다. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`를 직접 실행한다.

---

## 📚 관련 문서

- `README.md` — 배포 및 운영 가이드
- `gitleaks.toml` — 보안 검사 규칙
