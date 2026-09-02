/**
 * 화면에 쓸 기사 제목을 언어에 맞게 고른다.
 *
 * Article.title은 "원문 그대로"다 — 국내 기사는 한국어지만 대만 기사는 번체 중문이다.
 * 번역은 두 캐시 컬럼에 들어간다:
 *   titleKo — 원문이 한국어가 아닐 때만 채워진다 (ensureArticleKo)
 *   titleEn — 원문이 영어가 아닐 때 채워진다   (ensureArticleEn)
 *
 * 그래서 언어별로 봐야 할 컬럼이 다르고, 없으면 원문으로 떨어진다.
 * 화면이 비는 것보다 원문이라도 보이는 게 낫다.
 *
 * ⚠️ 렌더링에만 쓴다. 군집화·중복 판정·검색 fallback은 계속 title(원문)을 기준으로 해야
 *    언어를 바꿔도 묶음 결과가 달라지지 않는다.
 */
export type TitleFields = {
  title: string;
  titleKo?: string | null;
  titleEn?: string | null;
};

export function articleTitle(a: TitleFields, locale: 'ko' | 'en'): string {
  if (locale === 'en') return a.titleEn || a.title;
  return a.titleKo || a.title;
}
