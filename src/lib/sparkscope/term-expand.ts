// 검색어 표기 변형 — "투자유치"와 "투자 유치"는 같은 말인데 LIKE 검색은 완전히 다르게 본다.
//
// 실제 DB 기준(2026-08):
//   title contains "투자유치"  →   244건
//   title contains "투자 유치" → 1,213건
// 매체마다 띄어쓰기가 제각각이라, 검색어 하나만 그대로 넣으면 관련 기사 대부분을 놓친다.
// 그래서 한 검색어를 "같은 뜻으로 제목에 쓰일 만한 표기"들로 펼쳐서 OR 검색한다.
//
// 의미 수준의 동의어(투자유치 ↔ 시리즈A ↔ 라운드)는 여기서 못 만든다.
// 그건 chat-agent.ts의 에이전트가 검색어(terms)에 함께 담아 준다.
// 여기는 순수 표기 변형만 담당한다.

const despace = (s: string) => s.replace(/\s+/g, '');

/**
 * 검색어 하나의 표기 변형을 만든다.
 * - 공백 제거형: "투자 유치" → "투자유치"
 * - 한글 복합어의 띄어쓰기 후보: "투자유치" → "투자 유치"
 *   (형태소 경계를 모르니 가능한 자리마다 넣는다. 빗나간 변형은 아무것도 매칭하지 않아 무해하다)
 * - 한글+영숫자 경계: "시리즈A" → "시리즈 A"
 */
export function spacingVariants(term: string): string[] {
  const out = new Set<string>();
  const t = term.trim();
  if (t.length < 2) return [];
  out.add(t);

  const bare = despace(t);
  if (bare.length >= 2) out.add(bare);

  // 순수 한글 4~7자 복합어만 분해한다. 3자 이하는 조각이 너무 짧아 오탐이 늘고,
  // 8자 이상은 변형 수가 늘어나는 데 비해 실익이 없다.
  if (/^[가-힣]{4,7}$/.test(bare)) {
    for (let i = 2; i <= bare.length - 2; i++) {
      out.add(`${bare.slice(0, i)} ${bare.slice(i)}`);
    }
  }

  // "시리즈A" ↔ "시리즈 A", "프리A" ↔ "프리 A"
  const m = bare.match(/^([가-힣]+)([A-Za-z0-9]+)$/);
  if (m && m[1].length >= 2) out.add(`${m[1]} ${m[2]}`);

  return [...out];
}

/** 검색어 목록 전체를 변형까지 펼친다. 중복 제거 후 상한을 둔다. */
export function expandTerms(terms: string[], max = 40): string[] {
  const out = new Set<string>();
  for (const t of terms) {
    for (const v of spacingVariants(t)) {
      out.add(v);
      if (out.size >= max) return [...out];
    }
  }
  return [...out];
}
