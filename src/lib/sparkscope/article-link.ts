// 백필 기사는 원문 링크가 없고 backfill://해시 형태의 더미 값만 있음 — 그대로 열면 빈 화면만 뜬다.
export function hasRealLink(link: string): boolean {
  if (link.startsWith('backfill://')) return false;
  // 구글 뉴스 중계주소(news.google.com/rss/articles/…)는 여기서 거르지 않는다.
  //
  // 예전에는 걸렀다. 2026-08-26 메모에 "따라가도 302가 아니라 200으로 구글 자체
  // 페이지가 뜬다"고 적혀 있었는데, 그건 서버에서 fetch로 받아 본 결과다. 실제
  // 브라우저에서는 자바스크립트가 언론사로 넘겨준다 — 2026-09-28에 브라우저로
  // 직접 확인했다:
  //   · 2026-09-28 기사 → it.chosun.com 본문까지 정상
  //   · 2017-08-09 기사 → finance.technews.tw 본문까지 정상 (9년 전 것도 열린다)
  //
  // 그래서 이 링크들을 "깨진 링크"로 보고 제목 검색으로 돌려보내던 것이 오히려
  // 문제였다. 멀쩡히 열리는 기사를 검색 결과로 바꿔 놓고 있었고, 그게
  // "원문 보기를 눌렀더니 기사가 아니라 검색창"의 정체였다. 최근 14일 기사의
  // 약 35%가 이 경로였다.
  return true;
}

/**
 * 원문 링크가 아예 없는 기사(백필 더미)를 보낼 곳 — 제목+매체로 구글 검색.
 *
 * 네이버 뉴스 검색으로 바꿔 봤다가 되돌렸다(2026-09-28). 네이버는 제목이 조금만
 * 길어도 "검색결과가 없습니다"를 내놓는다. 구글은 적어도 결과가 나온다.
 */
export function searchFallbackUrl(title: string, source: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${source}`)}`;
}

// href로 바로 쓸 수 있는 안전한 링크 (실제 링크 있으면 그대로, 없으면 검색 폴백).
export function safeArticleHref(link: string, title: string, source: string): string {
  return hasRealLink(link) ? link : searchFallbackUrl(title, source);
}
