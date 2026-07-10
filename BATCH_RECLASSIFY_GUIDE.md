# 슈퍼베이스 배치 재분류 가이드 (26,049건)

## 📋 개요
- **목표**: Haiku 1차 분류로 26,049건 기사 자동 재분류
- **비용**: Batch API 사용으로 50% 절감
- **실행 방식**: 무인 자동화 (PC 꺼져도 이어받기 가능)
- **예상 소요 시간**: 2~4시간 (Batch API 처리 시간)

---

## 🚀 빠른 시작

### 옵션 1: 즉시 실행 (지금 밤에)
```powershell
# PowerShell에서 실행
cd C:\Users\장이수_PC\Desktop\sparkscope-work
npx tsx ./scripts/_batch-reclassify.ts
```

**진행 상황:**
- 터미널에 실시간 로그 출력
- Ctrl+C로 언제든 중단 가능 (배치는 계속 실행 중)
- PC 꺼져도 배치는 클라우드에서 처리 중

### 옵션 2: 자동 스케줄 (매일 밤 11시)
Windows 작업 스케줄러에서 설정:

**단계:**
1. `Win+R` → `taskschd.msc` 입력 → Enter
2. "작업 스케줄러"에서 **작업 만들기**
3. **일반 탭:**
   - 이름: `SparkScope 배치 재분류`
   - 설명: `Haiku 1차 분류 26,049건`
   - ☑️ 컴퓨터를 켜는 경우 작업 실행
   - ☑️ 사용자가 로그인했는지 여부에 관계없이 실행

4. **트리거 탭:**
   - 새로 만들기 → **매일**
   - 시간: `23:00` (밤 11시)
   - 반복: `매일 1일`

5. **동작 탭:**
   - 프로그램/스크립트: `PowerShell`
   - 인수 추가:
     ```
     -ExecutionPolicy Bypass -File C:\Users\장이수_PC\Desktop\sparkscope-work\scripts\start-batch-reclassify.ps1
     ```
   - 시작 위치:
     ```
     C:\Users\장이수_PC\Desktop\sparkscope-work
     ```

6. **설정 탭:**
   - ☑️ 작업이 이미 실행 중인 경우 새 인스턴스를 시작하지 않음

7. **확인** → 저장

---

## 📊 실행 흐름

```
[드라이런 20건]
    ↓
  20건 검증 (오류 확인)
    ↓
  이상 없으면 → [메인 배치 26,049건]
                      ↓
                   배치 ID 출력
                      ↓
                   15초마다 상태 확인 (폴링)
                      ↓
                   완료 (1~4시간)
                      ↓
                   [결과 처리]
                      ├─ 신뢰도 75% 이상 + 안전 ✅ 자동 적용
                      ├─ 신뢰도 낮음 / 톤 급변 / 새 부정 ⚠️ 검토 대기
                      └─ 파싱 에러 ❌ 에러 로그
                      ↓
                   로그 & CSV 기록
```

---

## 📁 출력 파일

| 파일 | 위치 | 용도 |
|------|------|------|
| **전체 로그** | `logs/reclassify-2026-07-10.log` | 배치 진행 상황, 배치 ID, 결과 |
| **검토 대기 목록** | `logs/needs-review-2026-07-10.csv` | 아침에 직접 확인할 기사 |
| **배치 상태** | `logs/.batch-reclassify-2026-07-10.json` | Resume용 내부 파일 |

### 로그 파일 읽기
```powershell
# 로그 보기 (실시간)
Get-Content "logs/reclassify-2026-07-10.log" -Wait

# 검토 대기 CSV 보기
Import-Csv "logs/needs-review-2026-07-10.csv" | Format-Table
```

---

## 🔄 PC 꺼진 경우 이어받기

**배치가 진행 중이었다면:**
```powershell
cd C:\Users\장이수_PC\Desktop\sparkscope-work
npx tsx ./scripts/_batch-reclassify.ts --resume
```

**동작:**
1. 이전 배치 ID 확인
2. 배치 상태 폴링 재개
3. 결과 처리 계속

**로그 확인:**
```powershell
tail -f logs/reclassify-*.log
```

---

## ✅ 안전 장치

### 자동 적용 조건
- ✅ AI 신뢰도 75% 이상
- ✅ 새로 부정이 아님 (임팩터스형 오탐 방지)
- ✅ 톤이 극단적으로 뒤집히지 않음 (긍정↔부정)
- ✅ 파싱/API 에러 없음

### 검토 대기 (아침에 수동 확인)
| 사유 | 예시 |
|------|------|
| 신뢰도 낮음 | 75% 미만 |
| 톤 급변 | POSITIVE → NEGATIVE |
| 새 부정 판정 | 임팩터스 교육 협력 → 부정 오탐 위험 |
| 노이즈 | 정치, 센터/기관 협력 |
| 파싱 에러 | API 응답 오류 |

---

## 🛠️ 문제 해결

### 배치가 실패했을 때
```powershell
# 로그 마지막 확인
tail logs/reclassify-*.log -n 20

# 배치 상태 파일 확인
cat logs/.batch-reclassify-2026-07-10.json | ConvertFrom-Json | fl
```

### API 키 문제
```powershell
# .env.local 확인
cat .env.local | Select-String "ANTHROPIC_API_KEY"
```

### 배치 API 오류 코드
- `400`: 요청 형식 오류 (스크립트 버그)
- `401`: API 키 무효
- `429`: Rate limit (대기 후 재시도)
- `500`: Anthropic 서버 오류 (resume 후 재시도)

---

## 📈 비용 계산

### 비용 절감 효과
**Haiku 1차분류 26,049건:**
- 일반 API (동기): `$0.80 + $0.40` × 26,049회 ≈ **$31,259**
- Batch API (비동기): **$0.80 + $0.40** × 0.5 ≈ **$15,629** ✅ 50% 절감

**Sonnet 심층분석은 기존 값 유지** (비용 증가 없음)

---

## 📝 아침 체크리스트

1. **로그 파일 확인**
   ```powershell
   cat logs/reclassify-2026-07-10.log | tail -50
   ```

2. **검토 대기 목록 확인**
   ```powershell
   Import-Csv logs/needs-review-2026-07-10.csv | ft -AutoSize
   ```

3. **결과 요약 확인**
   - 자동 적용: ○○○건
   - 검토 대기: ○○○건
   - 에러: ○건

4. **검토 대기 기사 수동 승인**
   - 임팩터스 교육 협력 → NEUTRAL로 수정
   - 기타 의심 케이스 검토

---

## 🔗 참고

- **분류 규칙**: `src/lib/sparkscope/prompts.ts`
- **위기 키워드**: `src/lib/sparkscope/crisis-keywords.ts`
- **정치 필터**: `src/lib/sparkscope/political-blocklist.ts`
- **배치 스크립트**: `scripts/_batch-reclassify.ts`
- **스케줄 시작**: `scripts/start-batch-reclassify.ps1`

---

**준비 완료! 이제 시작하셔도 됩니다. 🚀**
