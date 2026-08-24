import { EN } from './en';
import type { Locale } from './locales';

export type Translate = (ko: string, vars?: Record<string, string | number>) => string;

function interpolate(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

/**
 * 번역 키는 한국어 원문 그대로다. 사전(en.ts)에 없으면 한국어가 그대로 나오므로
 * 번역이 빠진 문구가 화면을 깨뜨리지 않는다.
 */
export function makeT(locale: Locale): Translate {
  if (locale === 'ko') return (ko, vars) => interpolate(ko, vars);
  return (ko, vars) => interpolate(EN[ko] ?? ko, vars);
}
