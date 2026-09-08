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
}

interface PopularSource {
  name: string;
  /** 인기기사 목록 페이지. 홈페이지 사이드바보다 안정적이다. */
  url: string;
  origin: string;
  domain: 'ai' | 'bio';
}

const SOURCES: PopularSource[] = [
  {
    name: 'AI타임스',
    url: 'https://www.aitimes.com/news/articleList.html?view_type=sm&box_idxno=20',
    origin: 'https://www.aitimes.com',
    domain: 'ai',
  },
  {
    name: 'AI타임스코리아',
    url: 'https://www.aitimes.kr/news/articleList.html?box_idxno=20&view_type=sm',
    origin: 'https://www.aitimes.kr',
    domain: 'ai',
  },
];

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
   .replace(/&amp;/g, '&')
   .replace(/<[^>]+>/g, '')
   .replace(/\s+/g, ' ')
   .trim();

/** 한 매체에서 최대 몇 위까지 가져올지. 아래로 갈수록 "인기"의 뜻이 옅어진다. */
const MAX_RANK = 10;

async function fetchOne(src: PopularSource): Promise<PopularItem[]> {
  try {
    const res = await fetch(src.url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const html = await res.text();

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
      out.push({ title, url, source: src.name, rank: out.length + 1 });
    }
    if (out.length === 0) console.error(`[news-popular] ${src.name} 인기기사 0건 — 마크업이 바뀐 것 같습니다`);
    return out;
  } catch (e) {
    console.error('[news-popular] 실패:', src.name, e);
    return [];
  }
}

/**
 * 도메인의 인기기사 목록. 한 곳이 실패해도 나머지는 돌아온다.
 * 지금은 AI 도메인만 있다 — 바이오 쪽에 같은 형식으로 순위를 내는 국내 매체를 찾으면 추가한다.
 */
export async function collectPopular(domain: 'ai' | 'bio'): Promise<PopularItem[]> {
  const targets = SOURCES.filter(s => s.domain === domain);
  if (targets.length === 0) return [];
  const results = await Promise.all(targets.map(fetchOne));
  return results.flat();
}
