/**
 * AI 시그널 TOP 5 — 다이제스트 메일과 파트너 사이트가 공유하는 하나의 선정 로직.
 *
 * 같은 "이번 주 AI 트렌드"를 두 곳에 내보내는데, 고르는 규칙이 갈라지면 메일과 파트너
 * 배너에 서로 다른 목록이 뜬다. 그래서 선정은 여기 한 곳에서만 한다.
 *
 * 뉴스만 넣는다(2026-09-09 결정). 예전에는 커뮤니티 글도 섞어 5건을 만들었는데,
 * 커뮤니티의 역할은 대시보드에서 뉴스를 뒷받침하는 것이지 그 자체로 트렌드를
 * 말하는 것이 아니다. 실제로 메일에 나간 초안에서 다섯 칸 중 두 칸이 Hugging Face
 * 모델 ID였고(Qwen3.8-27B, Qwopus3.8-27B-Flash-GGUF — 뒤쪽은 앞쪽의 파생 모델이다),
 * "이번 주 AI 트렌드"로 읽기에 약했다. 커뮤니티 반응은 대시보드의 이름 카드에서
 * 기사 옆에 붙어 제 역할을 한다(entity-cards.ts).
 *
 * 점수 환산 방식은 그대로 둔다. 지금은 뉴스 하나뿐이라 "1/등수"가 곧 원래 순위지만,
 * 소스가 다시 늘어날 때 규모가 다른 점수를 섞는 문제가 되돌아온다 — 예전에 HF
 * 다운로드 60,343과 Lobsters 업보트 13을 한 줄로 세우려다 겪은 문제다.
 */
import { collectDigest, type DigestItem } from './news-digest';
import { ensureSummaries } from './news-summary';

/** 메일·파트너 모두 합쳐서 5건. */
export const TOP_N = 5;
/** 조회 창 — 다이제스트가 월·수·금이라 직전 발송 이후를 덮으려면 이 정도가 필요하다. */
const NEWS_DAYS = 7;

/**
 * 소스별 가중치 — "같은 등수라면 어느 쪽을 위에 둘까".
 *
 * 지금은 뉴스만 쓰므로 실질적으로 상수 하나다. 나머지 값은 커뮤니티를 다시 넣을 때
 * 쓰던 기준을 기록으로 남긴 것이다: 뉴스 1.0 > HN 0.85 > HF 0.8 > HF 신규 0.7 >
 * Lobsters 0.6 > arXiv 0.55 > Reddit 0.45. 뉴스가 가장 높은 이유는 여러 매체가
 * 각자 취재해 같은 사안을 다뤘다는 것이 편집자 여럿의 독립적인 판단이라 커뮤니티
 * 업보트보다 무거운 신호이기 때문이다.
 */
const SOURCE_WEIGHT = { news: 1.0 } as const;

export interface FeedItem {
  rank: number;
  /** 'news' 매체 보도 · 'signal' 커뮤니티·모델 허브 글 — 배너에서 다르게 그릴 수 있게. */
  kind: 'news' | 'signal';
  title: string;
  titleKo: string | null;
  url: string;
  /** 표시 이름 — 매체명(Reuters) 또는 소스명(Hugging Face · 인기 모델) */
  source: string;
  /** 기계용 식별자 — 'news' 또는 소스 id(hf·hn·lobsters…) */
  sourceId: string;
  publishedAt: string | null;
  /** 만든 곳·1저자. 뉴스는 비어 있다. */
  author: string | null;
  /** 커뮤니티 글의 반응 수. 뉴스는 null. */
  points: number | null;
  /** points가 세는 단위 — 업보트 / 좋아요 / 다운로드 */
  pointsLabel: string | null;
  comments: number | null;
  /** 같은 사안을 다룬 다른 매체 수. 커뮤니티 글은 null. */
  alsoInCount: number | null;
  /** 지표 소스(리포트·벤더 블로그·뉴스레터) 중 같은 사안을 다룬 곳 이름. 뉴스가 아니라
   *  근거로만 쓴다(news-digest.ts). 커뮤니티 글은 빈 배열. */
  indicatorSources: string[];
  /** 이 사안을 1면 헤드라인으로 건 매체 수. 함께 보도한 것보다 강한 신호다
   *  (news-digest.ts 참고). 커뮤니티 글은 null. */
  headlineOutlets: number | null;
  /** 쉬운 말 요약. 뉴스에만 있다. */
  summaryKo: string | null;
  summaryEn: string | null;
  /** 한 줄 설명 — "이게 뭐고 왜 화제인가". HF 모델처럼 제목이 id라 용도를 알 수
   *  없는 항목에 붙는다. 뉴스는 summaryKo가 그 역할을 하므로 비어 있다. */
  blurb: string | null;
}

export interface SignalFeed {
  domain: 'ai';
  generatedAt: string;
  items: FeedItem[];
}

/** 순위 계산 전 내부 표현 — 자기 소스 안에서의 등수를 들고 다닌다. */
type Candidate = Omit<FeedItem, 'rank'> & { score: number };

async function newsCandidates(): Promise<Candidate[]> {
  const { items } = await collectDigest('ai', NEWS_DAYS, TOP_N * 2);
  // 커뮤니티를 빼면서 다섯 칸을 전부 뉴스로 채운다 — 예전에는 절반이 커뮤니티라
  // 뉴스 후보를 TOP_N까지만 만들면 됐다.
  const top = items.slice(0, TOP_N);
  // 요약이 없으면 채운다. 이미 있는 기사는 캐시에서 나오므로 다시 과금되지 않는다.
  await ensureSummaries(top).catch(e => console.error('[signal-feed] 요약 실패(무시):', e));

  return top.map((it: DigestItem, i) => ({
    kind: 'news' as const,
    title: it.title,
    titleKo: it.summary?.titleKo ?? null,
    url: it.url,
    source: it.source,
    sourceId: 'news',
    publishedAt: it.publishedAt,
    author: null,
    points: null,
    pointsLabel: null,
    comments: null,
    alsoInCount: it.alsoIn.length,
    headlineOutlets: it.headlineOutlets || null,
    indicatorSources: [...new Set(it.indicators.map(x => x.source))],
    summaryKo: it.summary?.ko ?? null,
    summaryEn: it.summary?.en ?? null,
    blurb: null,
    // 등수 점수 × 가중치. 여러 매체가 함께 다뤘으면 그만큼 올려 주고, 1면 헤드라인으로
    // 건 매체가 여럿이면 더 올려 준다 — 이 섹션에서 "중요하다"의 가장 단단한 근거다.
    score: (1 / (i + 1)) * SOURCE_WEIGHT.news
      * (1 + 0.3 * it.alsoIn.length + 0.5 * Math.max(0, it.headlineOutlets - 1)),
  }));
}


/**
 * 뉴스와 커뮤니티를 섞어 TOP 5를 만든다.
 *
 * ⚠️ 포트폴리오사 매칭은 넣지 않는다. 어느 포트폴리오사가 어떤 트렌드에 연결되는지는
 *    창업자 관련 비공개 정보라 파트너 배너에 나가면 안 된다. 메일에서도 포트폴리오
 *    연결은 바로 위 '글로벌 트렌드 × 포트폴리오' 섹션의 몫이다.
 */
export async function buildSignalFeed(): Promise<SignalFeed> {
  const news = await newsCandidates()
    .catch(e => { console.error('[signal-feed] 뉴스 실패:', e); return [] as Candidate[]; });

  const items = news
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map(({ score, ...rest }, i) => ({ rank: i + 1, ...rest }));

  return { domain: 'ai', generatedAt: new Date().toISOString(), items };
}
