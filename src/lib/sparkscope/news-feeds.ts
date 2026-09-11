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
  /**
   * 한국 매체인가. 순위를 내리기 위한 표시가 아니라 "해외 매체도 다뤘는가"를 판정하기
   * 위한 것이다 — 국내 소식이라도 해외 매체가 함께 다뤘으면 글로벌 사안으로 본다.
   */
  korean?: boolean;
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
  // The Rundown AI는 매체로 옮겼다(2026-09-10 결정). 지표로만 두면 화면에 뜨지 않는데,
  // 그날 AI 업계의 최대 사건을 골라 머리기사로 쓰는 곳이라 기사 자체를 보여줄 값어치가 있다.
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

  // ── Inter 수집 파이프라인에서 가져온 매체 (2026-09-09) ──
  //
  // inter-collect.ts가 이미 검증해 둔 목록이다. 같은 매체를 두 곳에서 긁고 있었는데
  // 오늘의 시그널 쪽 목록에는 없어서 배너·키워드 선정에 쓰이지 않았다.
  // 겹치는 곳(The Verge·Ars·MIT TR·STAT·Endpoints·FT·VentureBeat)은 여기 다시 넣지
  // 않는다 — 같은 피드가 두 이름으로 들어오면 "함께 보도한 매체 수"가 부풀려진다.
  //
  // 넣지 않은 것:
  //  · WSJ(RSSWSJD.xml) — 2025-01에 멈춘 죽은 피드다(위 주석 참고).
  //  · Fierce Biotech — Cloudflare 차단으로 뺐다. 1면 스크랩만 쓴다.
  //  · Impress Watch — 일본어 종합 IT라 domain을 'ai'로 두면 소비자 가전 기사가
  //    쏟아진다. 영어 키워드 판정('general')으로는 일본어가 전부 걸러지므로 방법이 없다.
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', domain: 'general', tier: 2 },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', domain: 'general', tier: 2 },
  // markets가 아니라 technology 피드를 쓴다.
  //
  // markets 피드는 살아 있고 20건을 주지만 AI 기사가 0건이다(2026-09-11 실측:
  // 제목 21개 중 AI 키워드 0개). 'general' 피드는 제목이 DOMAIN_KEYWORDS를
  // 통과해야 들어오므로 전량 버려졌고, 그래서 블룸버그가 오랫동안 한 건도
  // 안 들어왔다 — 그날 1면 톱이던 Sam Altman 발언·Moonshot의 Claude 우회도
  // 우리 화면에 없었다. technology 피드는 20건 중 11건이 AI다.
  //
  // feeds.bloomberg.com 주소도 301로 www로 넘어가지만, 그건 문제가 아니었다
  // (fetch가 따라간다). 원인은 리다이렉트가 아니라 피드 선택이었다.
  { name: 'Bloomberg', url: 'https://www.bloomberg.com/feeds/technology/news.rss', domain: 'general', tier: 1 },
  { name: 'New York Times Tech', url: 'https://feeds.nytimes.com/nyt/rss/technology', domain: 'general', tier: 1 },
  { name: 'CB Insights', url: 'https://www.cbinsights.com/research/feed/', domain: 'general', tier: 3 },

  // 아시아·중동 — 영어 매체라 종합지와 같은 키워드 판정을 받는다.
  // 이 피드는 2,000건·11.5MB를 한 번에 준다(posts_per_rss가 사이트 설정이라 줄일 수 없고,
  // AI 카테고리 피드는 404, Google News 우회는 주소가 리다이렉트 링크로 바뀐다).
  // 그래도 그대로 둔다 — news-digest의 FEED_MAX_BYTES(1.5MB)가 읽기를 중간에 끊으므로
  // 실제로 받는 건 1.5MB다. 2026-09-11 실측 커버리지:
  //   300KB → 51건(9/03까지) · 600KB → 113건(8/25) · 1.5MB → 286건(7/24)
  // '이번 달' 탭이 30일을 보므로 1.5MB가 하한이다. 더 내리면 그 탭에서 중국 AI 기사가
  // 조용히 사라진다. 기여도는 7일에 22건으로 적지 않다(알리바바·딥시크·문샷).
  { name: 'TechNode', url: 'https://technode.com/feed/', domain: 'general', tier: 2 },
  { name: 'SCMP Tech', url: 'https://www.scmp.com/rss/36/feed/', domain: 'general', tier: 2 },
  { name: 'Wamda', url: 'https://www.wamda.com/feed', domain: 'general', tier: 3 },
  // 일본어 피드는 영어 키워드 판정을 통과할 수 없으므로 전용 도메인으로 둔다.
  // 두 곳 다 주제가 좁아서(AI 전문·제약 전문) 그렇게 둬도 엉뚱한 기사가 들어오지 않는다.
  { name: 'ITmedia AI+', url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml', domain: 'ai', tier: 3 },
  { name: 'AnswersNews', url: 'https://answers.and-pro.jp/pharmanews/feed/', domain: 'bio', tier: 3 },

  // The Rundown AI — 지표에서 매체로 옮겼다(2026-09-10). 그날의 최대 사건을 골라
  // 머리기사로 쓰는 큐레이션 뉴스레터다.
  { name: 'The Rundown AI', url: 'https://www.therundown.ai/feed', domain: 'ai', tier: 2, independent: true },

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
  { korean: true, name: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml', domain: 'ai', tier: 2 },
  { korean: true, name: 'AI타임스코리아', url: 'https://www.aitimes.kr/rss/allArticle.xml', domain: 'ai', tier: 3 },

  // 더밀크(themiilk.com)는 RSS가 없다 — /rss·/feed·/atom.xml은 500,
  // /topics/ai/rss는 200이지만 RSS가 아니라 HTML을 돌려준다(2026-09-08 확인).
  // 넣으려면 HTML 파싱이 필요해 별도 작업으로 남긴다.

  // ── 한국 바이오·제약 전문지 ──
  //
  // AI타임스와 같은 이유로 domain을 'bio'로 둔다(한국어 제목은 영어 키워드 판정을 통과 못 함).
  // 국내 소식은 news-digest의 문턱(4점 이상)을 넘어야 목록에 오르므로, 유입량이 많아도
  // 예산·인사 같은 기사가 상위를 채우지 않는다.
  // biospectator는 RSS가 404라 제외했다(2026-09-08 확인).
// 메디파나뉴스는 뺐다(2026-09-09) — 국내 제약업계 소식만 다뤄서, 해외 트렌드를 보는
// 이 화면의 목적과 맞지 않는다.
  { korean: true, name: '바이오타임즈', url: 'https://www.biotimes.co.kr/rss/allArticle.xml', domain: 'bio', tier: 3 },
  { korean: true, name: '약업신문', url: 'https://www.pharmnews.com/rss/allArticle.xml', domain: 'bio', tier: 3 },

  // ── 바이오 전문지 ──
  { name: 'STAT News', url: 'https://www.statnews.com/feed/', domain: 'bio', tier: 1 },
  // Inter 파이프라인에서 가져온 바이오 전문지·학술지 (2026-09-09).
  // 학술지(Nature·Cell·Science)를 tier 2로 두는 이유: 1차 연구는 신뢰도가 가장 높지만
  // "업계에 무슨 일이 일어났나"의 대표 기사로는 업계지가 더 알맞다.
  { name: 'BioPharma Dive', url: 'https://www.biopharmadive.com/feeds/news/', domain: 'bio', tier: 1 },
  { name: 'BioCentury', url: 'https://www.biocentury.com/rss/news.xml', domain: 'bio', tier: 2 },
  // Nature·Science는 'bio'가 아니라 'general'이다. 종합 과학지라 물리·기후·AI 기사가
  // 함께 오는데, 'bio' 전용 피드로 두면 그게 전부 바이오 탭에 들어온다 — 실제로
  // "OpenAI가 수학 밀레니엄 문제를 풀었다"(Nature)가 바이오 3위에 올라왔다(2026-09-09).
  // 'general'로 두면 글마다 키워드로 분야를 가른다. 제목이 영어라 판정이 작동한다.
  { name: 'Nature', url: 'https://www.nature.com/nature.rss', domain: 'general', tier: 2 },
  { name: 'Science', url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science', domain: 'general', tier: 2 },
  // Cell은 세포생물학 전문지라 들어오는 글이 전부 바이오다.
  { name: 'Cell', url: 'https://www.cell.com/action/showFeed?ui=0&mi=0&ai=n2h&jc=cell&type=etoc&feed=rss', domain: 'bio', tier: 2 },
  { name: 'Endpoints News', url: 'https://endpoints.news/feed/', domain: 'bio', tier: 1 },
  // Fierce Biotech RSS는 뺐다(2026-09-09). Cloudflare 봇 차단으로 Vercel에서 403이고,
  // GitHub Actions로 옮길 수도 있었지만 "막히는 매체는 그냥 뺀다"로 정했다.
  // 1면 헤드라인 스크랩은 GitHub Actions에서 계속 돌아가므로 Fierce 기사는 그 경로로 들어온다
  // (.github/workflows/collect-headlines.yml).
  { name: 'In the Pipeline', url: 'https://news.google.com/rss/search?q=when:14d+site:science.org+%22In+the+Pipeline%22&hl=en-US&gl=US&ceid=US:en', domain: 'bio', tier: 2, independent: true },
  { name: 'Ground Truths (Eric Topol)', url: 'https://erictopol.substack.com/feed', domain: 'bio', tier: 2, independent: true },

  // ── AI 독립 분석가·뉴스레터 ──
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', domain: 'ai', tier: 2, independent: true },
  // Import AI는 커뮤니티 소스로 옮겼다(2026-09-10 요청).
  //
  // ⚠️ 여기서 뺀 이유가 중요하다: importai.substack.com 과 jack-clark.net 은 같은
  //    뉴스레터의 두 주소이고 글도 같다(실측: Import AI 472·471·470이 양쪽에 동일).
  //    양쪽을 다 두면 같은 글이 "매체"와 "커뮤니티"로 두 번 세어져서 "여러 매체가
  //    함께 보도"가 부풀려지고 이름 카드에도 두 번 뜬다. 그래서 한 곳만 남긴다.
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
