# ─────────────────────────────────────────────────────────────
# Windows 스케줄된 작업용 Batch 재분류 시작 스크립트
# PowerShell BOM 필수 (한글 출력용)
# ─────────────────────────────────────────────────────────────
# 사용: PowerShell -ExecutionPolicy Bypass -File scripts/start-batch-reclassify.ps1
#
# Windows 작업 스케줄러 설정:
#   - 트리거: 매일 오후 11:00 (23:00)
#   - 동작: PowerShell -ExecutionPolicy Bypass -File C:\...\start-batch-reclassify.ps1
#   - 계정: (사용자 계정)
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$LogDir = Join-Path $ProjectRoot "logs"
$TimestampLog = Join-Path $LogDir "batch-reclassify-runs.log"

# 로그 디렉토리 생성
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# 시작 로그 기록
$StartTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"$StartTime | 🚀 배치 재분류 시작" | Out-File $TimestampLog -Append -Encoding UTF8

try {
    Push-Location $ProjectRoot

    # tsx 스크립트 실행 (환경 변수는 .env.local에서 자동 로드)
    Write-Host "🔄 배치 재분류 스크립트 실행 중..."
    & npx tsx ./scripts/_batch-reclassify.ts

    $ExitCode = $LASTEXITCODE
    $EndTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    if ($ExitCode -eq 0) {
        "✅ $EndTime | 배치 재분류 완료 (성공)" | Out-File $TimestampLog -Append -Encoding UTF8
    } else {
        "❌ $EndTime | 배치 재분류 실패 (종료코드: $ExitCode)" | Out-File $TimestampLog -Append -Encoding UTF8
        exit $ExitCode
    }
}
catch {
    $ErrorTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "❌ $ErrorTime | 에러: $($_.Exception.Message)" | Out-File $TimestampLog -Append -Encoding UTF8
    exit 1
}
finally {
    Pop-Location
}
