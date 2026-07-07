/**
 * 규칙 기반 기사 관련성/노이즈 필터 (AI 불필요).
 * 3단계: (1) 제외어 (2) 광고·생활정보 노이즈 (3) 회사명 매칭(관련성) (4) 정치 차단
 *
 * 수집 시점(collector) + 기존 데이터 소급 정리(cleanup) 양쪽에서 동일하게 사용.
 */
import { POLITICAL_KEYWORDS } from './political-blocklist';

/** 제목이 정치 차단 키워드를 토큰 경계로 포함하는지 (오탐 최소화). */
export function isPolitical(title?: string | null): boolean {
  const t = title ?? '';
  if (!t) return false;
  return POLITICAL_KEYWORDS.some(k => matchesAsToken(t, k));
}

/** 중복 판정용 제목 정규화 키 — 공백·기호 제거, 문자/숫자만 소문자로. (한글 보존) */
export function normalizeTitleKey(title?: string | null): string {
  return (title ?? '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

// 광고·생활정보·자동생성 등 명백한 노이즈 키워드 (제목 포함 시 제외)
// ※ 금융·창업 뉴스와 충돌하는 단어(청약·분양·입주 등)는 제외해 오탐 방지.
export const AD_NOISE_KEYWORDS = [
  '인생샷', '화보', '맛집', '운세', '로또', '복권', '부고', '별세',
  '오늘의 운세', '띠별 운세', '오늘의 날씨', '주간 시세',
  '증시 마감', '코스피 마감', '코스닥 마감', '마감 시황',
  '배롱나무', '벚꽃', '단풍',
];

export type FilterReason = 'exclude_word' | 'ad_noise' | 'sports_ad' | 'irrelevant';

// ── 스포츠·게임·연예·광고 강제 제외 ──────────────────────────────
// helperKeywords의 사람 이름(대표자명 등)이 야구선수·연예인과 겹쳐 대량 오통과되는 문제 대응.
const URL_EXCLUDE = ['/sports/', '/baseball/', '/soccer/', '/game/', '/entertain/', '/photo/', '/issue/'];
// 스포츠 전문 매체 (26개 확정 매체엔 없지만 안전망)
const SPORTS_MEDIA = ['스포츠서울', '스포츠경향', 'OSEN', '일간스포츠', '스포츠동아', '스포츠조선', '스포탈코리아', '엑스포츠뉴스', 'MHN스포츠'];
// 야구/스포츠·체육 용어 (제목 포함 시 제외)
const SPORTS_TERMS = [
  '타점', '완벽투', '무실점', '홈런', '선발승', '이닝', 'KKKKK', '실점', '홀드', '세이브',
  '병살', '도루', '타율', '방어율', '4안타', '멀티히트', '루타', '완봉', '역투', '쐐기타', '결승타',
  'KBO', '프로야구', '올스타', '구단', '외인', '멀티포', '콩쿠르', '피겨', '금메달', '은메달', '동메달', '관중',
];
// 광고성 키워드
const AD_BLOCK_KEYWORDS = ['무료여행', '노리세요', '다이어트', '몸매', '인정템', '완판', '핫딜', '최저가', '할인코드'];

/** 스포츠·게임·연예·광고 등 강제 제외 대상인지 (제목·URL·매체 기준). 카테고리 무관 전역 적용. */
export function isBlockedNoise(a: { title?: string | null; link?: string | null; source?: string | null }): boolean {
  const title = a.title ?? '';
  const link = (a.link ?? '').toLowerCase();
  const source = a.source ?? '';

  // 1) URL 섹션
  if (URL_EXCLUDE.some(p => link.includes(p))) return true;
  // 2) 스포츠 전문 매체 (부분일치 — "스포츠"가 매체명에 들어가면 제외)
  if (source.includes('스포츠') || SPORTS_MEDIA.some(m => source.includes(m))) return true;
  // 3) 야구/스포츠 용어
  if (SPORTS_TERMS.some(t => title.includes(t))) return true;
  // "안타"는 "안타깝다/안타까운"과 충돌 → 뒤에 까·깝이 오면 스포츠 아님
  if (/안타(?!까|깝)/.test(title)) return true;
  // 4) 광고 키워드
  if (AD_BLOCK_KEYWORDS.some(w => title.includes(w))) return true;
  // 5) 정치 키워드 (편집 가능 리스트, 제목 토큰 매칭)
  if (isPolitical(title)) return true;

  return false;
}

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
// portfolio_company + sparklabs_self — 회사/조직명이 제목의 주어여야 정밀도 높음.
// (sparklabs_self는 임원 동명이인·"스파크랩" 광역매칭 노이즈가 심해 매칭 필수)
// competitor(투자사)는 제목에 피투자 스타트업만 나오는 경우가 많아 제외.
export const NAME_MATCH_CATEGORIES = new Set(['portfolio_company', 'sparklabs_self']);

export interface RelevanceInput {
  title: string;
  primaryKeyword: string;
  name?: string | null;         // 회사명 (강한 식별자)
  englishName?: string | null;  // 영문 회사명 (강한 식별자)
  helperKeywords?: string | null; // 별칭·서비스명·대표자명 (약한 식별자)
  excludeWords?: string | null;
  category?: string | null;
  link?: string | null;
  source?: string | null;
}

function splitCsv(s?: string | null): string[] {
  return (s ?? '').split(',').map(x => x.trim()).filter(Boolean);
}

/** 회사 "강한 식별자" 토큰 목록 (primaryKeyword·name·englishName). helperKeywords는 제외. */
function strongKeys(a: RelevanceInput): string[] {
  return [a.primaryKeyword, a.name, a.englishName]
    .map(k => (k ?? '').trim())
    .filter(k => k.length >= 2);
}

/**
 * 필터 위반 사유 반환 (통과 시 null).
 * 1) 대상별 제외어 → exclude_word
 * 2) 스포츠·게임·연예·광고 강제 제외 → sports_ad
 * 3) 광고/생활정보 노이즈 → ad_noise
 * 4) 회사명(강한 식별자) 미포함 → irrelevant
 *    ※ helperKeywords(대표자명 등)만으로는 통과 불가 — 회사명/영문명이 함께 등장해야 함.
 */
export function filterReason(a: RelevanceInput): FilterReason | null {
  const title = a.title ?? '';

  const excl = splitCsv(a.excludeWords);
  if (excl.some(w => w.length >= 2 && title.includes(w))) return 'exclude_word';

  if (isBlockedNoise({ title, link: a.link, source: a.source })) return 'sports_ad';

  if (AD_NOISE_KEYWORDS.some(w => title.includes(w))) return 'ad_noise';

  // 회사명 매칭은 지정 카테고리에만 적용 (그 외/미상은 스킵 — 오탐 방지)
  // 강한 식별자(회사명·영문명·주키워드)가 독립 토큰으로 등장해야 통과.
  // helperKeywords(대표자명 등)만 있는 기사는 동명이인(야구선수 등) 오통과 방지를 위해 제외.
  const applyNameMatch = a.category != null && NAME_MATCH_CATEGORIES.has(a.category);
  if (applyNameMatch) {
    // 강한 식별자(회사명·영문명·주키워드) + 팀이 큐레이션한 보조 식별자(서비스명·별칭 등 helperKeywords).
    // 예: 서비스명 '약올려'만 제목에 있고 회사명 '룩인사이트'는 없는 기사도 포폴사로 인정.
    // (대표자명 등 동명이인 위험은 이후 AI 재분류·isBlockedNoise 단계에서 정리)
    const keys = [...strongKeys(a), ...splitCsv(a.helperKeywords)].filter(k => k.length >= 2);
    if (keys.length > 0 && !keys.some(k => matchesAsToken(title, k))) return 'irrelevant';
  }

  return null;
}

export function isRelevant(a: RelevanceInput): boolean {
  return filterReason(a) === null;
}
