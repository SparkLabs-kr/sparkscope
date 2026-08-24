import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale, type Locale } from './locales';
import { makeT, type Translate } from './translate';

// 서버 컴포넌트에서 쓰는 언어 조회. 쿠키가 없으면 기본(한국어).
export function getLocale(): Locale {
  return normalizeLocale(cookies().get(LOCALE_COOKIE)?.value);
}

export function getT(): Translate {
  return makeT(getLocale());
}
