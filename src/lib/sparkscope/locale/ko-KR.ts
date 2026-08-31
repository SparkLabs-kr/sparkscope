/**
 * ko-KR — 한국 언어 팩.
 *
 * 기존 crisis-keywords.ts·media.ts를 감싸기만 한다. 한국 쪽 동작은 하나도 바뀌지 않는다 —
 * 이 리팩터링의 목적은 대만을 붙이는 것이지 한국을 건드리는 게 아니다.
 */
import { CRISIS_KEYWORDS } from '../crisis-keywords';
import { TIER_OF, normalizeSource, isKnownMedia } from '../media';
import type { LanguagePack } from './types';

const HANGUL = /[가-힣]/;

/**
 * 메이저 매체 고정 목록 — analyzer.ts에 하드코딩돼 있던 것을 팩으로 옮겼다.
 * 한국은 티어와 별개로 "가중치를 줄 매체"를 따로 골라 왔으므로 목록을 유지한다.
 */
const MAJOR = [
  '동아일보', '조선비즈', 'Chosunbiz', '매일경제', '한국경제',
  '전자신문', '디지털데일리', '디지털타임스', '아시아투데이',
];

export const koKR: LanguagePack = {
  locale: 'ko-KR',
  label: '한국 (한국어)',

  hasScript: (text) => !!text && HANGUL.test(text),

  crisisKeywords: CRISIS_KEYWORDS,
  /**
   * 한국어는 조사가 붙어도 어간이 그대로 남으므로 부분일치로 충분하다.
   * (중문과 매칭 방식이 다르다는 게 이걸 함수로 둔 이유다.)
   */
  matchCrisis: (text) => {
    const s = text ?? '';
    if (!s) return [];
    const hits: { category: string; keyword: string }[] = [];
    for (const [category, kws] of Object.entries(CRISIS_KEYWORDS)) {
      for (const keyword of kws) {
        if (s.includes(keyword)) hits.push({ category, keyword });
      }
    }
    return hits;
  },

  media: {
    normalize: (s) => normalizeSource((s ?? '').trim()),
    isCurated: (s) => isKnownMedia((s ?? '').trim()),
    // 한국은 아직 제외 목록 개념이 없다 — 대만처럼 아그리게이터 문제가 불거지면 그때 채운다.
    exclusionReason: () => null,
    isMajor: (s) => {
      const src = (s ?? '').trim();
      if (MAJOR.includes(src)) return true;
      // 표기 편차로 들어와도 잡히게 정규화 후 한 번 더 본다.
      return MAJOR.includes(normalizeSource(src));
    },
  },

  translationHints: [
    '- Korean source text.',
    '- Keep official English names: 스파크랩 → SparkLabs, 알토스벤처스 → Altos Ventures.',
    '  Otherwise romanize by Revised Romanization.',
    '- 억원 → the natural English form (30억원 → KRW 3B).',
  ],
};

export { TIER_OF as KO_TIER_OF };
