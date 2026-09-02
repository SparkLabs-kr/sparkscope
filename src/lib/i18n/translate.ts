import { EN } from './en';
import type { Locale } from './locales';
import { taiwanMediaName } from '@/lib/sparkscope/taiwan-media-names';

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
  // 대만 매체명을 먼저 본다 — 키가 중문이라 en.ts의 "한국어 키 → 영어" 구조에 담을 수 없고,
  // 한국어 화면에서도 옮겨야 한다(그냥 두면 한국어 대시보드에 중문 매체명이 나온다).
  // 여기서 처리하면 화면 곳곳의 t(a.source) 호출부를 건드리지 않아도 된다.
  // 키가 중문이므로 한국어 UI 문구 키와 겹칠 일이 없다.
  if (locale === 'ko') {
    return (ko, vars) => interpolate(taiwanMediaName(ko, 'ko') ?? ko, vars);
  }
  return (ko, vars) => interpolate(taiwanMediaName(ko, 'en') ?? EN[ko] ?? ko, vars);
}
