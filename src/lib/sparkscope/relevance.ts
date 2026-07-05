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

// ── 토큰 경계 매칭 ───────────────────────────────────────────────
// 문제: 짧은 회사명이 다른 단어 속에 우연히 포함돼 오통과.
//   "노리"(회사) → "노리지만/노리는데"(동사), "리코"(회사) → "인실리코"(Insilico)
// 해결: 회사명이 "독립 토큰"으로 등장할 때만 통과.
//   - 왼쪽: 문자열 시작이거나 앞 글자가 단어문자(한글/영숫자)가 아님 → "인실리코"의 리코 차단
//   - 오른쪽: 문자열 끝이거나 뒷 글자가 단어문자가 아님, 또는 "조사 + 경계"만 허용
//     → "노리지만"(지=조사 아님) 차단, "노리는데"(는 뒤에 데=단어문자) 차단, "노리가 "/"노리는 "는 통과
// 한국어 조사 목록 (길이 내림차순으로 그리디 매칭)
const JOSA = [
  '으로서', '으로써', '에서는', '에게서', '으로', '에서', '에게', '한테', '부터', '까지',
  '보다', '처럼', '마다', '밖에', '조차', '이나', '이란', '이라', '으론', '이든',
  '은', '는', '이', '가', '을', '를', '과', '와', '의', '에', '도', '만', '로', '라', '란', '나', '께', '든', '야', '여',
].sort((a, b) => b.length - a.length);

function isWordChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) return true; // 한글 음절
  if (code >= 0x1100 && code <= 0x11FF) return true; // 한글 자모
  if (code >= 0x3130 && code <= 0x318F) return true; // 한글 호환 자모
  if (code >= 48 && code <= 57) return true;          // 0-9
  if (code >= 65 && code <= 90) return true;          // A-Z
  if (code >= 97 && code <= 122) return true;         // a-z
  return false;
}

/** 회사명(name)이 제목(title) 안에서 독립 토큰(주어 위치)으로 등장하는지. */
export function matchesAsToken(title: string, name: string): boolean {
  if (!title || !name) return false;
  let from = 0;
  for (;;) {
    const idx = title.indexOf(name, from);
    if (idx === -1) return false;
    const end = idx + name.length;
    const leftOk = idx === 0 || !isWordChar(title[idx - 1]);
    if (leftOk) {
      const next = end < title.length ? title[end] : '';
      if (end >= title.length || !isWordChar(next)) return true; // 오른쪽 깔끔한 경계
      // 오른쪽이 단어문자면 "조사 + 경계"일 때만 허용
      for (const j of JOSA) {
        if (title.startsWith(j, end)) {
          const after = end + j.length;
          if (after >= title.length || !isWordChar(title[after])) return true;
        }
      }
    }
    from = idx + 1;
  }
}

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
  // 부분 문자열이 아니라 "독립 토큰(주어)"으로 등장해야 통과 (matchesAsToken).
  const applyNameMatch = a.category != null && NAME_MATCH_CATEGORIES.has(a.category);
  if (applyNameMatch) {
    const keys = [a.primaryKeyword, ...splitCsv(a.helperKeywords)].filter(k => k && k.length >= 2);
    if (keys.length > 0 && !keys.some(k => matchesAsToken(title, k))) return 'irrelevant';
  }

  return null;
}

export function isRelevant(a: RelevanceInput): boolean {
  return filterReason(a) === null;
}
