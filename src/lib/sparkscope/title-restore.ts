/**
 * 잘린 기사 제목 되살리기 — 네이버 검색 결과는 긴 제목을 "…서울 DDP..."처럼 말줄임으로 잘라 준다
 * (2026-10-07 실측: 최근 2주 기사 5,347건 중 901건, 약 17%). 화면·메일·브리핑 어디서든 "…"로 끝나는
 * 제목이 나가므로 수집 단계에서 원문 페이지의 og:title을 읽어 원래 제목으로 바꾼다(소윤 요청).
 *
 * 안전장치: 앞부분이 같을 때만 바꾼다(엉뚱한 페이지·로그인 화면 방지). 실패하면 원래 제목 그대로 — 수집을 막지 않는다.
 * 구글 뉴스 중계 주소는 원문이 아니라 건너뛴다.
 */
export const TRUNCATED_TITLE = /(\.{2,}|…)\s*$/;

const decode = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = (s: string) => s.replace(/[^0-9a-zA-Z가-힣]/g, '');

export async function restoreTitle(title: string, link: string): Promise<string> {
  if (!TRUNCATED_TITLE.test(title) || !/^https?:\/\//.test(link) || link.includes('news.google.com')) return title;
  try {
    const r = await fetch(link, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const html = (await r.text()).slice(0, 200_000);
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    // 끝의 " - 매체명"/" | 매체명"은 뗀다
    const og = m ? decode(m[1]).replace(/\s+[-|]\s+[^-|]{1,20}$/, '').trim() : '';
    const head = title.replace(TRUNCATED_TITLE, '').trim();
    return og && og.length > head.length && norm(og).startsWith(norm(head).slice(0, 15)) ? og : title;
  } catch {
    return title;
  }
}

/** 여러 건을 동시에(최대 8개씩) 되살린다. 바뀐 건수를 돌려준다. */
export async function restoreTruncatedTitles<T extends { title: string; link: string }>(items: T[]): Promise<number> {
  const targets = items.filter(a => TRUNCATED_TITLE.test(a.title));
  let fixed = 0;
  for (let i = 0; i < targets.length; i += 8) {
    await Promise.all(targets.slice(i, i + 8).map(async a => {
      const full = await restoreTitle(a.title, a.link);
      if (full !== a.title) { a.title = full; fixed++; }
    }));
  }
  return fixed;
}
