/**
 * 언어 팩 레지스트리 — 파이프라인이 여기만 보고 로케일별 로직을 가져간다.
 *
 * 새 오피스 추가 절차:
 *   1. locale/<code>.ts 에 팩 하나 (매체 목록 · 위기 키워드 · 번역 힌트)
 *   2. Locale 유니온에 코드 추가
 *   3. PACKS에 한 줄 등록
 * analyzer.ts·translate-content.ts·prompts.ts는 건드리지 않는다 — 그게 목적이다.
 */
import type { Category } from '../types';
import { koKR } from './ko-KR';
import { zhTW } from './zh-TW';
import { localeOfCategory, type Locale, type LanguagePack } from './types';

export type { Locale, LanguagePack, LocaleMedia } from './types';
export { localeOfCategory } from './types';

export const PACKS: Record<Locale, LanguagePack> = {
  'ko-KR': koKR,
  'zh-TW': zhTW,
};

export const DEFAULT_LOCALE: Locale = 'ko-KR';

/** 로케일로 팩을 가져온다. 모르는 값이면 한국으로 떨어뜨린다(화면이 비는 것보다 낫다). */
export function packFor(locale: Locale | string | null | undefined): LanguagePack {
  return PACKS[(locale ?? '') as Locale] ?? PACKS[DEFAULT_LOCALE];
}

/** 카테고리로 팩을 가져온다 — DB에 locale 컬럼이 생기기 전까지 쓰는 다리. */
export function packForCategory(category: Category | string): LanguagePack {
  return packFor(localeOfCategory(category));
}

/**
 * 본문 문자로 로케일을 추정한다. 카테고리를 모르는 자리(번역 큐 등)에서 쓴다.
 * 한자가 있으면 zh-TW, 한글이 있으면 ko-KR. 둘 다 없으면 null(번역할 것 없음).
 *
 * 한자를 먼저 보는 이유 — 한국 기사 제목에 한자가 섞이는 경우는 드물지만
 * 대만 기사에 한글이 섞이는 경우는 사실상 없다. 오판 방향을 대만 쪽으로 둔다.
 */
export function detectLocale(text: string | null | undefined): Locale | null {
  if (!text) return null;
  if (zhTW.hasScript(text)) return 'zh-TW';
  if (koKR.hasScript(text)) return 'ko-KR';
  return null;
}

/** 번역이 필요한가 — 어느 팩이든 자기 문자를 가지고 있으면 대상이다. */
export function needsTranslationAnyLocale(text: string | null | undefined): boolean {
  return detectLocale(text) !== null;
}
