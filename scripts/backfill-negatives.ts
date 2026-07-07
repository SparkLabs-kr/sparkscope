// 놓친 포폴사 부정기사 일회성 백필 (수집기 밖 전문지 → 수동 등록).
// ※ 근본 대책은 collector/relevance/analyzer 파이프라인 수정으로 자동화됨. 이건 과거분 보정용.
//   npx tsx scripts/backfill-negatives.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs'; import * as path from 'path';
for (const raw of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] = v;
}
const db = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_PRISMA_URL! } } });

const ROWS = [
  {
    link: 'https://www.kpanews.co.kr/news/articleView.html?idxno=538031',
    title: "'혁신인가, 규제 공백인가'...약올려 둘러싼 시각차",
    source: '약사공론', pubDate: new Date('2026-07-06T09:00:00+09:00'),
    matchedKeyword: '룩인사이트', category: 'portfolio_company',
    tone: 'NEGATIVE', riskFlag: 'controversy', importance: 'HIGH',
    oneLiner: '약올려, 의약품 유통 규제 형평성 논란에 직면', priorityScore: 85,
  },
  {
    link: 'https://www.bosa.co.kr/news/articleView.html?idxno=3007674',
    title: "의약품 유통 질서 파괴하는 약올려 '문제있다'",
    source: '의약뉴스', pubDate: new Date('2026-07-06T09:00:00+09:00'),
    matchedKeyword: '룩인사이트', category: 'portfolio_company',
    tone: 'NEGATIVE', riskFlag: 'controversy', importance: 'HIGH',
    oneLiner: '의약품유통협회, 약올려 유통질서 훼손 문제 제기', priorityScore: 85,
  },
];

(async () => {
  for (const r of ROWS) {
    await db.article.upsert({
      where: { link: r.link },
      create: { ...r, isNoise: false, noiseReason: null, analyzedAt: new Date() },
      update: { title: r.title, source: r.source, pubDate: r.pubDate, matchedKeyword: r.matchedKeyword, category: r.category, tone: r.tone, riskFlag: r.riskFlag, importance: r.importance, oneLiner: r.oneLiner, priorityScore: r.priorityScore, isNoise: false, noiseReason: null, analyzedAt: new Date() },
    });
    console.log(`  ✓ ${r.matchedKeyword} | ${r.title.slice(0, 40)} (${r.source})`);
  }
  console.log(`\n백필 ${ROWS.length}건 완료 (portfolio_company · NEGATIVE · isNoise=false)`);
  await db.$disconnect(); process.exit(0);
})();
