/**
 * AI 시그널 TOP 5 — 다이제스트 메일과 파트너 사이트가 공유하는 하나의 선정 로직.
 *
 * 같은 "오늘의 AI 트렌드"를 두 곳에 내보내는데, 고르는 규칙이 갈라지면 메일과 파트너
 * 배너에 서로 다른 목록이 뜬다. 그래서 선정은 여기 한 곳에서만 한다.
 *
 * 두 갈래를 각각 5건씩 뽑는다 — 성격이 달라서 한 줄로 세우면 비교가 성립하지 않는다.
 *  · news    "오늘의 시그널" — 신뢰할 수 있는 매체가 함께 다룬 기사. 여러 매체가 겹칠수록 위.
 *  · signals "소셜 시그널"   — 커뮤니티·모델 허브에서 화제인 글. 소스별 점수 규모가
 *                              네 자릿수 차이(HF 다운로드 26,731 vs Lobsters 업보트 13)라
 *                              점수를 그대로 비교하면 한 소스가 5칸을 다 먹는다.
 *                              소스 안에서의 순위를 쓰고, 소스를 돌아가며 한 건씩 뽑는다.
 */
import { collectDigest, type DigestItem } from './news-digest';
import { ensureSummaries } from './news-summary';
import { readSignals } from './social-store';
import { DOMAIN_SOURCES, SOURCE_META } from './social-collect';

/** 메일·파트너 모두 5건. */
export const TOP_N = 5;
/** 조회 창 — 다이제스트가 월·수·금이라 직전 발송 이후를 덮으려면 이 정도가 필요하다. */
const NEWS_DAYS = 7;
const SIGNAL_HOURS = 24 * 14;

export interface FeedNews {
  rank: number;
  title: string;
  titleKo: string | null;
  url: string;
  source: string;
  publishedAt: string;
  /** 같은 사안을 다룬 다른 매체 수 — 이 값이 클수록 위로 온다. */
  alsoInCount: number;
  summaryKo: string | null;
  summaryEn: string | null;
}

export interface FeedSignal {
  rank: number;
  title: string;
  titleKo: string | null;
  url: string;
  /** 소스 표시 이름 (Hugging Face · 인기 모델, Hacker News …) */
  source: string;
  sourceId: string;
  /** 만든 곳·1저자 (OpenAI, Qwen …) */
  author: string | null;
  points: number | null;
  /** points가 세는 단위 — 업보트/좋아요/다운로드 */
  pointsLabel: string | null;
  comments: number | null;
  publishedAt: string | null;
}

export interface SignalFeed {
  domain: 'ai';
  generatedAt: string;
  news: FeedNews[];
  signals: FeedSignal[];
}

/** 뉴스 TOP 5 — 여러 매체가 함께 다룬 순. collectDigest가 이미 그 순으로 준다. */
async function topNews(): Promise<FeedNews[]> {
  const { items } = await collectDigest('ai', NEWS_DAYS, TOP_N * 2);
  const top = items.slice(0, TOP_N);
  // 요약이 없으면 채운다. 이미 있는 기사는 캐시에서 나오므로 다시 과금되지 않는다.
  await ensureSummaries(top).catch(e => console.error('[signal-feed] 요약 실패(무시):', e));

  return top.map((it: DigestItem, i) => ({
    rank: i + 1,
    title: it.title,
    titleKo: it.summary?.titleKo ?? null,
    url: it.url,
    source: it.source,
    publishedAt: it.publishedAt,
    alsoInCount: it.alsoIn.length,
    summaryKo: it.summary?.ko ?? null,
    summaryEn: it.summary?.en ?? null,
  }));
}

/**
 * 소셜 TOP 5 — 소스를 돌아가며 한 건씩(라운드로빈).
 *
 * 점수로 한 줄 세우기를 하지 않는 이유: 소스별 점수 규모가 네 자릿수 차이라
 * HF 다운로드가 항상 이긴다. "여러 커뮤니티에서 각각 무엇이 1위인가"가
 * 배너에 더 쓸모 있는 정보다.
 */
async function topSignals(): Promise<FeedSignal[]> {
  const ids = DOMAIN_SOURCES.ai;
  const bySource = await readSignals('ai', ids, Date.now() - SIGNAL_HOURS * 3600_000, TOP_N);

  const out: FeedSignal[] = [];
  for (let round = 0; round < TOP_N && out.length < TOP_N; round++) {
    for (const id of ids) {
      if (out.length >= TOP_N) break;
      const row = bySource.get(id)?.[round];
      if (!row) continue;
      out.push({
        rank: out.length + 1,
        title: row.title,
        titleKo: row.titleKo ?? null,
        url: row.url,
        source: SOURCE_META[id]?.label ?? id,
        sourceId: id,
        author: row.author ?? null,
        points: row.peakPoints > 0 ? row.peakPoints : null,
        pointsLabel: row.pointsLabel ?? null,
        comments: row.comments || null,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString().slice(0, 10) : null,
      });
    }
  }
  return out;
}

/**
 * 두 갈래를 함께 만든다.
 *
 * ⚠️ 포트폴리오사 매칭은 넣지 않는다. 어느 포트폴리오사가 어떤 트렌드에 연결되는지는
 *    창업자 관련 비공개 정보이고, 파트너 배너에 나가면 안 된다. 메일에도 이 섹션에는
 *    넣지 않는다 — 포트폴리오 연결은 바로 위 '글로벌 트렌드 × 포트폴리오' 섹션의 몫이다.
 */
export async function buildSignalFeed(): Promise<SignalFeed> {
  const [news, signals] = await Promise.all([
    topNews().catch(e => { console.error('[signal-feed] 뉴스 실패:', e); return [] as FeedNews[]; }),
    topSignals().catch(e => { console.error('[signal-feed] 소셜 실패:', e); return [] as FeedSignal[]; }),
  ]);
  return { domain: 'ai', generatedAt: new Date().toISOString(), news, signals };
}
