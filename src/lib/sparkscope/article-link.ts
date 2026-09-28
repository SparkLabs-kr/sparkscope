// 백필 기사는 원문 링크가 없고 backfill://해시 형태의 더미 값만 있음 — 그대로 열면 빈 화면만 뜬다.
export function hasRealLink(link: string): boolean {
  if (link.startsWith('backfill://')) return false;
  // 구글 뉴스 RSS 링크(news.google.com/rss/articles/...)는 원문 URL이 아니라 리다이렉트 페이지다.
  // 실제로 따라가도 302가 아니라 200으로 구글 자체 페이지가 뜨기 때문에(2026-08-26 확인),
  // 그대로 열면 기사 대신 빈 구글 화면만 보인다. 백필과 같은 검색 폴백으로 넘긴다.
  if (/^https?:\/\/news\.google\.com\/rss\/articles\//.test(link)) return false;
  return true;
}

/**
 * 원문 주소를 못 구한 기사를 보낼 곳.
 *
 * 한국어 제목이면 네이버 뉴스 검색으로 보낸다. 구글 웹검색은 블로그·쇼핑·커뮤니티가
 * 섞여 나와서 기사를 다시 찾아야 하는데, 뉴스 검색은 같은 사건을 쓴 기사 목록이
 * 바로 나오고 대개 첫 줄이 그 기사다. "원문 보기를 눌렀더니 검색창"이라는 불만의
 * 절반은 여기서 줄어든다(2026-09-28).
 *
 * 애초에 여기까지 오는 기사를 줄이는 것이 본 해결이다 — 구글 중계주소는
 * naver-resolver.ts가 원문 주소로 되돌리고(표본 복구율 84~92%), 이 폴백은 그래도
 * 못 찾은 나머지를 위한 자리다.
 *
 * 매체명을 검색어에 넣지 않는다. 네이버 뉴스 검색은 매체명을 제목의 일부로 보고
 * 찾으려 들어서 오히려 결과가 줄어든다. 제목만으로 충분하다.
 */
export function searchFallbackUrl(title: string, source: string): string {
  const clean = title.replace(/\s*-\s*[^-]{2,14}$/, '').slice(0, 60);
  if (/[가-힣]/.test(title)) {
    return `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(clean)}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${source}`)}`;
}

// href로 바로 쓸 수 있는 안전한 링크 (실제 링크 있으면 그대로, 없으면 검색 폴백).
export function safeArticleHref(link: string, title: string, source: string): string {
  return hasRealLink(link) ? link : searchFallbackUrl(title, source);
}
