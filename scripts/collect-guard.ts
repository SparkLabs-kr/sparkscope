/**
 * 예비 schedule 수집을 돌릴지 판단한다(daily-collect.yml 첫 단계).
 *
 * 수집은 Vercel 크론이 05:50에 workflow_dispatch로 시작시킨다. 원래의 06:13 schedule은
 * 토큰이 빠졌거나 요청이 실패한 날을 위한 예비인데, GitHub이 그걸 2~3시간 늦게 실행하므로
 * 대부분의 날엔 이미 수집이 끝났거나 도는 중이다. 그때 또 돌면 같은 수집이 두 번 된다.
 *
 * 오늘(KST) 시작한 daily-collect가 성공했거나 아직 도는 중(3시간 이내)이면 skip=true.
 * GITHUB_OUTPUT에 skip=true|false를 쓴다.
 */
import { appendFileSync } from 'fs';
import { prisma } from '../src/lib/prisma';

(async () => {
  const now = Date.now();
  const kst = new Date(now + 9 * 3600e3);
  const todayStartUtc = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600e3);
  const runs = await prisma.runLog.findMany({
    where: { runType: 'daily-collect', startedAt: { gte: todayStartUtc } },
    select: { status: true, startedAt: true },
  });
  const busy = runs.some(r => r.status === 'SUCCESS'
    || (r.status === 'RUNNING' && now - r.startedAt.getTime() < 3 * 3600e3));
  console.log(`오늘 수집 기록 ${runs.length}건 → ${busy ? '이미 수집됨/진행 중 — 예비 실행 건너뜀' : '수집 필요'}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${busy}\n`);
  await prisma.$disconnect();
})().catch(e => {
  // 판단이 실패하면 수집을 돌린다 — 두 번 도는 것보다 안 도는 게 더 나쁘다.
  console.error('판단 실패 — 수집을 진행합니다:', e);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'skip=false\n');
});
