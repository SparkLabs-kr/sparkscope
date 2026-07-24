/**
 * 과거 기사 노이즈 소급 재분류 — B/C 티어 포폴사 + 스파크랩 대표자명(김유진·김호민·이한주)
 * 본문을 링크로 재스크래핑해서 contextWords/excludeWords 체크 후 isNoise=true 처리.
 *
 * 드라이런(기본): 몇 건이 노이즈로 분류될지 + 샘플 출력만.
 * 적용: APPLY=1 npx tsx scripts/retroactive-noise-filter.ts
 */
import { PrismaClient } from '@prisma/client';
import { scrapeArticleBody } from '../src/lib/sparkscope/scraper';
import { resolveGoogleNewsUrl } from '../src/lib/sparkscope/google-news-resolver';
import { filterReason } from '../src/lib/sparkscope/relevance';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === '1';
const CONCURRENCY = 4;
const SCRAPE_DELAY_MS = 300;

const SPARKLABS_PERSONS = new Set(['김유진', '김호민', '이한주']);

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function splitCsv(s?: string | null): string[] {
  return (s ?? '').split(',').map(x => x.trim()).filter(Boolean);
}

async function scrapeBody(link: string): Promise<{ text: string; success: boolean }> {
  try {
    if (link.includes('news.google.com')) {
      const resolved = await resolveGoogleNewsUrl(link);
      if (resolved) {
        const body = await scrapeArticleBody(resolved);
        if (body) return { text: body.text, success: true };
      }
      return { text: '', success: false };
    }
    const body = await scrapeArticleBody(link);
    if (body?.text) return { text: body.text, success: true };
    return { text: '', success: false };
  } catch {
    return { text: '', success: false };
  }
}

async function main() {
  // 1) B/C 티어 포폴사 + 스파크랩 대표자명 MonitoringTarget 조회
  const targets = await prisma.monitoringTarget.findMany({
    where: {
      OR: [
        { category: 'portfolio_company', tier: { in: ['B', 'C'] } },
        { category: 'sparklabs_self', primaryKeyword: { in: [...SPARKLABS_PERSONS] } },
      ],
    },
    select: {
      primaryKeyword: true,
      name: true,
      englishName: true,
      helperKeywords: true,
      excludeWords: true,
      contextWords: true,
      tier: true,
      category: true,
    },
  });

  const byKw = new Map(targets.map(t => [t.primaryKeyword, t]));
  const targetKws = [...byKw.keys()];
  console.log(`대상 키워드: ${targetKws.length}개 (B/C 티어 포폴사 + 대표자명)`);

  // 2) 해당 키워드로 수집된 기사 중 isNoise=false인 것만 조회
  const articles = await prisma.article.findMany({
    where: {
      matchedKeyword: { in: targetKws },
      isNoise: false,
      link: { startsWith: 'http' },
    },
    select: { id: true, title: true, link: true, matchedKeyword: true, source: true },
  });
  console.log(`검사 대상 기사: ${articles.length}건\n`);
  console.log('=== 전체 검사 대상 기사 목록 ===');
  articles.forEach((a, i) => console.log(`${i + 1}. [${a.matchedKeyword}] ${a.title}`));
  console.log('');

  // 3) 본문 스크래핑 + 필터 체크 (배치 처리)
  const toNoise: { id: string; title: string; keyword: string; reason: string; bodyOk: boolean }[] = [];
  let done = 0;
  let scrapeOk = 0;
  let scrapeFail = 0;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async a => {
      const target = byKw.get(a.matchedKeyword);
      if (!target) return null;

      const { text: bodyText, success: bodySuccess } = await scrapeBody(a.link);
      if (bodySuccess) scrapeOk++; else scrapeFail++;

      const reason = filterReason({
        title: a.title,
        body: bodyText || undefined,
        primaryKeyword: a.matchedKeyword,
        name: target.name,
        englishName: target.englishName,
        helperKeywords: target.helperKeywords,
        excludeWords: target.excludeWords,
        contextWords: target.contextWords,
        category: target.category,
        link: a.link,
        source: a.source,
      });

      // C 티어 추가 체크: contextWords도 없고 폴백키워드도 없으면 노이즈
      if (!reason && target.tier === 'C') {
        const mustCtx = splitCsv(target.contextWords);
        const combined = a.title + ' ' + bodyText;
        if (mustCtx.length === 0 || !mustCtx.some(w => combined.includes(w))) {
          // filterReason이 이미 contextWords 체크하므로 여기선 폴백키워드 확인
          // (contextWords가 없는 C티어는 filterReason이 null 반환 — 폴백 체크 필요)
          if (mustCtx.length === 0) {
            // C_TIER_FALLBACK_KEYWORDS와 동일한 목록
            const FALLBACK = [
              '투자', '유치', '수상', '선정', 'MOU', '협약', '계약', '출시', '런칭', '오픈', '개시',
              '상장', '인수', '합병', '설립', '창업', '서비스', '기술', '제품', '파트너십',
              '진출', '확대', '성장', '돌파', '기록', '협력', '수주', '납품', '글로벌',
              '파산', '도산', '부도', '손실', '손해', '적손', '소송', '고소', '분쟁', '논란',
              '위반', '적발', '감소', '하락', '급락', '급감', '비판',
              '폐업', '사기', '부실', '결함', '리콜', '해킹', '횡령', '파업',
              '의혹', '수사', '검찰', '공정위', '과징금', '정보유출', '갑질', '불매', '구조조정', '위기',
            ];
            if (!FALLBACK.some(w => a.title.includes(w))) {
              return { id: a.id, title: a.title, keyword: a.matchedKeyword, reason: 'c_tier_no_context', bodyOk: bodySuccess };
            }
          }
        }
      }

      if (reason) {
        return { id: a.id, title: a.title, keyword: a.matchedKeyword, reason, bodyOk: bodySuccess };
      }
      return null;
    }));

    for (const r of results) {
      if (r) toNoise.push(r);
    }

    done += batch.length;
    if (done % 20 === 0 || done === articles.length) {
      process.stdout.write(`\r진행: ${done}/${articles.length} | 본문성공: ${scrapeOk} 실패: ${scrapeFail} | 노이즈: ${toNoise.length}건`);
    }
    await sleep(SCRAPE_DELAY_MS);
  }

  console.log(`\n\n=== 노이즈로 분류될 기사: ${toNoise.length}건 ===`);

  // 사유별 집계
  const byReason = new Map<string, typeof toNoise>();
  for (const a of toNoise) {
    if (!byReason.has(a.reason)) byReason.set(a.reason, []);
    byReason.get(a.reason)!.push(a);
  }
  for (const [reason, list] of byReason) {
    console.log(`\n· ${reason}: ${list.length}건`);
    list.forEach(a => console.log(`    - [${a.keyword}] ${a.title.slice(0, 60)} (본문:${a.bodyOk ? '✅' : '❌'})`));
  }

  if (!APPLY) {
    console.log('\n[드라이런] DB 반영 안 함. 적용하려면 APPLY=1 로 재실행.');
    return;
  }

  // 4) DB 업데이트
  const ids = toNoise.map(a => a.id);
  let updated = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const res = await prisma.article.updateMany({
      where: { id: { in: chunk } },
      data: { isNoise: true, noiseReason: 'retroactive_filter' },
    });
    updated += res.count;
  }
  console.log(`\n✅ 완료: ${updated}건 isNoise=true 처리`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
