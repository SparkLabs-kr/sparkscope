/**
 * 규칙 기반 기사 관련성/노이즈 필터 (AI 불필요).
 * 3단계: (1) 제외어 (2) 광고·생활정보 노이즈 (3) 회사명 매칭(관련성)
 *
 * 수집 시점(collector) + 기존 데이터 소급 정리(cleanup) 양쪽에서 동일하게 사용.
 */

// 광고·생활정보·자동생성 등 명백한 노이즈 키워드 (제목 포함 시 제외)
// ※ 금융·창업 뉴스와 충돌하는 단어(청약·분양·입주 등)는 제외해 오탐 방지.
export const AD_NOISE_KEYWORDS = [
  '인생샷', '화보', '맛집', '운세', '로또', '복권', '부고', '별세',
  '오늘의 운세', '띠별 운세', '오늘의 날씨', '주간 시세',
  '증시 마감', '코스피 마감', '코스닥 마감', '마감 시황',
  '배롱나무', '벚꽃', '단풍',
];

export type FilterReason = 'exclude_word' | 'ad_noise' | 'irrelevant';

// 회사명 매칭(관련성)을 적용할 카테고리.
// portfolio_company만 — 회사가 기사의 주어라 정밀도 높음.
// competitor(투자사)는 기사 제목에 피투자 스타트업만 나오는 경우가 많고,
// sparklabs_self(인터뷰 등)도 제목에 이름이 빠질 수 있어 오탐 방지 위해 제외.
const NAME_MATCH_CATEGORIES = new Set(['portfolio_company']);

export interface RelevanceInput {
  title: string;
  primaryKeyword: string;
  helperKeywords?: string | null;
  excludeWords?: string | null;
  category?: string | null;
}

function splitCsv(s?: string | null): string[] {
  return (s ?? '').split(',').map(x => x.trim()).filter(Boolean);
}

/**
 * 필터 위반 사유 반환 (통과 시 null).
 * 1) 대상별 제외어 포함 → exclude_word
 * 2) 광고/생활정보 노이즈 → ad_noise
 * 3) 제목에 회사명(주키워드/보조키워드) 미포함 → irrelevant
 */
export function filterReason(a: RelevanceInput): FilterReason | null {
  const title = a.title ?? '';

  const excl = splitCsv(a.excludeWords);
  if (excl.some(w => w.length >= 2 && title.includes(w))) return 'exclude_word';

  if (AD_NOISE_KEYWORDS.some(w => title.includes(w))) return 'ad_noise';

  // 회사명 매칭은 지정 카테고리에만 적용 (그 외/미상은 스킵 — 오탐 방지)
  const applyNameMatch = a.category != null && NAME_MATCH_CATEGORIES.has(a.category);
  if (applyNameMatch) {
    const keys = [a.primaryKeyword, ...splitCsv(a.helperKeywords)].filter(k => k && k.length >= 2);
    if (keys.length > 0 && !keys.some(k => title.includes(k))) return 'irrelevant';
  }

  return null;
}

export function isRelevant(a: RelevanceInput): boolean {
  return filterReason(a) === null;
}
