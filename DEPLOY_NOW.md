# 🚀 SparkScope 배포 — 오늘 미팅 전 완료

## ⚡ 미리 생성된 값 (복붙용)

```
CRON_SECRET
_sGfKmvyL6EQuoS22fYX8pix4tLmZap5wD797mGWLU4

NEXTAUTH_SECRET
tICXDMNekbPfr9pIDDIgcEuQX03/UILmRLX/kj7DdW8=
```

이 두 값은 미팅 끝나도 그대로 쓰니까 안전한 곳에 한 번 저장해두세요 (예: 비밀번호 매니저, 또는 Notion 메모).

---

## 📋 Vercel 환경변수 — 한 번에 복붙할 수 있는 형태

Vercel "Import Project" 화면의 **Environment Variables** 섹션에 그대로 붙여넣으세요.

```
DATABASE_URL=postgres://(Vercel Postgres 만든 후 자동 채워짐)
ANTHROPIC_API_KEY=sk-ant-(본인 키 입력)
RESEND_API_KEY=re_(본인 키 입력)
DIGEST_FROM_EMAIL=onboarding@resend.dev
DIGEST_TO_GROUP=all@sparklabs.co.kr
DIGEST_TEST_RECIPIENT=mido.jang@gmail.com
CRON_SECRET=_sGfKmvyL6EQuoS22fYX8pix4tLmZap5wD797mGWLU4
NEXTAUTH_URL=(배포 후 자동 부여되는 URL, 첫 배포 후 입력)
NEXTAUTH_SECRET=tICXDMNekbPfr9pIDDIgcEuQX03/UILmRLX/kj7DdW8=
ALLOWED_EMAIL_DOMAIN=sparklabs.co.kr
```

> **💡 시범 단계 팁**: `DIGEST_FROM_EMAIL`을 `onboarding@resend.dev`로 두면 Resend 도메인 인증 없이도 즉시 발송됩니다. 미팅 후 sparklabs.co.kr 도메인 인증 마치고 `sparkscope@sparklabs.co.kr`로 변경하면 됩니다.
>
> **💡 시범 단계 팁 2**: `DIGEST_TEST_RECIPIENT`이 채워져 있으면 그 주소로만 발송되고 `all@sparklabs.co.kr`로는 안 갑니다. 시범 끝나면 이 변수를 비우면 됩니다.

---

## 🪜 5단계 시연 가이드

### STEP 1 — GitHub 새 레포 만들기 (2분)

1. https://github.com/new 접속
2. Repository name: `sparkscope`
3. Private 선택 (Public 가능하지만 환경변수는 모두 .env에 있어 노출 위험은 없음)
4. **README, .gitignore, license는 추가하지 마세요** (충돌 방지)
5. "Create repository" 클릭
6. 다음 페이지에서 보이는 두 줄 명령어를 메모:
   ```
   git remote add origin https://github.com/<본인계정>/sparkscope.git
   git branch -M main
   git push -u origin main
   ```

### STEP 2 — 로컬에서 GitHub로 푸시 (3분)

Windows PowerShell 또는 cmd 열고:

```powershell
cd "C:\Users\ebjan\Desktop\01_스파크랩\클로드\스파크랩\sparkscope"

git init
git add -A
git commit -m "Initial commit"

# Step 1에서 메모한 git remote add 명령 실행
git remote add origin https://github.com/<본인계정>/sparkscope.git
git branch -M main
git push -u origin main
```

> 💡 git이 없으면: https://git-scm.com/download/win 에서 설치 (5분).
> 💡 더 쉬운 방법: GitHub Desktop 앱 (https://desktop.github.com) 에서 "Add existing repository" → sparkscope 폴더 선택 → "Publish repository"

### STEP 3 — Vercel에 Import (3분)

1. https://vercel.com/new 접속
2. 방금 만든 sparkscope 레포 옆 "Import" 클릭
3. **Configure Project** 화면에서:
   - Framework Preset: **Next.js** (자동 감지됨)
   - Root Directory: 그대로 `./`
4. **Environment Variables** 섹션 펼치고 위 표의 값 모두 입력
   - 단, `DATABASE_URL`과 `NEXTAUTH_URL`은 비워둠 (다음 단계에서 자동 채워짐)
5. "Deploy" 클릭 → 1차 빌드는 DB 없어서 실패할 수 있음. 정상.

### STEP 4 — Vercel Postgres 추가 (2분)

1. 방금 만든 프로젝트 → **Storage** 탭
2. "Create Database" → **Postgres** 선택
3. 이름: `sparkscope-db`, 지역: Seoul 또는 Singapore
4. 생성되면 **Connect Project**에서 sparkscope 선택 → 자동으로 `DATABASE_URL` 환경변수 추가됨

### STEP 5 — DB 초기화 + 첫 발송 테스트 (5분)

1. 본인 컴퓨터에서:
   ```powershell
   cd "C:\Users\ebjan\Desktop\01_스파크랩\클로드\스파크랩\sparkscope"

   # .env.local 파일 만들고 위 환경변수 + DATABASE_URL(Vercel에서 복사) 입력
   # DATABASE_URL은 Vercel Storage → 만든 DB → ".env.local" 탭에서 복사
   notepad .env.local

   # 패키지 설치
   npm install

   # DB 테이블 생성
   npx prisma db push

   # 키워드 235개 시드
   npm run db:seed
   ```

2. Vercel 대시보드의 본인 sparkscope 프로젝트 URL을 `NEXTAUTH_URL` 환경변수에 입력 → Settings → Environment Variables → 추가/수정 → "Redeploy"

3. 첫 다이제스트 수동 호출:
   - 브라우저에서 https://reqbin.com/ 열기
   - URL: `https://(본인-vercel-url)/api/cron/daily-digest`
   - Method: GET
   - Headers: `Authorization: Bearer _sGfKmvyL6EQuoS22fYX8pix4tLmZap5wD797mGWLU4`
   - Send → 1~2분 대기

4. mido.jang@gmail.com 메일함에서 다이제스트 도착 확인 ✅

5. https://(본인-vercel-url)/dashboard 접속 → 매직 링크로 로그인 → 실시간 데이터 차트 확인 ✅

---

## 🎤 미팅에서 보여줄 것

✅ **GitHub 레포** — github.com/(본인)/sparkscope (실제 코드)
✅ **Vercel 배포 URL** — sparkscope.vercel.app (실제 작동)
✅ **메일** — 본인 받은편지함의 자동 발송된 다이제스트
✅ **대시보드** — /dashboard 경로의 실시간 인사이트

거기에 더해 보조 자료:
- `05_다이제스트_메일_시안_v0.2.html` — 디자인 비교
- `08_본부_대시보드_시안.html` — 인사이트 가치 설명
- `07_Newsral_벤치마크_분석.md` — 왜 이걸 만들었나
- `01_뉴스모니터링_시스템_청사진.md` v0.2 — 전체 구조

---

## 🆘 막히면

- "git이 무슨 명령인지 모르겠어요" → GitHub Desktop 사용 권장 (5분 학습)
- "Vercel에서 빌드 에러가 나요" → 보통 환경변수 누락. Vercel Dashboard → Deployments → 실패한 빌드 → Logs 보고 누락 변수 추가
- "메일이 안 와요" → Resend Dashboard → Logs에서 발송 시도 확인. `DIGEST_FROM_EMAIL`이 `onboarding@resend.dev`인지 확인

이 가이드 따라가다 막히면 Claude에게 화면 보여주면서 물어보세요.
