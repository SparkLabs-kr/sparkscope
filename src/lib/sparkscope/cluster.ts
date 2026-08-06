/**
 * 같은 사건을 다룬 기사(매체만 다름)를 대표 기사 1개 + 나머지로 묶는 클러스터링.
 *
 * 회사 정보(matchedKeyword)가 있는 호출부(최근 수집 기사 등)는:
 *   같은 회사(서로의 matchedKeyword가 상대 제목에 단어로 등장) + 발행일 근접 + 톤(긍/부정) 일치
 *   를 기준으로 묶는다. 매체마다 문장을 완전히 새로 써서 어순·표현이 겹치지 않아도
 *   ("엔씽, 158억 AI농업플랫폼 수직농장 공급" vs "엔씽, 158억 'AI 수직농장' 구축…연구기관·
 *   유통·교육 '전방위 수주'") 같은 회사·비슷한 시점 기사는 놓치지 않는다.
 *   matchedKeyword는 카테고리 분류가 갈려도(포트폴리오 vs 스타트업계) 실제 제목에 회사명이
 *   있으면 같은 회사로 인정 — 카테고리 오분류와 무관하게 묶이게 하기 위함.
 *   톤이 다르면(같은 회사라도 완전히 다른 사안일 가능성이 큼 — 예: 그날 있었던 좋은 소식과
 *   별개로 발생한 악재) 묶지 않는다. 부정 기사가 긍정 기사 더미에 묻혀 안 보이는 사고 방지.
 *
 * 회사 정보가 없는 호출부(톤 분석 등 — 이미 스파크랩 단일 주제라 구분 불필요)는 기존처럼
 * 문자 bigram + 단어 토큰 유사도만으로 판단한다.
 */

export interface ClusterableArticle {
  id: string;
  title: string;
  matchedKeyword?: string;
  pubDate?: Date | string;
  tone?: string | null;
  category?: string | null;
}

export interface ArticleCluster<T> {
  rep: T;
  others: T[];
}

const BIGRAM_THRESHOLD = 0.65;
const TOKEN_THRESHOLD = 0.5;

function normalizeForBigram(title: string): string {
  return title.replace(/[\[\]'"‘’“”()·,.\-–—0-9\s]/g, '').toLowerCase();
}

function bigramSet(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// containment 계수(교집합/짧은쪽 크기) — 부제가 붙어 길이가 크게 달라도, 짧은 제목의
// bigram이 긴 제목 안에 거의 다 들어있으면 같은 사건으로 판단.
function bigramSimilarity(a: string, b: string): number {
  const A = bigramSet(normalizeForBigram(a));
  const B = bigramSet(normalizeForBigram(b));
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  for (const g of A) if (B.has(g)) overlap++;
  return overlap / Math.min(A.size, B.size);
}

function normalizeToken(t: string): string {
  return t.replace(/[·,.\-–—'"‘’“”()\[\]]/g, '').toLowerCase();
}

// 공백/문장부호 기준 단어 분리. 2글자 미만(조사·기호 파편)은 제외.
function tokenize(title: string): Set<string> {
  const tokens = title
    .replace(/[\[\]'"‘’“”()]/g, ' ')
    .split(/[\s·,.\-–—…]+/)
    .map(normalizeToken)
    .filter(t => t.length >= 2);
  return new Set(tokens);
}

// 회사명 토큰은 거의 모든 제목에 들어있어 겹침을 부풀리므로 제외하고, 나머지 핵심 단어끼리만 비교.
function tokenSimilarity(a: string, b: string, excludeToken?: string): number {
  const exclude = excludeToken ? normalizeToken(excludeToken) : null;
  const A = new Set([...tokenize(a)].filter(t => t !== exclude));
  const B = new Set([...tokenize(b)].filter(t => t !== exclude));
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  for (const t of A) if (B.has(t)) overlap++;
  return overlap / Math.min(A.size, B.size);
}

// 두 신호를 각자의 임계값 대비 비율로 정규화해 최댓값을 매칭 점수로 쓴다 — 1.0 이상이면 매칭.
function titleMatchScore(aTitle: string, bTitle: string, companyName?: string): number {
  const bigramRatio = bigramSimilarity(aTitle, bTitle) / BIGRAM_THRESHOLD;
  const tokenRatio = tokenSimilarity(aTitle, bTitle, companyName) / TOKEN_THRESHOLD;
  return Math.max(bigramRatio, tokenRatio);
}

// 정확히 단어 단위로 등장하는지 확인 — "노리"가 "노리개"의 일부로 잘못 걸리는 것 방지
// (2글자 이하 짧은 회사명·부분문자열 오탐은 이 프로젝트에서 실제로 겪은 문제라 단어 경계를 지킨다).
function titleHasToken(title: string, token?: string): boolean {
  if (!token) return false;
  const norm = normalizeToken(token);
  if (norm.length < 2) return false;
  return tokenize(title).has(norm);
}

// 같은 회사 여부 — matchedKeyword가 서로 달라도(카테고리 분류가 갈려 다른 키워드로 수집된
// 경우, 예: portfolio_company용 "엔씽" vs industry_trend용 "스타트업 글로벌 진출") 상대
// 제목에 내 matchedKeyword가 단어로 등장하면 같은 회사로 본다.
function sameCompany<T extends ClusterableArticle>(a: T, b: T): boolean {
  if (a.matchedKeyword && titleHasToken(b.title, a.matchedKeyword)) return true;
  if (b.matchedKeyword && titleHasToken(a.title, b.matchedKeyword)) return true;
  return false;
}

function toneCompatible<T extends ClusterableArticle>(a: T, b: T): boolean {
  if (!a.tone || !b.tone) return true; // 톤 정보 없으면 막지 않음
  if (a.tone === b.tone) return true;
  // 중립은 매체마다 톤 판정이 갈릴 뿐 같은 사건일 수 있어 긍정/부정 어느 쪽과도 묶일 수 있게 허용.
  // 완전히 반대되는 긍정↔부정만 다른 사안일 가능성이 크다고 보고 분리한다(2026-08-06, 다이제스트에
  // 같은 투자유치 기사가 매체별로 NEUTRAL/POSITIVE로 갈려 안 묶이고 중복 노출된 사례로 발견).
  if (a.tone === 'NEUTRAL' || b.tone === 'NEUTRAL') return true;
  return false;
}

function daysBetween(a?: Date | string, b?: Date | string): number {
  if (!a || !b) return 0;
  const diff = Math.abs(+new Date(a) - +new Date(b));
  return Number.isNaN(diff) ? 0 : diff / 86_400_000;
}

function isMatch<T extends ClusterableArticle>(a: T, b: T, maxDateDiffDays: number, textOnlyThreshold: number): boolean {
  if (daysBetween(a.pubDate, b.pubDate) > maxDateDiffDays) return false;
  const hasCompanyInfo = !!(a.matchedKeyword || b.matchedKeyword);
  // 회사 정보가 있으면 "같은 회사명이 제목에 있는지"만으로 판단해왔는데, 본문 언급만으로
  // 매칭된 기사(제목에 회사명이 아예 없는 경우 — 예: "해시드" 카드에 붙은 "KODA, ~보험 한도
  // 확대" 기사)는 이 기준을 못 만족해서, 명백히 같은 사건인 다른 제목의 기사와 안 묶였다
  // (2026-08-05 발견). 제목 유사도도 같이 시도해서 둘 중 하나라도 맞으면 묶는다 — 회사명
  // 기준을 없애는 게 아니라 추가 신호로만 보강.
  if (hasCompanyInfo) {
    if (!toneCompatible(a, b)) return false;
    if (sameCompany(a, b)) {
      // 회사명(matchedKeyword)이 같아도 곧 같은 사건이라는 뜻은 아니다 — "AWS"처럼 여러 무관한
      // 기사에 흔히 언급되는 이름(클라우드 시장 뉴스든 날씨관측장비 기사든 다 "AWS"를 포함)을
      // 추적 키워드로 쓰면, 회사명 일치만으로 판단 시 전혀 다른 기사 수십 건이 한 클러스터로
      // 잘못 묶인다(2026-08-06, "AWS" 키워드 경쟁사 기사 60건이 폭염·주가·제휴 등 서로 무관한
      // 기사끼리 전부 하나로 합쳐진 사고로 발견). titleMatchScore > 0만으로는 부족하다 — 완전히
      // 무관한 한국어 문장 두 개도 조사·흔한 음절이 우연히 겹쳐 bigram 유사도가 항상 살짝은
      // 0보다 크게 나온다(실측: 무관한 쌍 0.22~0.26, 진짜 같은 사건 1.0~1.6). 0.5를 최소
      // 기준으로 둬서 우연한 겹침과 실제 내용 겹침을 구분한다.
      return titleMatchScore(a.title, b.title, a.matchedKeyword) >= 0.5;
    }
    // 회사명(matchedKeyword)이 서로 다른 경우 — 예: 같은 피투자회사 기사를 서로 다른 투자사
    // 키워드로 각각 수집한 경우(2026-08-06, 모드하우스 투자 건이 "에이티넘인베스트먼트"·
    // "IMM인베스트먼트" 두 투자사 키워드로 따로 잡혀 안 묶인 사례). 기본값(1.0)은 호출부가
    // 낮춰서(textOnlyThreshold) 이런 잔여 중복까지 잡을 수 있게 한다 — 기본 동작은 그대로.
    return titleMatchScore(a.title, b.title) >= textOnlyThreshold;
  }
  // 회사 정보가 없으면(톤 분석 등, 이미 단일 주제) 제목 유사도만으로 판단 — 기존 동작 유지.
  return titleMatchScore(a.title, b.title, a.matchedKeyword) >= textOnlyThreshold;
}

// 대표 선정: category가 있으면 우선순위 높은 쪽(스파크랩·포트폴리오 > 경쟁사 > 업계동향)을
// 먼저 대표로 삼는다 — 같은 사건이 여러 카테고리로 갈려 수집됐을 때, 겹치는 것 자체는 없애되
// "무슨 얘기인지"는 더 정확한 분류(제목에 포폴사·스파크랩이 언급됐으면 그쪽)로 대표되게 하기
// 위함(2026-08-06, 스카이랩스 상장 기사가 포트폴리오·업계동향 두 카테고리로 수집돼 하나로
// 합쳐졌는데 대표가 덜 정확한 업계동향 쪽으로 뽑히던 사례로 발견). category 정보가 없는
// 호출부(대시보드 미리보기 등)는 이 우선순위가 전부 0이라 기존처럼 제목 길이로만 판단한다.
const CATEGORY_REP_PRIORITY: Record<string, number> = {
  sparklabs_self: 4,
  portfolio_company: 4,
  competitor: 2,
  industry_trend: 1,
};
function repPriority(category?: string | null): number {
  return CATEGORY_REP_PRIORITY[category ?? ''] ?? 0;
}

export function clusterArticles<T extends ClusterableArticle>(
  list: T[],
  opts?: { maxDateDiffDays?: number; textOnlyThreshold?: number },
): ArticleCluster<T>[] {
  const maxDateDiffDays = opts?.maxDateDiffDays ?? Infinity;
  const textOnlyThreshold = opts?.textOnlyThreshold ?? 1;
  const clusters: ArticleCluster<T>[] = [];

  for (const article of list) {
    let bestCluster: ArticleCluster<T> | null = null;
    let bestRank = -Infinity;
    for (const cluster of clusters) {
      // 대표뿐 아니라 이미 묶인 기사 전부와 비교 — 표현이 조금씩 이어지는 변형 체인을 놓치지 않는다.
      for (const member of [cluster.rep, ...cluster.others]) {
        if (!isMatch(article, member, maxDateDiffDays, textOnlyThreshold)) continue;
        const rank = -daysBetween(article.pubDate, member.pubDate); // 발행일 더 가까운 클러스터 우선
        if (rank > bestRank) { bestRank = rank; bestCluster = cluster; }
      }
    }
    if (bestCluster) {
      const artPri = repPriority(article.category);
      const repPri = repPriority(bestCluster.rep.category);
      // 카테고리 우선순위가 더 높으면 무조건 교체, 같으면 기존처럼 더 간결한(짧은) 제목을 대표로.
      const shouldReplace = artPri > repPri || (artPri === repPri && article.title.length < bestCluster.rep.title.length);
      if (shouldReplace) {
        bestCluster.others.push(bestCluster.rep);
        bestCluster.rep = article;
      } else {
        bestCluster.others.push(article);
      }
    } else {
      clusters.push({ rep: article, others: [] });
    }
  }
  return clusters;
}
