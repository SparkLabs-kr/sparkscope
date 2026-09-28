/**
 * 구글 뉴스 중계주소를 네이버 뉴스 검색으로 되찾는다.
 *
 * 왜 필요한가: 구글 뉴스 검색으로 수집한 기사는 link가
 * news.google.com/rss/articles/CBMi… 중계주소다. 그대로 열면 기사가 아니라 구글
 * 화면이 떠서, 화면 쪽은 제목 검색으로 돌려보낸다(article-link.ts). 그래서 "원문
 * 보기를 눌렀는데 구글 검색창이 뜬다"는 신고가 반복됐다.
 * 2026-09-28 실측: 최근 14일 기사 5,697건 중 2,192건(38.5%)이 이 상태였다.
 *
 * 왜 구글 해석기만으로는 안 되나: batchexecute 해석기(google-news-resolver.ts)는
 * 동작하지만 구글이 몇십 건 단위로 막는다. 같은 날 12건을 풀자마자 다음 호출이
 * 전부 실패했다. 2,000건대 적체를 풀 수단이 못 된다.
 *
 * 그래서 네이버를 쓴다. 이 기사들은 대부분 국내 매체다(연합뉴스·머니투데이·전자신문·
 * 조선비즈 순). 제목으로 뉴스 검색을 하면 언론사 원문 주소가 그대로 나온다.
 * 표본 25건 실측 복구율 84%.
 *
 * 주의: 네이버 검색 결과 마크업은 바뀐다. 예전 기준(news_tit 클래스)은 2026-09-28에
 * 이미 죽어 있었고 지금은 sds-comps 컴포넌트다. 제목 링크를 가리키는
 * data-heatmap-target=".tit"만 두 시기 모두에서 살아 있어 그것을 기준으로 삼는다.
 * 0건이 계속 나오면 마크업이 또 바뀐 것이니 이 주석부터 확인할 것.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

/** 제목 비교용 정규화 — 공백·문장부호·태그를 모두 지운다. 매체마다 표기가 조금씩 다르다. */
const norm = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase();

/** 구글 뉴스가 제목 끝에 붙이는 " - 매체명"을 뗀다. 검색어로 쓰면 결과가 줄어든다. */
const stripOutlet = (t: string) => t.replace(/\s*-\s*[^-]{2,14}$/, '');

export const isGoogleRelayLink = (link: string) =>
  /^https?:\/\/news\.google\.com\/rss\/articles\//.test(link);

/** 네이버 뉴스 검색 결과 페이지 — 원문을 못 찾았을 때 보내는 곳. */
export const naverSearchUrl = (title: string) =>
  `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(stripOutlet(title).slice(0, 60))}`;

async function search(title: string): Promise<{ title: string; url: string }[]> {
  const res = await fetch(naverSearchUrl(title), {
    headers: { 'user-agent': UA, 'accept-language': 'ko' },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const out: { title: string; url: string }[] = [];
  for (const m of html.matchAll(
    /<a[^>]*href="([^"]+)"[^>]*data-heatmap-target="\.tit"[^>]*>([\s\S]{0,400}?)<\/a>/g,
  )) {
    out.push({ url: m[1]!, title: norm(m[2]!).replace(/새창열림$/, '') });
  }
  return out;
}

/**
 * 같은 기사인지 — 짧은 쪽의 앞부분이 긴 쪽에 통째로 들어 있는지로 본다.
 *
 * 매체마다 제목을 줄이거나 부제를 덧붙여서 완전 일치는 거의 없다. 대신 앞부분은
 * 잘 안 바뀐다. 최소 12자는 맞아야 하고(짧은 제목이 아무 데나 걸리는 것을 막는다),
 * 그보다 길면 6할까지 본다.
 */
function sameArticle(want: string, got: string): boolean {
  if (!want || !got) return false;
  const [short, long] = want.length <= got.length ? [want, got] : [got, want];
  if (short.length < 8) return false;
  const need = Math.max(12, Math.floor(short.length * 0.6));
  return long.includes(short.slice(0, need));
}

/**
 * 제목으로 원문 주소를 찾는다.
 *
 * 세 가지를 구분해서 돌려준다. 이게 중요하다 — "결과가 하나도 없다"와 "찾았는데
 * 같은 기사가 없다"는 다른 상황인데, 둘을 똑같이 null로 뭉치면 속도 제한에 걸린
 * 것을 "그 기사는 네이버에 없다"로 잘못 기록한다. 실제로 그렇게 당했다:
 * 2026-09-28에 0.5초 간격으로 600건을 돌렸더니 앞 100건은 79건 복구됐는데
 * 그 뒤 500건이 전부 실패로 찍혔다. 같은 기사들을 1.2초 간격으로 다시 돌리니
 * 12건 중 12건이 복구됐다. 네이버가 막은 게 아니라 우리가 너무 빨랐던 것이다.
 *
 * 검색 결과 자체가 0건이면 속도 제한으로 본다. 제목으로 뉴스 검색을 하면 같은
 * 사건을 쓴 기사가 보통 여러 건 나오므로, 0건은 정상적인 응답이 아니다.
 *
 * 언론사 원문을 네이버 자체 기사 페이지(n.news.naver.com)보다 앞에 둔다 —
 * 검색 결과가 언론사 주소를 먼저 주므로 순서를 그대로 쓰면 된다.
 */
export type NaverResult =
  | { status: 'found'; url: string }
  | { status: 'nomatch' }
  | { status: 'throttled' };

export async function lookupViaNaver(title: string): Promise<NaverResult> {
  const hits = await search(title).catch(() => []);
  if (hits.length === 0) return { status: 'throttled' };
  const want = norm(stripOutlet(title));
  const hit = hits.find(h => sameArticle(want, h.title));
  return hit ? { status: 'found', url: hit.url } : { status: 'nomatch' };
}

/** 주소만 필요할 때. 속도 제한과 불일치를 구분하지 않는다. */
export async function resolveViaNaver(title: string): Promise<string | null> {
  const r = await lookupViaNaver(title);
  return r.status === 'found' ? r.url : null;
}
