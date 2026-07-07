// 기존 기사 중 정치 차단 키워드 매칭분을 isNoise=true, noiseReason="정치"로 플래그(되돌리기 가능).
// 겸사겸사 최근 수집 기사 중복 제거 효과(전/후 건수)도 리포트.
//   npx tsx scripts/flag-political.ts            # 적용
//   npx tsx scripts/flag-political.ts --dry-run  # 미적용, 건수만
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs'; import * as path from 'path';
import { isPolitical, normalizeTitleKey } from '../src/lib/sparkscope/relevance';
for (const raw of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] = v;
}
const DRY = process.argv.includes('--dry-run');
const db = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_PRISMA_URL! } } });
(async () => {
  // 1) 정치 sync: (a) 더 이상 매칭 아닌 정치플래그 해제(오탐 되돌리기) (b) 새로 매칭되는 것 플래그
  const flagged = await db.article.findMany({ where: { noiseReason: '정치' }, select: { id: true, title: true } });
  const toUnflag = flagged.filter(a => !isPolitical(a.title)).map(a => a.id);
  const nonNoise = await db.article.findMany({ where: { isNoise: false }, select: { id: true, title: true } });
  const toFlagArr = nonNoise.filter(a => isPolitical(a.title));
  const toFlag = toFlagArr.map(a => a.id);
  console.log(`[정치] 현재 정치플래그 ${flagged.length}건 · 해제(오탐 되돌리기) ${toUnflag.length}건 · 신규 플래그 ${toFlag.length}건`);
  if (toFlagArr.length) console.log('  신규 플래그 샘플: ' + toFlagArr.slice(0, 6).map(a => a.title.slice(0, 30)).join(' / '));
  if (!DRY) {
    for (let i = 0; i < toUnflag.length; i += 500) await db.article.updateMany({ where: { id: { in: toUnflag.slice(i, i + 500) } }, data: { isNoise: false, noiseReason: null } });
    for (let i = 0; i < toFlag.length; i += 500) await db.article.updateMany({ where: { id: { in: toFlag.slice(i, i + 500) } }, data: { isNoise: true, noiseReason: '정치' } });
    console.log('  → 반영 완료 (해제+플래그)');
  } else {
    console.log('  (dry-run: 미적용)');
  }

  // 2) 중복 제거 효과: 최근 3개월 비노이즈 기사 기준
  const d90 = new Date(); d90.setMonth(d90.getMonth() - 3);
  const recent = await db.article.findMany({
    where: { isNoise: false, pubDate: { gte: d90 } },
    orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }],
    select: { title: true, link: true },
  });
  const seen = new Set<string>(); let kept = 0;
  for (const a of recent) {
    const tk = normalizeTitleKey(a.title); const lk = 'L:' + a.link;
    if ((tk && seen.has(tk)) || seen.has(lk)) continue;
    if (tk) seen.add(tk); seen.add(lk); kept++;
  }
  console.log(`\n[중복] 최근3개월 비노이즈 ${recent.length.toLocaleString()}건 → 중복 제거 후 ${kept.toLocaleString()}건 (접힌 중복 ${recent.length - kept}건)`);
  await db.$disconnect(); process.exit(0);
})();
