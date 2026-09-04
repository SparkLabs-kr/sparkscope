/**
 * 뉴스 피드 목록 — "지금 뭐가 중요한가"를 신뢰할 수 있는 매체 전반에서 모은다.
 *
 * 방향 전환 (2026-09-04):
 *   전에는 X·Reddit·HN처럼 소스별로 칸을 나눠 보여줬다. 그런데 그 방식은
 *   (1) X는 무료 경로가 없고 (2) Reddit은 429로 불안정한데다 점수도 없어서,
 *   실제로 데이터를 주는 건 Hacker News 하나뿐이었다.
 *   그래서 "어느 커뮤니티에서 떴나" 대신 "신뢰할 수 있는 매체들이 지금 뭘 다루나"로 바꾼다.
 *
 * 구성:
 *   - 금융·종합지(FT·WSJ·Yahoo Finance·CNBC·Reuters·Economist): 산업·자본 흐름
 *   - 전문지(STAT·Endpoints·Fierce Biotech): 바이오 업계 내부 소식
 *   - 독립 분석가·뉴스레터(Simon Willison·Import AI·Stratechery 등): 매체보다 빠르고
 *     해석이 붙는다. 개인 블로그라고 빼면 실무자들이 실제로 읽는 걸 놓친다.
 *
 * domain:
 *   'ai' | 'bio'  — 그 분야 전용 피드. 들어오는 글을 전부 그 도메인으로 본다.
 *   'general'     — 종합지. 글마다 키워드로 분야를 판정한다(둘 다 아니면 버린다).
 *
 * tier: 동점일 때의 우선순위. 1이 높다. 보도의 신뢰도가 아니라
 *       "같은 사안이면 어느 쪽을 대표로 보여줄까"의 기준이다.
 */
export type FeedDomain = 'ai' | 'bio' | 'general';

export interface Feed {
  name: string;
  url: string;
  domain: FeedDomain;
  tier: 1 | 2 | 3;
  /** 개인·뉴스레터 여부. 화면에서 매체와 구분해 표시한다. */
  independent?: boolean;
}

export const FEEDS: Feed[] = [
  // ── 금융·종합 ──
  { name: 'Financial Times', url: 'https://www.ft.com/technology?format=rss', domain: 'general', tier: 1 },
  { name: 'WSJ Tech', url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml', domain: 'general', tier: 1 },
  { name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', domain: 'general', tier: 2 },
  { name: 'Reuters', url: 'https://news.google.com/rss/search?q=when:7d+site:reuters.com+(AI+OR+biotech+OR+pharma)&hl=en-US&gl=US&ceid=US:en', domain: 'general', tier: 1 },
  { name: 'CNBC Tech', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', domain: 'general', tier: 2 },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', domain: 'general', tier: 2 },
  { name: 'The Economist', url: 'https://www.economist.com/science-and-technology/rss.xml', domain: 'general', tier: 1 },

  // ── 기술 매체 ──
  // 유료 매체(FT·WSJ)는 RSS에 100자 안팎의 티저만 실어서, 그것만으로는 요약의 근거가 얇다.
  // 아래 세 곳은 무료이면서 본문을 넉넉히 실어 준다(실측: Ars ~1,000자, Verge ~700자,
  // MIT Tech Review 2,700~5,800자). 근거를 두텁게 하려고 함께 넣는다.
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', domain: 'general', tier: 2 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', domain: 'general', tier: 2 },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', domain: 'general', tier: 1 },

  // ── 바이오 전문지 ──
  { name: 'STAT News', url: 'https://www.statnews.com/feed/', domain: 'bio', tier: 1 },
  { name: 'Endpoints News', url: 'https://endpts.com/feed/', domain: 'bio', tier: 1 },
  { name: 'Fierce Biotech', url: 'https://www.fiercebiotech.com/rss/xml', domain: 'bio', tier: 2 },
  { name: 'In the Pipeline', url: 'https://news.google.com/rss/search?q=when:14d+site:science.org+%22In+the+Pipeline%22&hl=en-US&gl=US&ceid=US:en', domain: 'bio', tier: 2, independent: true },
  { name: 'Ground Truths (Eric Topol)', url: 'https://erictopol.substack.com/feed', domain: 'bio', tier: 2, independent: true },

  // ── AI 독립 분석가·뉴스레터 ──
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', domain: 'ai', tier: 2, independent: true },
  { name: 'Import AI (Jack Clark)', url: 'https://jack-clark.net/feed/', domain: 'ai', tier: 2, independent: true },
  { name: 'Interconnects (Nathan Lambert)', url: 'https://www.interconnects.ai/feed', domain: 'ai', tier: 2, independent: true },
  { name: 'Ahead of AI (Sebastian Raschka)', url: 'https://magazine.sebastianraschka.com/feed', domain: 'ai', tier: 3, independent: true },
  { name: 'One Useful Thing (Ethan Mollick)', url: 'https://www.oneusefulthing.org/feed', domain: 'ai', tier: 3, independent: true },
  { name: 'Stratechery', url: 'https://stratechery.com/feed/', domain: 'ai', tier: 2, independent: true },
];

/**
 * 종합지 기사의 분야 판정용 키워드.
 * 제목에만 걸어서 본문 없이도 판정되게 한다 — RSS는 본문을 안 주는 경우가 많다.
 */
export const DOMAIN_KEYWORDS: Record<'ai' | 'bio', RegExp> = {
  ai: /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|gpt|chatgpt|openai|anthropic|claude|gemini|deepmind|nvidia|gpu|chip|semiconductor|neural|model|inference|copilot|agent|robot|autonomous|data cent(er|re)|transformer|hugging ?face|mistral|deepseek)\b/i,
  bio: /\b(bio|biotech|pharma|drug|clinical|fda|trial|therap(y|ies|eutic)|gene|genom|crispr|mrna|vaccine|oncology|cancer|antibody|molecule|patient|disease|medical|medicine|health ?care|diagnostic|protein|cell therapy|neuro)\b/i,
};
