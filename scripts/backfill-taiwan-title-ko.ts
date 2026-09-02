/**
 * 대만 기사 제목의 한국어·영어 번역 캐시 백필.
 *
 * title은 원문 그대로라 대만 기사는 번체 중문이다. 한국어 화면은 titleKo,
 * 영문 화면은 titleEn을 본다(src/lib/sparkscope/article-title.ts).
 *
 * 원문이 한국어인 기사는 ensureArticleKo가 알아서 걸러내므로 국내 기사에는
 * 번역 호출이 일어나지 않는다. 이미 채워진 것은 건너뛰니 재실행해도 안전하다.
 *
 * 실행:
 *   npx tsx --env-file=.env.local scripts/backfill-taiwan-title-ko.ts
 */
import { prisma } from '../src/lib/prisma';
import { ensureArticleKo, ensureArticleEn } from '../src/lib/sparkscope/translate-content';
import { TAIWAN_CATEGORY } from '../src/lib/sparkscope/taiwan-collect';

const CHUNK = 40;

async function main() {
  for (;;) {
    const rows = await prisma.article.findMany({
      where: { category: TAIWAN_CATEGORY, OR: [{ titleKo: null }, { titleEn: null }] },
      orderBy: { pubDate: 'desc' },
      take: CHUNK,
      select: { id: true, title: true, titleKo: true, titleEn: true, oneLiner: true, oneLinerEn: true, pitchTopic: true, pitchTopicEn: true },
    });
    if (rows.length === 0) break;

    // 번역 전 상태를 기록해 둔다 — ensureArticle*은 넘긴 객체를 그 자리에서 고치기 때문에
    // 호출 뒤에는 "원래 비어 있었는지"를 알 수 없다.
    const before = new Map(rows.map(r => [r.id, { ko: !!r.titleKo, en: !!r.titleEn }]));

    await ensureArticleKo(rows, { max: CHUNK });
    await ensureArticleEn(rows, { max: CHUNK });

    // 이번 묶음에서 실제로 채운 건수. 남은 것이 "채울 수 없는 행"(원문이 영어라
    // 한국어로 옮길 것이 없는 제목 등)뿐이면 0이 되고, 그때 멈춰야 한다.
    // 이걸 "titleKo가 있는 행 수"로 세면 그런 행 하나 때문에 같은 묶음을 무한히 다시 집어온다.
    const filled = rows.filter(r => !before.get(r.id)?.ko && r.titleKo).length
      + rows.filter(r => !before.get(r.id)?.en && r.titleEn).length;
    console.log(`묶음 ${rows.length}건 → 이번에 채운 것 ${filled}건`);
    if (filled === 0) {
      console.log('더 채울 수 있는 기사가 없습니다 (남은 것은 번역 대상이 아닌 제목).');
      break;
    }
  }

  const left = await prisma.article.count({ where: { category: TAIWAN_CATEGORY, titleKo: null } });
  const leftEn = await prisma.article.count({ where: { category: TAIWAN_CATEGORY, titleEn: null } });
  console.log(`\n남은 것 — titleKo ${left}건 · titleEn ${leftEn}건`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
