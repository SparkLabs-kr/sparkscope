# 🚨 비상 발송 명령어 (수집 없이 발송만)

**상황:** 오전 9시에 크론이 실행되지 않은 경우

**현재 DB 상태:** 188건의 기사가 이미 저장되어 있음 (7/9~7/15)

---

## 비상 발송 명령어 (준비 완료)

```bash
# 1단계: 환경변수 설정
export VERCEL_URL="sparkscope-seven-theta.vercel.app"  # ← Vercel 프로젝트 URL 확인 필요
export CRON_SECRET="Ou3sfK4xpzlQM1wdCTtin9LRJyckmbeBNU8h2E5H"

# 2단계: 발송 API 호출 (수집 없이, 기존 188건만 발송)
curl -X GET \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://$VERCEL_URL/api/cron/daily-send-only"
```

---

## 실행 방법

**PowerShell에서:**
```powershell
$VERCEL_URL = "sparkscope-seven-theta.vercel.app"
$CRON_SECRET = "Ou3sfK4xpzlQM1wdCTtin9LRJyckmbeBNU8h2E5H"

$response = Invoke-WebRequest -Uri "https://$VERCEL_URL/api/cron/daily-send-only" `
  -Headers @{ "Authorization" = "Bearer $CRON_SECRET" } `
  -Method GET

$response.StatusCode
$response.Content
```

**Bash에서:**
```bash
export VERCEL_URL="sparkscope-seven-theta.vercel.app"
export CRON_SECRET="Ou3sfK4xpzlQM1wdCTtin9LRJyckmbeBNU8h2E5H"

curl -X GET \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://$VERCEL_URL/api/cron/daily-send-only"
```

---

## 동작 방식

1. `/api/cron/daily-send-only` 호출
2. `skipCollect: true` 모드로 실행
3. 이미 DB에 있는 188건(7/9~7/15) 중 최근 3일 분석된 기사 사용
4. 메일 발송
5. 다이제스트 기록 저장

---

## ⚠️ 주의사항

- **지금 실행하지 말 것** (오전 9시 크론이 있는데 중복 발송 위험)
- **오전 9시 후에만 사용** (크론 실패 확인 후)
- VERCEL_URL은 실제 프로젝트 URL로 교체 필요

---

## 확인 방법 (오전 9시 후)

DB에서 발송 기록 확인:
```bash
export POSTGRES_PRISMA_URL='...' && npx tsx << 'EOF'
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const today = await prisma.digest.findUnique({
  where: { date: new Date("2026-07-15").toDateString() }
});
console.log("발송 여부:", today?.sentAt ? "✅ 발송됨" : "❌ 미발송");
await prisma.$disconnect();
EOF
```
