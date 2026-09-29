/**
 * 브리핑을 만들기 전에 오늘 수집이 끝나길 기다린다(daily-briefing.yml).
 * 영상은 수집 결과로 만들기 때문에, 수집 도중에 만들면 그날 기사가 빠진다.
 *
 * 다만 9시 발송이 우선이다 — 마감(KST 09:05)까지 안 끝나면 기다림을 멈추고 있는 데이터로 만든다
 * (렌더링 ~1분, 늦어도 9:30 전 게시).
 */
import { prisma } from '../src/lib/prisma';

const DEADLINE_KST = { h: 9, m: 5 };

function kstNow() { return new Date(Date.now() + 9 * 3600e3); }

(async () => {
  for (;;) {
    const k = kstNow();
    const todayStartUtc = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600e3);
    const running = await prisma.runLog.count({
      where: { runType: 'daily-collect', status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 3 * 3600e3) } },
    });
    const doneToday = await prisma.runLog.count({
      where: { runType: 'daily-collect', status: 'SUCCESS', startedAt: { gte: todayStartUtc } },
    });
    const pastDeadline = k.getUTCHours() * 60 + k.getUTCMinutes() >= DEADLINE_KST.h * 60 + DEADLINE_KST.m;
    if (running === 0 && doneToday > 0) { console.log('오늘 수집 완료 — 브리핑 제작 시작'); break; }
    if (pastDeadline) { console.warn(`마감 시각 지남(수집 진행 ${running}, 완료 ${doneToday}) — 있는 데이터로 제작`); break; }
    console.log(`${k.toISOString().slice(11, 16)} KST 수집 대기 중(진행 ${running}, 오늘 완료 ${doneToday})`);
    await new Promise(r => setTimeout(r, 60_000));
  }
  await prisma.$disconnect();
})();
