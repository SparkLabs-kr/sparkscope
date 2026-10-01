/**
 * 브리핑 영상을 만들기 전에 재료가 준비되길 기다린다(daily-briefing.yml).
 *
 * - 월(위클리): 오늘 아침 수집이 끝나길 기다린다 — 일요일 기사는 월요일 아침 수집에서 들어온다.
 *   마감 09:25(그 뒤엔 있는 데이터로 만들어 09:45 잔디에 맞춘다).
 * - 수·금(데일리): 09:30 다이제스트 메일이 나가길 기다린다 — 메일 발송이 헤드라인을 확정하고(runner.ts)
 *   영상은 그걸 옮긴다. 마감 10:05(10:15 최종 잔디 전에 게시되게).
 *
 * 오늘 영상이 이미 있으면 skip=true(수동 재실행·예비 경로가 겹쳐도 두 번 만들지 않는다). 다시 만들려면 FORCE=1.
 * GITHUB_OUTPUT에 skip=true|false를 쓴다.
 */
import { appendFileSync } from 'fs';
import { prisma } from '../src/lib/prisma';
import { broadcastFor, kstDateKey } from '../src/lib/sparkscope/briefing';

function out(skip: boolean) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
}

(async () => {
  const dateKey = kstDateKey();
  const weekly = broadcastFor().program === 'weekly';
  const video = await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: 'briefing_video', key: dateKey } } });
  if (video && process.env.FORCE !== '1') {
    console.log(`오늘(${dateKey}) 영상이 이미 있음 — 건너뜀`);
    out(true);
    return;
  }
  const deadline = weekly ? 9 * 60 + 25 : 10 * 60 + 5;
  const what = weekly ? '오늘 수집 완료' : '오늘 메일 발송';
  for (;;) {
    const k = new Date(Date.now() + 9 * 3600e3);
    const todayStartUtc = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600e3);
    const ready = weekly
      ? (await prisma.runLog.count({ where: { runType: 'daily-collect', status: 'SUCCESS', startedAt: { gte: todayStartUtc } } })) > 0
        && (await prisma.runLog.count({ where: { runType: 'daily-collect', status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 3 * 3600e3) } } })) === 0
      : (await prisma.runLog.count({ where: { runType: 'daily-send', status: 'SUCCESS', startedAt: { gte: todayStartUtc } } })) > 0;
    if (ready) { console.log(`${what} 확인 — ${weekly ? '위클리' : '데일리'} 제작 시작`); break; }
    if (k.getUTCHours() * 60 + k.getUTCMinutes() >= deadline) {
      console.warn(`마감 시각 지남(${what} 기록 없음) — 있는 데이터로 제작`);
      break;
    }
    console.log(`${k.toISOString().slice(11, 16)} KST ${what} 대기 중`);
    await new Promise(r => setTimeout(r, 60_000));
  }
  out(false);
})().then(() => prisma.$disconnect()).catch(async e => {
  console.error('판단 실패 — 제작을 진행합니다:', e);
  out(false);
  await prisma.$disconnect();
});
