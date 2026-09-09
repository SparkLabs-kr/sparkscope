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

/**
 * 지표 전용 소스 — 화면에 뉴스로 띄우지 않는다.
 *
 * 컨설팅 리포트(맥킨지)·벤더 블로그(딥마인드)·큐레이션 뉴스레터(The Rundown)는
 * 기사가 아니라 오피니언·발표·요약이다. 이걸 뉴스 목록에 섞으면 "업계에서 지금
 * 무슨 일이 일어났나"가 아니라 "누가 무슨 의견을 냈나"가 올라온다.
 *
 * 그런데 버리기도 아깝다 — 여기가 무엇을 다루는지는 그 자체로 동향 지표다.
 * 특히 The Rundown은 그날 AI 업계의 가장 큰 사건을 골라 머리기사로 쓰고,
 * 딥마인드 블로그는 모델 공개를 1차 출처로 확인해 준다. 그래서 이 소스들은
 * 항목으로 노출하지 않고, 우리가 이미 가진 기사와 같은 사안이면 그 기사의
 * 순위를 올리는 데만 쓴다(news-digest.ts의 indicatorOutlets).
 *
 * 못 넣은 곳(2026-09-08 실측):
 *   · Gartner — /en/ai 와 newsroom RSS 모두 403. 서버에서 접근이 막혀 있다.
 *   · VentureBeat 자체 RSS — Vercel 봇 검문(429)에 걸린다. 피드버너 주소로 우회했고,
 *     그쪽은 열려 있어 지표가 아니라 정식 뉴스 피드로 넣었다.
 *   · McKinsey /insights/rss 는 전사 피드라 철도·유틸리티·자동차가 섞여 온다.
 *     'general'로 두어 AI 키워드가 있는 것만 통과시킨다.
 */
export const INDICATOR_FEEDS: Feed[] = [
  // 그날 AI 업계의 최대 사건을 골라 머리기사로 쓴다 — 편집 판단이 가장 선명하다.
  { name: 'The Rundown AI', url: 'https://www.therundown.ai/feed', domain: 'ai', tier: 2, independent: true },
  // 모델 공개의 1차 출처. "제미나이 3.8 플래시 공개"가 실제 발표인지 확인해 준다.
  { name: 'Google DeepMind Blog', url: 'https://deepmind.google/blog/rss.xml', domain: 'ai', tier: 2 },
  // 컨설팅 리포트 — 사건 속보는 아니지만 어떤 주제가 의사결정 의제에 올랐나를 본다.
  { name: 'McKinsey Insights', url: 'https://www.mckinsey.com/insights/rss', domain: 'general', tier: 3 },
];

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
  // venturebeat.com/feed 는 Vercel 봇 검문(429)에 막힌다. 피드버너 주소는 열려 있다.
  { name: 'VentureBeat', url: 'https://feeds.feedburner.com/venturebeat/SZYF', domain: 'general', tier: 2 },

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

  // ── 한국 바이오·제약 전문지 ──
  //
  // AI타임스와 같은 이유로 domain을 'bio'로 둔다(한국어 제목은 영어 키워드 판정을 통과 못 함).
  // 국내 소식은 news-digest의 문턱(4점 이상)을 넘어야 목록에 오르므로, 유입량이 많아도
  // 예산·인사 같은 기사가 상위를 채우지 않는다.
  // biospectator는 RSS가 404라 제외했다(2026-09-08 확인).
  { name: '바이오타임즈', url: 'https://www.biotimes.co.kr/rss/allArticle.xml', domain: 'bio', tier: 3 },
  { name: '약업신문', url: 'https://www.pharmnews.com/rss/allArticle.xml', domain: 'bio', tier: 3 },
  { name: '메디파나뉴스', url: 'https://www.medipana.com/rss/allArticle.xml', domain: 'bio', tier: 3 },

  // ── 바이오 전문지 ──
  { name: 'STAT News', url: 'https://www.statnews.com/feed/', domain: 'bio', tier: 1 },
  { name: 'Endpoints News', url: 'https://endpts.com/feed/', domain: 'bio', tier: 1 },
  // ⚠️ fiercebiotech.com 은 데이터센터 IP를 막는다 — 로컬에서는 200인데 Vercel
  //    서버리스에서는 RSS·홈페이지 모두 403이다(2026-09-08 프로덕션 로그로 확인).
  //    즉 프로덕션에서 이 피드는 실제로 0건이고, 헤드라인 수집도 같이 막힌다.
  //    IP 문제라 UA를 바꿔도 풀리지 않는다. 남겨 두는 이유는 로컬·다른 실행 환경에서는
  //    유효하고, 열리면 곧바로 다시 쓰이기 때문이다. 접근성은 .github/workflows/
  //    probe-sources.yml 로 환경별로 확인한다.
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
