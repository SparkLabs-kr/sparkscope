/**
 * 같은 사건을 다룬 기사(매체만 다름)를 대표 기사 1개 + 나머지로 묶는 클러스터링.
 * 제목이 글자 하나까지 같지 않아도 같은 사건이면 한 그룹으로 묶기 위해 문자 bigram 유사도를 쓴다.
 * 형태소 분석기 없이도 "로브스터, 스파크랩 시드 투자 유치" vs "토스 창업자 설립 프라이빗
 * 메신저 '로브스터', 스파크랩서 시드 투자 유치" 같은 케이스를 잡아낸다.
 */

export interface ClusterableArticle {
  id: string;
  title: string;
}

export interface ArticleCluster<T> {
  rep: T;
  others: T[];
}

export const CLUSTER_TITLE_THRESHOLD = 0.65;

function normalizeTitle(title: string): string {
  return title.replace(/[\[\]'"‘’“”()·,.\-–—0-9\s]/g, '').toLowerCase();
}

function bigramSet(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// containment 계수(교집합/짧은쪽 크기) — 부제가 붙어 길이가 크게 달라도, 짧은 제목의
// bigram이 긴 제목 안에 거의 다 들어있으면 같은 사건으로 판단.
function titleSimilarity(a: string, b: string): number {
  const A = bigramSet(normalizeTitle(a));
  const B = bigramSet(normalizeTitle(b));
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  for (const g of A) if (B.has(g)) overlap++;
  return overlap / Math.min(A.size, B.size);
}

// 대표는 그룹 내 가장 간결한(짧은) 제목 — 부제가 덕지덕지 붙은 제목보다 핵심만 담겨 있어 대표로 적합.
export function clusterArticles<T extends ClusterableArticle>(
  list: T[],
  threshold = CLUSTER_TITLE_THRESHOLD,
): ArticleCluster<T>[] {
  const clusters: ArticleCluster<T>[] = [];
  for (const article of list) {
    let bestCluster: ArticleCluster<T> | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = titleSimilarity(article.title, cluster.rep.title);
      if (score > bestScore) { bestScore = score; bestCluster = cluster; }
    }
    if (bestCluster && bestScore >= threshold) {
      if (article.title.length < bestCluster.rep.title.length) {
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
