// 백필 기사는 원문 링크가 없고 backfill://해시 형태의 더미 값만 있음 — 그대로 열면 빈 화면만 뜬다.
export function hasRealLink(link: string): boolean {
  if (link.startsWith('backfill://')) return false;
  // 구글 뉴스 RSS 링크(news.google.com/rss/articles/...)는 원문 URL이 아니라 리다이렉트 페이지다.
  // 실제로 따라가도 302가 아니라 200으로 구글 자체 페이지가 뜨기 때문에(2026-08-26 확인),
  // 그대로 열면 기사 대신 빈 구글 화면만 보인다. 백필과 같은 검색 폴백으로 넘긴다.
  if (/^https?:\/\/news\.google\.com\/rss\/articles\//.test(link)) return false;
  return true;
}

// 원문 링크를 못 찾은 백필 기사는 제목+매체로 구글 검색 결과라도 열어준다 (그냥 "링크 없음"보다 낫다).
export function searchFallbackUrl(title: string, source: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${source}`)}`;
}

// href로 바로 쓸 수 있는 안전한 링크 (실제 링크 있으면 그대로, 없으면 검색 폴백).
export function safeArticleHref(link: string, title: string, source: string): string {
  return hasRealLink(link) ? link : searchFallbackUrl(title, source);
}
