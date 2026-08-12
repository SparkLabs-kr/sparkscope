// 우리 DB에 없을 때만 쓰는 실시간 검색 폴백 — 매일 수집 크론이 쓰는 것과 같은 소스
// (구글뉴스 RSS + 네이버 뉴스 검색 API, collector.ts)를 그 자리에서 즉석으로 호출한다.
// leeryeong 브랜치에서 먼저 만들었던 기능을 Intern-Branch 구조에 맞춰 이식했다(2026-08-11).
//
// DB 검색과 달리 처음엔 필터를 거치지 않았지만, 노이즈가 많아 excludeWords/contextWords를
// 적용하도록 수정했다(2026-08-12). search_articles/semantic_search가 0건일 때만 에이전트가
// 이 도구를 부르도록 chat-agent.ts의 프롬프트에서 안내한다.
import { fetchGoogleNews, fetchNaverNews, naverEnabled } from './collector';
import { prisma } from '@/lib/prisma';
import { PERIOD_LABEL, type ChatQueryResult } from './chat-types';

export async function runLiveSearch(keyword: string): Promise<ChatQueryResult> {
  const jobs = [fetchGoogleNews(keyword).catch(() => [])];
  if (naverEnabled()) jobs.push(fetchNaverNews(keyword).catch(() => []));
  const raw = (await Promise.all(jobs)).flat();

  // 네이버 뉴스 검색 API는 제목에 키워드가 실제로 없어도 느슨하게(연관 검색 수준으로) 결과를
  // 준다 — "에큐리바이오"로 검색했는데 무관한 기사가 섞여 나온 걸 실제 확인함(2026-08-11).
  // DB 검색과 동일하게 제목에 키워드가 실제로 포함된 것만 남긴다.
  const relevant = raw.filter((a) => a.title.toLowerCase().includes(keyword.toLowerCase()));

  // 우리 DB의 excludeWords/contextWords 필터를 적용해서 노이즈 제거
  const target = await prisma.monitoringTarget.findFirst({
    where: { primaryKeyword: keyword },
  });

  const filtered = relevant.filter((a) => {
    const title = a.title.toLowerCase();
    // excludeWords: 제목에 이 단어 중 하나라도 있으면 제외
    if (target?.excludeWords) {
      const excludes = target.excludeWords.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      if (excludes.some((w) => title.includes(w))) return false;
    }
    // contextWords: 제목에 이 단어 중 하나라도 있어야 통과 (없으면 true = 통과)
    if (target?.contextWords) {
      const contexts = target.contextWords.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      if (contexts.length > 0 && !contexts.some((w) => title.includes(w))) return false;
    }
    return true;
  });

  const seen = new Set<string>();
  const deduped = filtered.filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
  deduped.sort((a, b) => +new Date(b.pubDate) - +new Date(a.pubDate));

  const articles = deduped.slice(0, 15).map((a, i) => ({
    id: `live-${i}`,
    title: a.title,
    link: a.link,
    source: a.source,
    pubDate: new Date(a.pubDate).toISOString(),
    category: 'live',
    matchedKeyword: keyword,
    tone: null,
    riskFlag: null,
    oneLiner: null,
    importance: null,
  }));

  return {
    terms: [keyword],
    periodLabel: PERIOD_LABEL.all,
    total: articles.length,
    prevTotal: null,
    deltaPct: null,
    deltaUnavailableReason: null,
    deltaCaution: articles.length > 0 ? '실시간 검색 결과예요 — 우리 DB의 노이즈 필터를 거치지 않은 원본이라 관련 없는 기사가 섞여있을 수 있어요.' : null,
    byCategory: articles.length ? [{ category: 'live', count: articles.length }] : [],
    topSources: [],
    topCompanies: [],
    negativeCount: 0,
    riskCount: 0,
    monthly: null,
    noisyKeywords: null,
    articles,
  };
}
