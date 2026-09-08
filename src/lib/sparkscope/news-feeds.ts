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
  // WSJ 두 피드(RSSWSJD·RSSMarketsMain)는 2026-09-08 확인 시 최신 항목이
  // 2025-01-27에 멈춰 있었다 — 1년 반 넘게 갱신되지 않는 죽은 주소다.
  // 매번 20개를 받아 전부 날짜 필터에서 버려지고 있었으므로 제거했다.
  // WSJ를 다시 넣으려면 살아 있는 주소를 먼저 확인할 것.
  { name: 'Reuters', url: 'https://news.google.com/rss/search?q=when:7d+site:reuters.com+(AI+OR+biotech+OR+pharma)&hl=en-US&gl=US&ceid=US:en', domain: 'general', tier: 1 },
  { name: 'CNBC Tech', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', domain: 'general', tier: 2 },
  // Yahoo Finance(finance.yahoo.com/news/rssindex)는 2026-09-08에 제거했다.
  // 개인투자자용 종목 분석이 대부분이라 — "Snowflake와 C3.ai 중 살 만한 AI 주식은",
  // "GoPro가 카메라를 버리고 AI 데이터센터로", "(NVDA) 목표주가" 류 — 산업에서
  // 일어난 사건이 아니라 투자 조언이다. 중요도 상한을 걸어도 유입량이 많아
  // 상위 12칸 중 4칸을 그런 글이 차지했다.
  { name: 'The Economist', url: 'https://www.economist.com/science-and-technology/rss.xml', domain: 'general', tier: 1 },

  // ── 기술 매체 ──
  // 유료 매체(FT·WSJ)는 RSS에 100자 안팎의 티저만 실어서, 그것만으로는 요약의 근거가 얇다.
  // 아래 세 곳은 무료이면서 본문을 넉넉히 실어 준다(실측: Ars ~1,000자, Verge ~700자,
  // MIT Tech Review 2,700~5,800자). 근거를 두텁게 하려고 함께 넣는다.
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', domain: 'general', tier: 2 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', domain: 'general', tier: 2 },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', domain: 'general', tier: 1 },

  // ── 한국 AI 전문지 ──
  //
  // ⚠️ domain을 'general'로 두면 안 된다. 종합지는 글마다 DOMAIN_KEYWORDS로 분야를
  //    가르는데 그 정규식이 영어라, 한국어 제목은 전부 걸러진다.
  //    이 두 곳은 AI 전문 매체이므로 'ai' 전용 피드로 둬서 키워드 판정을 건너뛴다.
  //
  // 왜 넣나: 국내 독자가 실제로 보는 AI 뉴스가 여기 먼저 뜬다. 2026-09-08 확인 시
  // 영어 피드 21곳에 없던 "GPT-6 아스트라" 관련 기사가 aitimes에 5건 있었다.
  // 한국어 제목이라 단어 겹침으로는 영어 기사와 안 묶이지만, 사건 병합은 LLM이
  // 하므로(news-cluster.ts) 같은 사건이면 언어가 달라도 붙는다.
  { name: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml', domain: 'ai', tier: 2 },
  { name: 'AI타임스코리아', url: 'https://www.aitimes.kr/rss/allArticle.xml', domain: 'ai', tier: 3 },

  // 더밀크(themiilk.com)는 RSS가 없다 — /rss·/feed·/atom.xml은 500,
  // /topics/ai/rss는 200이지만 RSS가 아니라 HTML을 돌려준다(2026-09-08 확인).
  // 넣으려면 HTML 파싱이 필요해 별도 작업으로 남긴다.

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
