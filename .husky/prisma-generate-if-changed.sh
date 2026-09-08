#!/bin/sh
# prisma/schema.prisma가 바뀌었으면 Prisma 클라이언트를 다시 생성한다.
#
# 왜 필요한가:
#   생성된 클라이언트(node_modules/@prisma/client)는 git에 없다. 그래서 스키마에 모델이
#   추가된 커밋을 pull 하면, 코드는 새 모델을 쓰는데 클라이언트는 옛것이라
#   `prisma.<model> is undefined`로 화면이 죽는다.
#   (2026-09-08 SynergyPair, 그 전에도 NoiseSuggestion·NoiseReportRequest에서 같은 일이 반복됨)
#
# 사용: prisma-generate-if-changed.sh <이전 ref> <이후 ref>
#
# 실패해도 0으로 끝낸다 — pull/checkout 자체를 막을 이유가 없고, 막으면 오히려
# "왜 pull이 안 되냐"로 더 헤맨다. 안내만 남기고 사람이 직접 돌리게 한다.

from="$1"
to="$2"
[ -z "$from" ] || [ -z "$to" ] && exit 0

# ref가 유효하지 않으면(얕은 clone 등) 조용히 넘어간다
git rev-parse --verify --quiet "$from" >/dev/null 2>&1 || exit 0
git rev-parse --verify --quiet "$to" >/dev/null 2>&1 || exit 0

changed=$(git diff --name-only "$from" "$to" 2>/dev/null)
echo "$changed" | grep -q '^prisma/schema.prisma$' || exit 0

echo "🔧 [prisma] schema.prisma가 변경됐습니다 — Prisma 클라이언트를 다시 생성합니다..."
if npx prisma generate >/tmp/sparkscope-prisma-generate.log 2>&1; then
  echo "✅ [prisma] 클라이언트 재생성 완료 (개발 서버가 켜져 있으면 재시작하세요)"
else
  echo "⚠️  [prisma] 재생성 실패 — 직접 'npx prisma generate'를 실행하세요"
  tail -20 /tmp/sparkscope-prisma-generate.log
fi
exit 0
