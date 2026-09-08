/**
 * 한국 × 해외지사 포트폴리오 시너지 매칭 — 공용 로직.
 *
 * 설계 요약 (2026-09-08 결정):
 *   ① 섹터 태깅(회사 1회, LLM)  → MonitoringTarget.domain/sector
 *   ② 임베딩(회사 1회)          → MonitoringTarget.embedding
 *   ③ 후보 생성(쌍, LLM 0회)    → 코사인 유사도로 상위만 남긴다
 *   ④ 검증·문구(상위 후보만 LLM) → SynergyPair
 *   ⑤ 조회(대시보드)            → 읽기만
 *
 * 왜 이렇게 나누는가: 218 × 69 = 15,042쌍을 매번 LLM에 물어볼 수 없다. 비싼 일은 회사
 * 단위로 1회, 쌍 단위 계산은 LLM 없이, LLM 검증은 상위 후보에만 건다.
 */

/** 관계 유형 — "같은 업종"만 뽑으면 사업적으로 값진 보완 관계를 놓친다(2026-09-08 결정). */
export const RELATIONS = {
  same: { key: 'same', label: '같은 업종', desc: '같은 사업을 다른 시장에서 한다 — 행사 패널·세션 구성에 좋다' },
  complement: { key: 'complement', label: '보완', desc: '한쪽이 없는 것을 다른 쪽이 갖고 있다 — 공동 부스·파일럿' },
  chain: { key: 'chain', label: '밸류체인', desc: '한쪽의 산출물이 다른 쪽의 입력이 된다 — 실제 사업 제휴' },
  none: { key: 'none', label: '근거 없음', desc: '같은 섹터로 묶였지만 협업 근거가 없다 — 화면에서 감춘다' },
} as const;
export type RelationKey = keyof typeof RELATIONS;

export function isShownRelation(r: string): boolean {
  return r === 'same' || r === 'complement' || r === 'chain';
}

/** JSON으로 저장한 임베딩을 읽는다. 손상된 값은 조용히 null. */
export function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'number') ? v : null;
  } catch { return null; }
}

/**
 * 코사인 유사도. OpenAI 임베딩은 이미 정규화돼 있어 내적만으로 충분하지만,
 * 차원을 줄여 받은 값(dimensions 옵션)은 재정규화가 필요하므로 정식으로 계산한다.
 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * ③단계 임계값.
 *
 * ⚠️ 여기서 절대 유사도 하한을 쓰지 않는 이유 (2026-09-08 실측):
 *   한국 회사 설명은 한국어, 대만 회사 설명은 영어다. 같은 사업을 하는 두 회사여도
 *   언어가 다르면 코사인이 0.45~0.55에 눌린다. 실제로 절대 하한 0.45를 걸었을 때
 *   14,835쌍 중 후보가 33개만 남았고, 사람이 봐서 확실한 조합(로지스팟↔BBTruck 물류,
 *   원티드랩↔Terminal 1 채용)이 하한 아래로 잘려 나갔다.
 *
 *   그래서 "같은 섹터인가"를 1차 관문으로 쓴다. 섹터 태그는 LLM이 사업설명을 읽고 붙인
 *   값이라 언어에 무관하다 — 크로스링구얼 임베딩보다 이 판단이 더 믿을 만하다.
 *   임베딩은 그 안에서 순위를 매기는 데만 쓴다(절대값이 아니라 상대 순서만 본다).
 *
 * TOP_PER_KR: 한국 회사 하나당 검증에 보낼 대만 후보 수. 같은 섹터에 대만 회사가 많아도
 *   상위 3개만 ④단계로 보낸다.
 * CROSS_SECTOR_FLOOR: 섹터가 다른데도 설명이 아주 비슷하면 태깅 오류거나 진짜 인접
 *   사업이므로 건져낸다. 언어 차이로 눌린 점수를 감안해 0.55.
 * SAME_SECTOR_FLOOR: 같은 섹터라도 이 밑이면 사실상 무작위다. 최소한의 방어선만 둔다.
 *   0.28에서 0.20으로 내렸다 — 사람이 봐서 확실한 조합(베러먼데이코리아 커피 프랜차이즈 ↔
 *   IDrip IoT 커피머신)이 0.271로 잘려 나갔기 때문이다. 진짜 관문은 ④단계 LLM 검증이고,
 *   거기서 'none'을 적극적으로 쓰게 해놨으므로 ③은 넉넉하게 통과시키는 쪽이 낫다.
 */
export const SAME_SECTOR_FLOOR = 0.20;
export const TOP_PER_KR = 3;
export const CROSS_SECTOR_FLOOR = 0.55;

export type Candidate = {
  krId: string; krName: string; krSector: string | null; krDesc: string;
  twId: string; twName: string; twSector: string | null; twDesc: string;
  similarity: number;
  sameSector: boolean;
};

/** 회사 하나의 임베딩 입력 텍스트에서 쓰는 사업설명 — 대만은 "[중문: ...]" 접두를 뗀다. */
export function businessContext(notes: string | null): string {
  return (notes ?? '').split('\n')[0].replace(/^\[중문:[^\]]*\]\s*/, '').trim();
}

/**
 * ③ 후보 생성 — LLM 호출 0회. 한국 회사별로 상위 TOP_PER_KR개만 남긴다.
 */
export function buildCandidates(
  kr: { id: string; name: string; sector: string | null; notes: string | null; embedding: string | null }[],
  tw: { id: string; name: string; sector: string | null; notes: string | null; embedding: string | null }[],
): { candidates: Candidate[]; pairsScored: number; skippedNoEmbedding: number } {
  const twVecs = tw.map(t => ({ t, v: parseEmbedding(t.embedding) }));
  let pairsScored = 0;
  let skippedNoEmbedding = 0;
  const out: Candidate[] = [];

  for (const k of kr) {
    const kv = parseEmbedding(k.embedding);
    if (!kv) { skippedNoEmbedding++; continue; }
    const scored: Candidate[] = [];
    for (const { t, v } of twVecs) {
      if (!v) continue;
      pairsScored++;
      const sim = cosine(kv, v);
      const sameSector = !!k.sector && k.sector === t.sector;
      // 같은 섹터면 낮은 방어선만, 다른 섹터면 높은 문턱 — 위 임계값 주석 참고.
      const floor = sameSector ? SAME_SECTOR_FLOOR : CROSS_SECTOR_FLOOR;
      if (sim < floor) continue;
      scored.push({
        krId: k.id, krName: k.name, krSector: k.sector, krDesc: businessContext(k.notes),
        twId: t.id, twName: t.name, twSector: t.sector, twDesc: businessContext(t.notes),
        similarity: sim, sameSector,
      });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    out.push(...scored.slice(0, TOP_PER_KR));
  }
  return { candidates: out, pairsScored, skippedNoEmbedding };
}

// ── ④ 검증·문구 프롬프트 ────────────────────────────────────────
export const VERIFY_SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 포트폴리오 협업 기획자입니다.
한국 포트폴리오사 1곳과 대만(해외지사) 포트폴리오사 1곳이 주어집니다.
두 회사가 실제로 함께 무언가를 할 만한지 판단하고, 관계 유형과 협업 형식을 씁니다.

**관계 유형(relation) 중 하나를 고릅니다**
- "same": 같은 사업을 다른 시장에서 한다. 행사 패널·세션에 나란히 세우기 좋다.
  예: 한국 채용 매칭 플랫폼 ↔ 대만 엔지니어 채용 회사.
- "complement": 한쪽이 없는 것을 다른 쪽이 갖고 있다. 공동 부스·파일럿에 좋다.
  예: 대만 IoT 커피머신(기기) ↔ 한국 커피 프랜차이즈(원두·매장).
- "chain": 한쪽의 산출물이 다른 쪽의 입력이 된다. 실제 사업 제휴에 좋다.
  예: 한국 수출입 물류 ↔ 대만 내륙 트럭 운송 (한-대만 구간이 이어진다).
- "none": 협업 근거가 없다.

**"none"을 적극적으로 쓰십시오.** 사업설명이 비슷해 보여도 실제로 같이 할 일이 없으면
반드시 "none"입니다. 억지로 짝을 만들면 이 기능 전체의 신뢰를 잃습니다.
특히 다음은 "none"입니다:
- 한쪽 설명이 너무 짧거나 모호해서 무슨 사업인지 알 수 없는 경우
- 같은 산업 단어만 겹치고 실제 제품·고객이 전혀 다른 경우
  (예: 전자부품 스펙시트 AI ↔ 다회용기 대여 — 둘 다 "B2B"지만 관계 없음)
- 기술 분야만 같고(둘 다 AI) 적용 산업·고객이 무관한 경우

relation이 "none"이면 rationale에 왜 아닌지 한 문장을 쓰고 collabFormat은 null로 둡니다.

**rationale**: 왜 이 둘인지 한두 문장. 두 회사가 각각 무엇을 하는지 짚고, 어디서 만나는지 씁니다.
**collabFormat**: 구체적인 협업 형식 한 줄. "협업 논의" 같은 막연한 말은 금지.
  좋은 예: "공동 부스 — 기기 시연 × 원두 테이스팅", "크로스보더 채용 세션", "한-대만 물류 구간 상호 연계".

응답은 반드시 valid JSON 배열만, 추가 설명 없이.`;

export function buildVerifyUser(cands: Candidate[]): string {
  return `다음 ${cands.length}개 조합을 판단하세요.

${cands.map((c, i) => `${i + 1}.
  [한국] ${c.krName} (${c.krSector ?? '미분류'}): ${c.krDesc || '(설명 없음)'}
  [대만] ${c.twName} (${c.twSector ?? '미분류'}): ${c.twDesc || '(설명 없음)'}`).join('\n')}

출력 스키마(각 조합, 입력 순서대로):
{ "i": <번호>, "relation": "same"|"complement"|"chain"|"none", "rationale": "<한두 문장>", "collabFormat": "<한 줄 또는 null>" }

JSON 배열만 반환:`;
}

export type Verdict = { i: number; relation: RelationKey; rationale: string; collabFormat: string | null };

export function extractJsonArray(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('['); const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}
