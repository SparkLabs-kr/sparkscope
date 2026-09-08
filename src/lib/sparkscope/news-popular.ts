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
 * 두 매체가 같은 CMS를 쓰므로(`<div id="skin-N" class="auto-article">` 안에 `.item`)
 * 파서 하나로 처리된다. 구조가 바뀌면 0건이 되고, 그때는 조용히 건너뛴다 —
 * 인기기사를 못 읽었다고 다이제스트 전체가 멈추면 안 된다.
 */

/** 브라우저 UA를 쓴다 — 기본 UA로는 홈페이지가 다른 마크업을 주는 경우가 있다. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface PopularItem {
  title: string;
  url: string;
  source: string;
  /** 그 매체 인기기사 목록에서의 등수(1부터). */
  rank: number;
  /** 실제 조회수. 집계판이 공개하는 경우만 채워진다(bioin) — 등수보다 강한 신호다. */
  views?: number;
  /** 국내 매체 기사인가. 국내 뉴스는 "엄청 큰 이슈만" 다루기로 해서 별도 기준을 적용한다. */
  domestic?: boolean;
}

interface PopularSource {
  name: string;
  /** 인기기사 목록 페이지. 홈페이지 사이드바보다 안정적이다. */
  url: string;
  origin: string;
  domain: 'ai' | 'bio';
  /** 'cms' 언론사 CMS의 인기기사 박스 · 'bioin' 정부 집계판(표 형식, 조회수 있음) */
  kind: 'cms' | 'bioin';
  domestic?: boolean;
}

const SOURCES: PopularSource[] = [
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
];

/** bioin은 조회 기간을 URL로 받는다 — 호출 시점 기준 최근 N일. */
const BIOIN_DAYS = 14;
const ymdSlash = (d: Date) =>
  `${d.getFullYear()}%2F${String(d.getMonth() + 1).padStart(2, '0')}%2F${String(d.getDate()).padStart(2, '0')}`;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
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

async function fetchOne(src: PopularSource): Promise<PopularItem[]> {
  try {
    let url = src.url;
    if (src.kind === 'bioin') {
      const now = new Date();
      const from = new Date(now.getTime() - BIOIN_DAYS * 86400_000);
      url += `&sdate=${ymdSlash(from)}&edate=${ymdSlash(now)}`;
    }
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const html = await res.text();

    if (src.kind === 'bioin') return parseBioin(html, src);

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
export async function collectPopular(domain: 'ai' | 'bio'): Promise<PopularItem[]> {
  const targets = SOURCES.filter(s => s.domain === domain);
  if (targets.length === 0) return [];
  const results = await Promise.all(targets.map(fetchOne));
  return results.flat();
}
