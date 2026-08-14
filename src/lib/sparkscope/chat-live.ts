// 우리 DB에 없을 때만 쓰는 실시간 검색 폴백 — 매일 수집 크론이 쓰는 것과 같은 소스
// (구글뉴스 RSS + 네이버 뉴스 검색 API, collector.ts)를 그 자리에서 즉석으로 호출한다.
// leeryeong 브랜치에서 먼저 만들었던 기능을 Intern-Branch 구조에 맞춰 이식했다(2026-08-11).
//
// DB 검색과 달리 처음엔 필터를 거치지 않았지만, 노이즈가 많아 excludeWords/contextWords를
// 적용하도록 수정했다(2026-08-12). search_articles/semantic_search가 0건일 때만 에이전트가
// 이 도구를 부르도록 chat-agent.ts의 프롬프트에서 안내한다.
import OpenAI from 'openai';
import { fetchGoogleNews, fetchNaverNews, naverEnabled } from './collector';
import { prisma } from '@/lib/prisma';
import { PERIOD_LABEL, type ChatQueryResult } from './chat-types';
import { dedupeArticles } from './chat-query';

export async function runLiveSearch(keyword: string): Promise<ChatQueryResult> {
  // 감시 대상 정보 조회 (이름 변형, 필터링 규칙 포함)
  const target = await prisma.monitoringTarget.findFirst({
    where: { primaryKeyword: keyword },
  });

  // DB 검색과 동일하게, 감시 대상의 모든 키워드 변형으로 검색한다
  // (단일 검색어만으로는 기사를 놓칠 수 있음 — 예: "스파크랩"과 "스파크" 양쪽 다 필요)
  const searchTerms = new Set<string>();
  searchTerms.add(keyword);
  if (target?.name) searchTerms.add(target.name);
  if (target?.englishName) searchTerms.add(target.englishName);
  if (target?.helperKeywords) {
    target.helperKeywords.split(',').forEach(k => {
      const term = k.trim();
      if (term) searchTerms.add(term);
    });
  }

  // 각 검색어로 Google News + Naver News 검색
  const jobs: Promise<any[]>[] = [];
  for (const term of searchTerms) {
    jobs.push(fetchGoogleNews(term).catch(() => []));
    if (naverEnabled()) jobs.push(fetchNaverNews(term).catch(() => []));
  }
  const raw = (await Promise.all(jobs)).flat();

  // DB의 excludeWords/contextWords 필터를 적용해서 노이즈 제거
  const filtered = raw.filter((a) => {
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

  // contextWords 매칭 개수로 정확성 순 정렬 (많을수록 우선)
  const withScore = filtered.map((a) => {
    const title = a.title.toLowerCase();
    let score = 0;
    if (target?.contextWords) {
      const contexts = target.contextWords.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      score = contexts.filter((w) => title.includes(w)).length;
    }
    return { a, score };
  });

  const seen = new Set<string>();
  const linkDeduped = withScore
    .sort((x, y) => y.score - x.score || +new Date(y.a.pubDate) - +new Date(x.a.pubDate))
    .filter((item) => {
      if (seen.has(item.a.link)) return false;
      seen.add(item.a.link);
      return true;
    })
    .map((item) => ({ ...item.a, priorityScore: item.score }));

  // 실시간 검색은 linkDeduped가 이미 링크 기반으로 중복 제거되어 있어서,
  // dedupeArticles를 추가로 쓰면 같은 사안의 다른 매체 기사까지 과도하게 제거된다.
  // 상위 15개를 가져와서 최신순으로 정렬한다.
  const deduped = linkDeduped.slice(0, 15);
  deduped.sort((a, b) => +new Date(b.pubDate) - +new Date(a.pubDate));

  const articles = deduped.map((a, i) => ({
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

const LIVE_SUMMARY_MODEL = 'gpt-5.4-mini';

/**
 * 실시간 검색 결과(제목만 있고 톤·요약이 없는 원본)를 사람이 말하듯 3~4문장으로 요약한다.
 *
 * "🔍 실시간 검색" 버튼을 눌렀을 때는 chat-agent를 거치지 않고 이 함수만 호출되는데,
 * 예전엔 여기 요약이 "노이즈 필터를 안 거쳤다"는 고정 문구 하나뿐이라 챗봇이 실제로 기사를
 * 읽고 답하는 것처럼 안 느껴졌다(2026-08-12 피드백). gpt-5.4-mini라 기사 15건 요약해도
 * 호출당 $0.01 미만이라 비용 부담은 거의 없다.
 */
export async function summarizeLiveSearch(keyword: string, result: ChatQueryResult): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY || result.articles.length === 0) return null;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const list = result.articles
      .map((a) => `- ${a.title} (${a.source}, ${a.pubDate.slice(0, 10)})`)
      .join('\n');
    const res = await openai.chat.completions.create({
      model: LIVE_SUMMARY_MODEL,
      max_completion_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            '너는 스파크랩 뉴스 분석 담당이다. 방금 실시간(구글뉴스·네이버뉴스)으로 검색한 기사 제목 목록을 받는다.\n' +
            '한국어 존댓말로 3~4문장, 실제로 방금 찾아본 것처럼 자연스럽게 답해라.\n' +
            '- 목록에 실제로 있는 사실만 말해라. 지어내거나 추측하지 마라.\n' +
            '- 같은 사안을 여러 매체가 받아쓴 게 보이면 그 사실을 짚어라.\n' +
            '- 굵게(**) 같은 마크다운 강조는 쓰지 마라. 도구 이름을 언급하지 마라.\n' +
            '- 이 결과가 우리 DB의 노이즈 필터를 거치지 않은 실시간 원본이라는 점을 자연스럽게 한 번 짚어라.',
        },
        { role: 'user', content: `"${keyword}" 실시간 검색 결과 ${result.total}건:\n${list}` },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[chat-live] 요약 생성 실패', e);
    return null;
  }
}
