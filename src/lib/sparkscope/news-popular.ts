/**
 * 매체가 직접 집계한 인기기사 순위.
 *
 * 왜 필요한가 — 두 가지 구멍을 동시에 메운다.
 *
 * ① RSS 창이 너무 좁다.
 *    aitimes.com의 allArticle RSS는 최신 50건만 주는데, 발행량이 많아 그게 약 24시간치다
 *    (2026-09-08 실측: 09-07 16:17 ~ 09-08 16:59). "최근 7일"로 조회해도 실제로는 하루치만
 *    본다는 뜻이다. 그래서 9월 3일에 나온 "GPT-6 아스트라 전격 공개"처럼 며칠 지난
 *    큰 뉴스는 우리 후보 풀에 아예 들어오지 못했다.
 *
 * ② RSS에는 참여도가 없다.
 *    조회수·좋아요를 주지 않으므로 "독자들이 실제로 무엇을 많이 봤나"를 알 수 없었다.
 *    그런데 매체 스스로 "최근 인기기사"·"Most Popular"를 집계해 사이드바에 노출한다.
 *    그게 우리가 갖지 못한 유일한 실측 참여도 신호다.
 *
 * ③ 편집자가 무엇을 1면에 걸었나.
 *    조회수와 별개인 신호다. 조회수는 "많이 클릭됐다"이고, 헤드라인 배치는 "이 매체
 *    편집국이 오늘 가장 중요하다고 판단했다"다. 그리고 결정적으로 — 서로 경쟁하는
 *    매체 여럿이 같은 사안을 동시에 1면에 걸면, 그건 업계가 그 사안을 큰일로 본다는
 *    독립적인 합의다(2026-09-08 실측: FierceBiotech·Endpoints·STAT 세 곳이 같은 날
 *    노바티스 Phase 3 실패를 나란히 헤드라인으로 걸었다).
 *    그래서 headlineRank를 따로 담고, 다이제스트에서 "몇 개 매체가 헤드라인으로
 *    걸었나"를 순위 기준으로 쓴다(news-digest.ts).
 *
 * 두 매체가 같은 CMS를 쓰므로(`<div id="skin-N" class="auto-article">` 안에 `.item`)
 * 파서 하나로 처리된다. 구조가 바뀌면 0건이 되고, 그때는 조용히 건너뛴다 —
 * 인기기사를 못 읽었다고 다이제스트 전체가 멈추면 안 된다.
 */

import { DOMAIN_KEYWORDS } from './news-feeds';

/** 브라우저 UA를 쓴다 — 기본 UA로는 홈페이지가 다른 마크업을 주는 경우가 있다. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * 브라우저가 보내는 머리글을 같이 보낸다 — User-Agent 하나만으로는 막는 곳이 있다.
 * 다른 소스에는 영향이 없다(2026-09-11 확인: 전부 200 그대로).
 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
};

export interface PopularItem {
  title: string;
  url: string;
  source: string;
  /** 그 매체 인기기사 목록에서의 등수(1부터). */
  rank: number;
  /** 실제 조회수. 집계판이 공개하는 경우만 채워진다(bioin) — 등수보다 강한 신호다. */
  views?: number;
  /**
   * 그 매체 헤드라인 영역에서의 자리(1 = 최상단 히어로). 없으면 헤드라인이 아니다.
   * popularRank(조회수 순위)와는 다른 신호다 — 위 주석 ③ 참고.
   */
  headlineRank?: number;
  /** 국내 매체 기사인가. 국내 뉴스는 "엄청 큰 이슈만" 다루기로 해서 별도 기준을 적용한다. */
  domestic?: boolean;
  /**
   * 기사 발행일. 목록 페이지는 날짜를 주지 않으므로 URL에 박힌 날짜에서 뽑는다
   * (NYT·TechCrunch·CNBC 등 `/2026/09/08/` 형식). 못 뽑으면 undefined —
   * 그때는 저장소가 "우리가 처음 1면에서 본 시각"으로 대신한다.
   */
  date?: Date;
}

interface PopularSource {
  name: string;
  /** 인기기사 목록 페이지. 홈페이지 사이드바보다 안정적이다. */
  url: string;
  origin: string;
  domain: 'ai' | 'bio';
  /**
   * 'cms'      언론사 CMS의 인기기사 박스
   * 'bioin'    정부 집계판(표 형식, 조회수 있음)
   * 'headline' 매체 첫 화면의 헤드라인 영역(편집자 판단) — headline 스펙을 함께 준다
   */
  kind: 'cms' | 'bioin' | 'headline' | 'alphasignal';
  headline?: HeadlineSpec;
  domestic?: boolean;
}

/**
 * 헤드라인 영역을 어디서부터 어디까지로 볼지.
 *
 * 세 매체가 CMS도 마크업도 전부 다르지만 하는 일은 같다 — "첫 화면 특정 구역 안의
 * 기사 링크를 위에서부터 읽는다". 그래서 파서를 하나로 두고 구역 경계와 링크 판별만
 * 매체별로 준다. 마커를 못 찾으면 0건이 되고 조용히 건너뛴다.
 */
interface HeadlineSpec {
  /** 헤드라인 구역이 시작되는 마크업 조각. */
  start: string;
  /** 구역의 끝. 없으면 window 바이트까지 본다. */
  end?: string;
  window?: number;
  /** 기사 링크로 인정할 URL 패턴. 태그·섹션·저자 링크를 걸러낸다. */
  article: RegExp;
  /** 제외할 URL 패턴 — 협찬 기사 등. */
  skip?: RegExp;
  /** 제목에서 떼어낼 접두어(유료 표시 등). 매체 간 제목 대조를 방해한다. */
  stripTitle?: RegExp;
  /** 같은 화면의 "많이 본" 구역. 있으면 popularRank로 따로 담는다. */
  popularStart?: string;
  popularWindow?: number;
  /**
   * 제목이 이 분야인지 확인한다. 종합 홈페이지를 읽을 때 필요하다 —
   * 첫 화면에는 소비자 가전·정치 기사가 함께 놓이는데, 그것까지 우리 후보로
   * 넣으면 분야가 흐려진다. 없으면 확인하지 않는다(전문지 첫 화면).
   */
  topic?: RegExp;
}

export const SOURCES: PopularSource[] = [
  {
    name: 'AI타임스',
    url: 'https://www.aitimes.com/news/articleList.html?view_type=sm&box_idxno=20',
    origin: 'https://www.aitimes.com',
    domain: 'ai',
    kind: 'cms',
    domestic: true,
  },
  {
    name: 'AI타임스코리아',
    url: 'https://www.aitimes.kr/news/articleList.html?box_idxno=20&view_type=sm',
    origin: 'https://www.aitimes.kr',
    domain: 'ai',
    kind: 'cms',
    domestic: true,
  },
  {
    // 생명공학정책연구센터(bioin)가 국내 매체 기사를 모아 조회수로 줄 세운 집계판.
    // 한 매체의 인기가 아니라 여러 매체를 가로지른 순위이고, 출처와 실제 조회수까지
    // 함께 주므로 우리가 얻을 수 있는 가장 강한 국내 참여도 신호다.
    // 기간은 최근 2주로 잡는다 — 너무 좁으면 표본이 적고, 넓으면 지난 이슈가 남는다.
    name: '바이오인 집계',
    url: 'https://www.bioin.or.kr/hbrd_News.do?cmd=list&bid=todaynews&listCnt=15&sortType=popular&s_key=title&s_str=&cl_code=',
    origin: 'https://www.bioin.or.kr',
    domain: 'bio',
    kind: 'bioin',
    domestic: true,
  },
  {
    // 임상·거래 속보를 가장 빠르고 촘촘하게 다루는 곳. 히어로 1건 + 우측 리스트 5건이
    // 그날의 편집 판단이다. /sponsored/ 는 광고라 제외한다.
    name: 'FierceBiotech',
    url: 'https://www.fiercebiotech.com/biotech',
    origin: 'https://www.fiercebiotech.com',
    domain: 'bio',
    kind: 'headline',
    headline: {
      start: 'featured-hero',
      window: 30_000,
      article: /^(https:\/\/www\.fiercebiotech\.com)?\/(biotech|pharma|medtech|cro|research|life-sciences)\/[a-z0-9-]{12,}/,
      skip: /\/sponsored\//,
    },
  },
  {
    // 바이오파마 업계지. 첫 화면 epn_home_featured 구역이 헤드라인이고, 그 안에서
    // epn_big 카드가 최상단이다. 제목에 소프트하이픈(&shy;)이 박혀 있어 decode에서 뗀다.
    name: 'Endpoints News',
    url: 'https://endpoints.news/',
    origin: 'https://endpoints.news',
    domain: 'bio',
    kind: 'headline',
    headline: {
      start: 'epn_regular_section epn_home_featured',
      window: 30_000,
      article: /^https:\/\/endpoints\.news\/[a-z0-9-]{12,}/,
      // 같은 화면 아래쪽에 Most Read도 있다 — 편집 판단과 독자 반응을 함께 얻는다.
      popularStart: 'Most Read',
      popularWindow: 9_000,
    },
  },
  {
    // 바이오파마 업계지. 첫 화면 기사 목록이 서버 렌더라 문서 순서를 그대로 쓴다.
    // AI 쪽에 1면 스크랩을 붙이면서(TechCrunch·Wired·NYT) 바이오도 같은 수를 갖추려고
    // 추가했다(2026-09-09). BioCentury도 후보였지만 첫 화면이 JS 렌더라 못 읽는다.
    name: 'BioPharma Dive',
    url: 'https://www.biopharmadive.com/',
    origin: 'https://www.biopharmadive.com',
    domain: 'bio',
    kind: 'headline',
    headline: {
      // Wired와 같은 이유로 링크 패턴을 시작점으로 쓴다 — 클래스 이름은 CSS 블록에
      // 먼저 걸릴 위험이 있다.
      start: 'href="/news/',
      window: 45_000,
      article: /^(https:\/\/www\.biopharmadive\.com)?\/news\/[a-z0-9-]{10,}/,
      skip: /\/sponsored|\/press-release/i,
    },
  },
  {
    // 보건·바이오 전반. 헤드라인(TOP STORIES)과 많이 본(Most Read)을 한 화면에서
    // 같이 주므로 두 신호를 동시에 얻는다. 'STAT Plus:' 접두어는 유료 표시일 뿐이라
    // 떼어낸다 — 붙여두면 다른 매체 제목과 대조가 안 된다.
    name: 'STAT News',
    url: 'https://www.statnews.com/',
    origin: 'https://www.statnews.com',
    domain: 'bio',
    kind: 'headline',
    headline: {
      start: 'wp-block-stat-home-top-stories',
      end: 'Most Read',
      article: /^https:\/\/www\.statnews\.com\/\d{4}\/\d{2}\/\d{2}\//,
      skip: /\/sponsor/,
      stripTitle: /^STAT Plus:\s*/,
      popularStart: 'card-item slider most-read',
      popularWindow: 9_000,
    },
  },
  {
    // AlphaSignal — AI 소식을 모아 업보트로 줄 세우는 곳. RSS가 없어(/feed 404)
    // 첫 화면을 읽고 업보트로 등수를 매긴다(parseAlphaSignal).
    //
    // 소셜 시그널에도 같은 곳을 넣었다(social-collect의 'alphasignal') — 업보트 자체는
    // 커뮤니티 반응이고, 여기서는 그 반응이 붙은 기사를 뉴스 후보로 쓴다. 같은 URL이
    // 양쪽에 뜨는 것은 이름 카드에서 걸러낸다(entity-cards).
    name: 'AlphaSignal',
    url: 'https://alphasignal.ai/',
    origin: 'https://alphasignal.ai',
    domain: 'ai',
    kind: 'alphasignal',
  },
  {
    // 홈페이지 첫 화면 — 히어로 → 보조 카드 → Top Headlines 순으로 놓인다.
    //
    // 전에는 AI 카테고리 페이지(/category/artificial-intelligence/)를 읽었는데
    // 그게 틀렸다. 그 페이지는 편집 순서가 아니라 최신순이다 — 시간 표기가
    // 1→3→4→5→5→6→7시간 전으로 정확히 내려간다(2026-09-10 실측). 그래서 "1시간 전에
    // 올라온 기사"가 매체의 머리기사로 인정돼 순위 맨 위로 올라왔다.
    // 홈페이지 첫 화면은 사람이 고른 자리이므로 그쪽을 읽는다.
    //
    // 대신 홈페이지에는 AI가 아닌 기사(소비자 가전·정치)가 섞이므로 topic으로 가른다.
    name: 'TechCrunch',
    url: 'https://techcrunch.com/',
    origin: 'https://techcrunch.com',
    domain: 'ai',
    kind: 'headline',
    headline: {
      // 첫 기사 링크부터 읽는다. 히어로가 문서상 가장 먼저 온다.
      start: 'href="https://techcrunch.com/20',
      window: 45_000,
      article: /^https:\/\/techcrunch\.com\/20\d\d\/\d\d\/\d\d\/[a-z0-9-]{10,}/,
      // 자사 행사 홍보는 편집 판단이 아니라 광고다.
      skip: /disrupt|\/events?\/|side-event|sponsored/i,
      topic: DOMAIN_KEYWORDS.ai,
    },
  },
  {
    // AI 태그 첫 화면. 링크가 /story/... 상대경로다.
    name: 'Wired',
    url: 'https://www.wired.com/',
    origin: 'https://www.wired.com',
    domain: 'ai',
    kind: 'headline',
    headline: {
      // 첫 기사 링크 자체를 시작점으로 쓴다. 클래스 이름을 마커로 쓰려 했더니
      // 'summary-item__content'가 CSS 블록에 먼저 나와서(본문보다 369KB 앞) 창이
      // 기사에 닿지 못하고 0건이 됐다. 링크 패턴은 그런 오작동이 없다.
      start: 'href="/story/',
      window: 60_000,
      article: /^(https:\/\/www\.wired\.com)?\/story\/[a-z0-9-]{10,}/,
      skip: /\/sponsored|\/gear\/(deal|coupon)/i,
      // TechCrunch와 같은 이유로 태그 페이지가 아니라 홈페이지를 읽고 분야를 가른다.
      topic: DOMAIN_KEYWORDS.ai,
    },
  },
  {
    // 기술 섹션. data-testid가 안정적인 마커다(class는 해시라 배포마다 바뀐다).
    name: 'New York Times Tech',
    url: 'https://www.nytimes.com/section/technology',
    origin: 'https://www.nytimes.com',
    domain: 'ai',
    kind: 'headline',
    headline: {
      start: 'data-testid="main-collection"',
      window: 45_000,
      article: /^(https:\/\/www\.nytimes\.com)?\/20\d\d\/\d\d\/\d\d\/[a-z/]+\/[a-z0-9-]{10,}\.html/,
      // 기술 섹션 첫 화면은 편집 큐레이션이라 그대로 쓴다(HTML에 시간 표기가 없어
      // 최신순인지 확인할 방법이 없었지만, 실제 1위가 그날 최대 사안이었다).
      // 다만 기술 섹션에도 소비자 기기·통신 정책 기사가 있어 분야는 가른다.
      topic: DOMAIN_KEYWORDS.ai,
    },
  },
  {
    // 기술 전반. 홈페이지 Most Popular 블록이 서버 렌더라 그대로 읽힌다.
    // 헤드라인 영역은 따로 잡지 않는다 — 이 매체는 소비자 기기 기사가 상단을 많이
    // 차지해서, 편집 판단보다 독자 반응(Most Popular) 쪽이 우리 관심사에 가깝다.
    name: 'The Verge',
    url: 'https://www.theverge.com/',
    origin: 'https://www.theverge.com',
    domain: 'ai',
    kind: 'headline',
    headline: {
      // 헤드라인 구역은 비워 두고 인기 구역만 읽는다 — start를 없는 문자열로 두면
      // cut()이 빈 문자열을 돌려주고 헤드라인은 0건이 된다.
      start: '\u0000없음',
      article: /^(https:\/\/www\.theverge\.com)?\/[a-z]+\/\d{4,}\/[a-z0-9-]{10,}/,
      popularStart: 'duet--homepage--most-popular',
      popularWindow: 9_000,
    },
  },
];

/** 다른 매체의 인기 목록은 못 읽는다(2026-09-09 실측).
 *  · Ars Technica — "Most read"가 카테고리 선택 폼이고 목록은 그 뒤에 JS로 채워진다.
 *  · CNBC · MIT Technology Review — 마커만 있고 링크는 JS 렌더다.
 *  · The Economist — 홈페이지가 403(봇 차단).
 *  이들은 RSS로만 들어온다. HTML 파싱을 붙이려면 헤드리스 브라우저가 필요한데,
 *  그만한 값어치가 있는지는 확인되지 않았다.
 */

/** 인기·1면을 긁는 매체 이름. 교차 보도 확인에서 "신뢰하는 매체" 판정에 함께 쓴다. */
export const POPULAR_SOURCE_NAMES = SOURCES.map(s => s.name);

/** bioin은 조회 기간을 URL로 받는다 — 호출 시점 기준 최근 N일. */
const BIOIN_DAYS = 14;
const ymdSlash = (d: Date) =>
  `${d.getFullYear()}%2F${String(d.getMonth() + 1).padStart(2, '0')}%2F${String(d.getDate()).padStart(2, '0')}`;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
   // 소프트하이픈은 떼어낸다 — Endpoints 제목에 단어마다 박혀 있어(No&shy;var&shy;tis)
   // 그대로 두면 눈에는 안 보이지만 매체 간 제목 대조와 검색이 전부 실패한다.
   .replace(/&shy;/g, '').replace(/\u00ad/g, '')
   // 숫자 엔티티(&#34; &#39;)도 푼다 — bioin 제목에 그대로 남아 화면에 노출됐다.
   .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
   .replace(/&amp;/g, '&')
   .replace(/<[^>]+>/g, '')
   .replace(/\s+/g, ' ')
   .trim();

/** 한 매체에서 최대 몇 위까지 가져올지. 아래로 갈수록 "인기"의 뜻이 옅어진다. */
const MAX_RANK = 10;

/**
 * bioin 집계판 — 표 한 줄이 [제목, 출처, 작성일시, 조회수]이고 제목에 원문 링크가 붙는다.
 * 링크가 원문 매체(hellodd·fnnews·etnews …)를 직접 가리키므로 우리가 다시 찾을 필요가 없다.
 */
function parseBioin(html: string, src: PopularSource): PopularItem[] {
  const out: PopularItem[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]{40,2000}?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => decode(m[1]));
    if (cells.length < 4) continue;                       // 헤더 행
    const href = row.match(/href="(https?:\/\/[^"]+)"/)?.[1];
    const title = cells[0];
    const views = Number(cells[3].replace(/[^\d]/g, ''));
    if (!href || title.length < 12 || !Number.isFinite(views)) continue;
    out.push({
      title,
      url: href,
      // 원문 매체명을 그대로 쓴다 — 집계판 이름으로 묶으면 매체별 상한이 무의미해진다.
      source: cells[1] || src.name,
      rank: out.length + 1,
      views,
      domestic: true,
    });
    if (out.length >= MAX_RANK) break;
  }
  if (out.length === 0) console.error(`[news-popular] ${src.name} 0건 — 표 구조가 바뀐 것 같습니다`);
  return out;
}

/**
 * 헤드라인 영역 — 구역을 잘라내고 그 안의 기사 링크를 위에서부터 읽는다.
 *
 * 순서가 곧 등수다. HTML 상의 순서는 화면의 시각적 순서와 대체로 일치하고(히어로가
 * 먼저 나온다), 어차피 우리가 쓰는 건 "1면에 걸렸나"와 "그중 위쪽인가" 정도의 해상도다.
 */
function parseHeadline(html: string, src: PopularSource): PopularItem[] {
  const spec = src.headline!;
  const cut = (start: string, end?: string, window = 30_000) => {
    let i = html.indexOf(start);
    if (i < 0) return '';
    // 시작점이 링크 패턴이면 그 링크를 감싼 <a까지 되돌아간다.
    //
    // 안 그러면 첫 기사가 통째로 사라진다: 자른 지점이 <a 태그 안쪽(href= 앞)이라
    // 아래 read()의 정규식이 여는 <a를 못 찾고, 그 기사를 건너뛴 다음 기사부터 1위로
    // 센다. 2026-09-11 실측 — TechCrunch 첫 화면 1면이 알리바바·딥시크 디스틸레이션
    // 기사였는데 우리가 읽은 1위는 그 다음 카드였다. 클래스 이름을 시작점으로 쓰는
    // 소스는 여는 태그 앞에서 잘리므로 이 문제가 없다.
    if (start.startsWith('href="')) {
      const open = html.lastIndexOf('<a', i);
      if (open >= 0 && i - open < 300) i = open;
    }
    let seg = html.slice(i, i + window);
    if (end) {
      // 마커 직후부터 찾는다 — 구역 시작 태그 자체에 끝 문자열이 들어 있을 수 있다.
      const j = seg.indexOf(end, start.length);
      if (j > 0) seg = seg.slice(0, j);
    }
    return seg;
  };

  const read = (seg: string, kind: 'headline' | 'popular'): PopularItem[] => {
    const out: PopularItem[] = [];
    const seen = new Set<string>();
    const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) && out.length < MAX_RANK) {
      const href = m[1];
      if (!spec.article.test(href)) continue;
      if (spec.skip?.test(href)) continue;
      let title = decode(m[2]);
      if (spec.stripTitle) title = title.replace(spec.stripTitle, '').trim();
      // 썸네일만 감싼 링크는 텍스트가 비거나 아주 짧다 — 같은 기사를 두 번 잡지 않게.
      if (title.length < 15) continue;
      // 종합 홈페이지에서는 분야를 가른다(HeadlineSpec.topic 주석 참고).
      if (spec.topic && !spec.topic.test(title)) continue;
      const url = href.startsWith('http') ? href : src.origin + href;
      if (seen.has(url)) continue;
      seen.add(url);
      const rank = out.length + 1;
      out.push({
        title,
        url,
        source: src.name,
        rank,
        domestic: src.domestic,
        ...(kind === 'headline' ? { headlineRank: rank } : {}),
      });
    }
    return out;
  };

  const head = read(cut(spec.start, spec.end, spec.window), 'headline');
  const pop = spec.popularStart
    ? read(cut(spec.popularStart, undefined, spec.popularWindow), 'popular')
    : [];

  // 헤드라인이면서 많이 본 기사이기도 한 경우 — 헤드라인 쪽을 남긴다(더 강한 신호다).
  const urls = new Set(head.map(h => h.url));
  const merged = [...head, ...pop.filter(p => !urls.has(p.url))];

  if (merged.length === 0) {
    console.error(`[news-popular] ${src.name} 헤드라인 0건 — 마크업이 바뀐 것 같습니다`);
  }
  return merged;
}

/**
 * AlphaSignal 첫 화면 — 항목마다 업보트가 붙어 있어 그것으로 등수를 매긴다.
 *
 * 마크업이 <article class="feed-item"> 안에 업보트(.feed-vote-n)와 제목(.feed-title > a)이
 * 같이 있는 구조다. 화면의 UPVOTES 정렬 탭은 자바스크립트라 URL로 부를 수 없어서,
 * 기본(최신) 화면을 읽고 업보트로 우리가 정렬한다 — 숫자가 같이 오므로 결과는 같다.
 */
function parseAlphaSignal(html: string, src: PopularSource): PopularItem[] {
  const rows: (PopularItem & { votes: number })[] = [];

  for (const block of html.match(/<article class="feed-item">[\s\S]{0,3000}?<\/article>/g) ?? []) {
    const votes = Number(block.match(/class="feed-vote-n">([\d,]+)</)?.[1]?.replace(/,/g, '') ?? '');
    const href = block.match(/class="feed-title"[^>]*>\s*<a[^>]*href="(\/news\/[a-z0-9-]+)"/)?.[1];
    const raw = block.match(/class="feed-title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1];
    if (!href || !raw) continue;
    // Next.js가 낱말 사이에 <!-- --> 주석을 넣는다 — 먼저 떼어야 제목이 붙는다.
    const title = decode(raw.replace(/<!--[\s\S]*?-->/g, ''));
    if (title.length < 12) continue;
    rows.push({
      title,
      url: src.origin + href,
      source: src.name,
      rank: 0,
      // 업보트를 views 자리에 담는다 — "매체가 공개한 실측 반응 수"라는 뜻이 같다.
      views: Number.isFinite(votes) ? votes : undefined,
      votes: Number.isFinite(votes) ? votes : 0,
    });
  }

  rows.sort((a, b) => b.votes - a.votes);
  const out = rows.slice(0, MAX_RANK).map(({ votes: _v, ...r }, i) => ({ ...r, rank: i + 1 }));
  if (out.length === 0) console.error(`[news-popular] ${src.name} 0건 — 마크업이 바뀐 것 같습니다`);
  return out;
}

/**
 * 블룸버그는 1면 스크랩 대상에 넣을 수 없다 — 2026-09-11 실측 기록.
 *
 * 넣으려 한 이유: 단독 스쿠프가 많은 곳인데 단독은 정의상 '함께 보도'가 0이라,
 * 1면 신호가 없으면 목록에 올라올 길이 없다(그날 EXCLUSIVE로 걸린
 * "OpenAI Is Open to Slowing Cutting-Edge AI"가 우리 목록에 없었다).
 *
 * 왜 못 하나:
 *   · Node(undici) fetch는 머리글과 무관하게 403이다. UA를 Chrome 124/128로 바꿔도,
 *     accept·accept-language·sec-fetch-*를 다 붙여도 마찬가지다. TLS 지문을 본다.
 *   · curl로는 처음 몇 번은 200이었다(975KB, 기사 링크 67개). 그런데 여덟 번쯤
 *     요청한 뒤부터 curl도 403이 됐다 — 지문이 아니라 요청 빈도·행동으로 막는다.
 *     즉 "몇 번은 되다가 막히는" 소스이고, 시간당 도는 수집에는 쓸 수 없다.
 *
 * robots.txt는 `/`와 `/news/articles/*`를 허용하므로 규칙 문제는 아니다. 기술적으로
 * 안정적으로 읽을 방법이 없을 뿐이다. 블룸버그 기사 자체는 RSS(news-feeds.ts)로
 * 정상 수집되며, 그 피드 순서는 발행순도 편집순도 아니라 1면 신호로 쓸 수 없다.
 * 다시 시도하려면 이 세 가지(403 조건·curl 차단 시점·피드 순서)를 먼저 재확인할 것.
 */
async function fetchOne(src: PopularSource): Promise<PopularItem[]> {
  try {
    let url = src.url;
    if (src.kind === 'bioin') {
      const now = new Date();
      const from = new Date(now.getTime() - BIOIN_DAYS * 86400_000);
      url += `&sdate=${ymdSlash(from)}&edate=${ymdSlash(now)}`;
    }
    const res = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const html = await res.text();

    if (src.kind === 'bioin') return parseBioin(html, src);
    if (src.kind === 'headline') return parseHeadline(html, src);
    if (src.kind === 'alphasignal') return parseAlphaSignal(html, src);

    // 목록 페이지는 기사 링크가 순위 순으로 나열된다. 제목은 링크 안쪽 텍스트다.
    const seen = new Set<string>();
    const out: PopularItem[] = [];
    const re = /<a\s+href="([^"]*articleView\.html\?idxno=\d+[^"]*)"[^>]*>([\s\S]{0,400}?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < MAX_RANK) {
      const href = m[1];
      const title = decode(m[2]);
      // 썸네일만 있는 링크는 텍스트가 비거나 아주 짧다 — 같은 기사가 두 번 잡히는 것을 막는다.
      if (title.length < 12) continue;
      const url = href.startsWith('http') ? href : src.origin + href;
      const key = url.replace(/[?&]view_type=[^&]*/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, url, source: src.name, rank: out.length + 1, domestic: src.domestic });
    }
    if (out.length === 0) console.error(`[news-popular] ${src.name} 인기기사 0건 — 마크업이 바뀐 것 같습니다`);
    return out;
  } catch (e) {
    console.error('[news-popular] 실패:', src.name, e);
    return [];
  }
}

/** 도메인의 인기기사 목록. 한 곳이 실패해도 나머지는 돌아온다. */
/**
 * URL에 박힌 발행일을 읽는다 — `/2026/09/08/`, `/2026-09-08/` 둘 다.
 *
 * 목록 페이지에는 날짜가 없어서 예전엔 1면에서 새로 발견한 기사를 전부 '오늘'로
 * 적었다. 그래서 9월 8일 NYT 기사가 화면에 2026-09-11로 떴고, '오늘' 탭이
 * 오늘 기사만 걸러내지도 못했다(2026-09-11).
 */
export function urlDate(url: string): Date | undefined {
  const m = url.match(/\/(20\d\d)[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])(?=[/-])/);
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  // 미래 날짜는 URL이 날짜가 아닌 숫자였다는 뜻이다.
  return isNaN(+d) || d.getTime() > Date.now() + 86_400_000 ? undefined : d;
}

export async function collectPopular(domain: 'ai' | 'bio'): Promise<PopularItem[]> {
  const targets = SOURCES.filter(s => s.domain === domain);
  if (targets.length === 0) return [];
  const results = await Promise.all(targets.map(fetchOne));
  // 어느 소스가 읽혔는지 한 줄로 남긴다. 매체가 데이터센터 IP를 막으면 로컬에서는
  // 되고 프로덕션에서만 조용히 0건이 되는데(FierceBiotech 403), 그러면 순위가
  // 왜 다른지 알 수 없다. 실패는 fetchOne이 따로 남기므로 여기서는 성공 건수만 센다.
  console.log('[news-popular]', domain,
    targets.map((t, i) => `${t.name}=${results[i].length}`).join(' '));
  return results.flat().map(it => ({ ...it, date: it.date ?? urlDate(it.url) }));
}
