/**
 * 브리핑을 만들기 전에 오늘 다이제스트 메일(10:30)이 나가길 기다린다(daily-briefing.yml).
 *
 * 브리핑은 그날 메일을 영상으로 옮긴 것이다 — 메일 발송이 헤드라인 스냅샷을 확정하고(runner.ts),
 * 영상은 그 스냅샷만 읽는다. 메일보다 먼저 만들면 메일과 다른 기사가 영상에 들어갈 수 있다.
 *
 * - 오늘 영상이 이미 있으면 skip=true(수동 재실행·예비 경로가 겹쳐도 두 번 만들지 않는다).
 *   수동 실행에서 다시 만들고 싶으면 FORCE=1.
 * - 마감(KST 11:10)까지 메일 기록이 없으면 기다림을 멈추고 있는 데이터로 만든다
 *   (11:15 잔디 최종 전송 전에 게시되게).
 * GITHUB_OUTPUT에 skip=true|false를 쓴다.
 */
import { appendFileSync } from 'fs';
import { prisma } from '../src/lib/prisma';
import { kstDateKey } from '../src/lib/sparkscope/briefing';

const DEADLINE_KST = { h: 11, m: 10 };

function out(skip: boolean) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
}

(async () => {
  const dateKey = kstDateKey();
  const video = await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: 'briefing_video', key: dateKey } } });
  if (video && process.env.FORCE !== '1') {
    console.log(`오늘(${dateKey}) 영상이 이미 있음 — 건너뜀`);
    out(true);
    return;
  }
  for (;;) {
    const k = new Date(Date.now() + 9 * 3600e3);
    const todayStartUtc = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600e3);
    const sent = await prisma.runLog.count({
      where: { runType: 'daily-send', status: 'SUCCESS', startedAt: { gte: todayStartUtc } },
    });
    if (sent > 0) { console.log('오늘 메일 발송 확인 — 브리핑 제작 시작'); break; }
    if (k.getUTCHours() * 60 + k.getUTCMinutes() >= DEADLINE_KST.h * 60 + DEADLINE_KST.m) {
      console.warn('마감 시각 지남(메일 발송 기록 없음) — 있는 데이터로 제작');
      break;
    }
    console.log(`${k.toISOString().slice(11, 16)} KST 메일 발송 대기 중`);
    await new Promise(r => setTimeout(r, 60_000));
  }
  out(false);
})().then(() => prisma.$disconnect()).catch(async e => {
  console.error('판단 실패 — 제작을 진행합니다:', e);
  out(false);
  await prisma.$disconnect();
});
