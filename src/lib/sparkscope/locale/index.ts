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
import { enUS } from './en-US';
import { localeOfCategory, type Locale, type LanguagePack } from './types';

export type { Locale, LanguagePack, LocaleMedia } from './types';
export { localeOfCategory } from './types';

export const PACKS: Record<Locale, LanguagePack> = {
  'ko-KR': koKR,
  'zh-TW': zhTW,
  'en-US': enUS,
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
 *
 * 영문(en-US)은 여기서 일부러 null로 남긴다. 이 함수는 "영문 화면에 내보내려면
 * 번역이 필요한가"를 묻는 자리이고, 영문 원문은 그 답이 "아니오"다. 라틴 문자를
 * en-US로 잡으면 영문 제목이 영→영 번역 큐에 들어가 LLM을 낭비하고 제목이 변형된다
 * (translate-content.ts:230이 지금은 원문을 titleEn에 그대로 복사해 처리를 끝낸다).
 * 한국어 화면용 원문 판정은 detectSourceLocale을 쓴다.
 */
export function detectLocale(text: string | null | undefined): Locale | null {
  if (!text) return null;
  if (zhTW.hasScript(text)) return 'zh-TW';
  if (koKR.hasScript(text)) return 'ko-KR';
  return null;
}

/**
 * 원문이 무슨 언어인가 — detectLocale과 달리 영문까지 답한다.
 *
 * 비대칭이라 함수를 둘로 나눴다: 영문 원문은 영문 화면엔 번역이 필요 없지만
 * 한국어 화면(titleKo)엔 필요하다. 한글·한자가 없고 라틴 문자가 있으면 영문으로 본다.
 */
export function detectSourceLocale(text: string | null | undefined): Locale | null {
  const detected = detectLocale(text);
  if (detected) return detected;
  return enUS.hasScript(text) ? 'en-US' : null;
}

/** 번역이 필요한가 — 어느 팩이든 자기 문자를 가지고 있으면 대상이다. */
export function needsTranslationAnyLocale(text: string | null | undefined): boolean {
  return detectLocale(text) !== null;
}
