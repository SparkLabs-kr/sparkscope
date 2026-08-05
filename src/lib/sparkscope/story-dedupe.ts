/**
 * 같은 사건을 다룬 중복 기사 묶기 — 심층분석(LLM) 호출을 사건 단위로 줄이기 위한 것.
 *
 * 왜 필요한가: 하나의 보도자료가 매체 여러 곳에 실리면 제목만 다른 기사가 3~5건 들어온다.
 * 예(2026-08-04 실제 수집분, 전부 같은 협약 1건):
 *   - 위베어소프트, 써트코리아와 자동화 관리 솔루션 기능 협약
 *   - 위베어소프트, CertKorea와 협약···SSL·TLS 인증서 발급·갱신 자동화
 *   - 위베어소프트·써트코리아, 글로벌 SSL/TLS 인증서 자동 발급 지원
 *   - 위베어소프트, 글로벌 SSL 인증서 자동화 확대…금융권 검증 'CertBear'
 * 예전엔 이 4건을 각각 심층분석해서 같은 사건을 네 번 결제했다.
 *
 * 묶는 기준은 보수적으로 둔다 — 잘못 묶으면 서로 다른 사건에 같은 분석·같은 pitchScore가
 * 붙어버리므로, "덜 묶고 돈을 더 쓰는" 쪽이 "잘못 묶는" 쪽보다 낫다. 그래서
 *   (1) matchedKeyword가 같아야 하고,
 *   (2) 제목 문자 bigram 유사도가 임계값 이상이어야 한다.
 */

/** 제목 정규화 — 매체마다 다른 따옴표·말줄임·구두점·공백을 제거해 본문 어절만 남긴다. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[''"“”'‘’「」『』（）()\[\]{}<>《》]/g, '')
    .replace(/[···…⋯]+/g, ' ')
    .replace(/[.,·•∙│|/\\~\-–—:;!?%'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 문자 bigram 집합. 한국어는 어절이 매체마다 달라져서(협약/협약체결) 어절 단위보다 안정적이다. */
function bigrams(s: string): Set<string> {
  const t = normalizeTitle(s).replace(/\s/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}

/** Jaccard 유사도 (0~1). */
export function titleSimilarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * 기본 임계값 — 2026-08-05에 실제 심층분석 모집단 1,189건으로 튜닝했다.
 * 경계 구간(0.33~0.45) 쌍을 직접 눈으로 확인한 결과 대부분이 진짜 중복이어서,
 * 0.45는 과도하게 보수적이었다. 임계값별 절감률:
 *   0.45 → 15.8% / 0.40 → 19.1% / 0.35 → 21.4%
 * 0.35까지 내려도 오묶음은 드물었지만, 심층분석 전체 비용이 하루 $1 수준이라
 * 추가 절감액(하루 $0.06)이 오묶음 위험을 감수할 만하지 않다. 그래서 0.40으로 둔다.
 */
export const DEFAULT_SIMILARITY = 0.40;

/**
 * `[AI서머리] A사 계약‧B사 흑자전환` 처럼 여러 사건을 한 기사에 묶은 데일리 브리핑은
 * 개별 기사와 제목이 부분 일치해서(실측 0.42) 잘못 묶인다. 다루는 범위가 다르므로
 * 분석 결과를 공유시키면 안 된다 — 항상 단독 그룹으로 둔다.
 */
export function isRoundup(title: string): boolean {
  return /^\s*[\[【]/.test(title);
}

export interface DedupeCandidate {
  /** 원본 배열에서의 위치 — 호출자가 결과를 되돌려 매핑하는 데 쓴다. */
  index: number;
  title: string;
  matchedKeyword: string;
}

/**
 * 같은 사건으로 보이는 기사끼리 묶는다. 반환값은 그룹 배열이며, 각 그룹의 첫 원소가
 * 대표 기사(= 심층분석을 실제로 돌릴 기사)다. 입력 순서를 유지하므로 대표는 항상
 * 그룹 내에서 가장 먼저 수집된 기사가 된다.
 *
 * 단순 그리디 방식: 각 기사를 이미 만들어진 그룹의 **대표와만** 비교한다. 연쇄적으로
 * 묶여서 관련 없는 기사까지 한 그룹에 딸려오는 일(A~B, B~C 이면 A~C)을 막기 위함이다.
 */
export function groupDuplicateStories(
  articles: DedupeCandidate[],
  threshold = DEFAULT_SIMILARITY,
): DedupeCandidate[][] {
  const groups: DedupeCandidate[][] = [];
  for (const a of articles) {
    let placed = false;
    if (isRoundup(a.title)) { groups.push([a]); continue; }
    for (const g of groups) {
      const rep = g[0]!;
      if (rep.matchedKeyword !== a.matchedKeyword) continue;
      if (isRoundup(rep.title)) continue;
      if (titleSimilarity(rep.title, a.title) >= threshold) {
        g.push(a);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([a]);
  }
  return groups;
}
