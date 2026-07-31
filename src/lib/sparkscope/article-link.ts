// 백필 기사는 원문 링크가 없고 backfill://해시 형태의 더미 값만 있음 — 그대로 열면 빈 화면만 뜬다.
export function hasRealLink(link: string): boolean {
  return !link.startsWith('backfill://');
}

// 원문 링크를 못 찾은 백필 기사는 제목+매체로 구글 검색 결과라도 열어준다 (그냥 "링크 없음"보다 낫다).
export function searchFallbackUrl(title: string, source: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${source}`)}`;
}

// href로 바로 쓸 수 있는 안전한 링크 (실제 링크 있으면 그대로, 없으면 검색 폴백).
export function safeArticleHref(link: string, title: string, source: string): string {
  return hasRealLink(link) ? link : searchFallbackUrl(title, source);
}
