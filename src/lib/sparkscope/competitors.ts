/**
 * 경쟁사 모니터링 — monitoring-targets.csv 기준
 *
 * [1] category='competitor'인 기업만 필터링
 * 주의: 클라이언트 번들에서는 파일 I/O 불가능
 * → 필요시에만 server component에서 호출
 */
import { matchesAsToken } from './relevance';

export interface CompetitorDef {
  name: string;
  english: string;
  keywords: string[];
}

let competitorsCache: CompetitorDef[] | null = null;

/** monitoring-targets.csv에서 competitor만 로드 (server-only) */
function loadCompetitors(): CompetitorDef[] {
  if (competitorsCache) return competitorsCache;

  try {
    // Server Component에서만 실행
    if (typeof window === 'undefined') {
      const { getCompetitorTargets } = require('./monitoring-targets-loader');
      const targets = getCompetitorTargets();
      competitorsCache = targets.map((t: any) => ({
        name: t.name,
        english: t.englishName || t.name,
        keywords: [t.primaryKeyword, ...t.helperKeywords],
      }));
    }
  } catch (e) {
    console.warn('[competitors] loadCompetitors failed:', e);
    competitorsCache = [];
  }

  return competitorsCache || [];
}

export function matchCompetitor(title: string): CompetitorDef | null {
  if (!title) return null;

  const competitors = loadCompetitors();
  for (const c of competitors) {
    for (const keyword of c.keywords) {
      if (matchesAsToken(title, keyword)) {
        return c;
      }
    }
  }

  return null;
}

/** Tier1 식별용 - dashboard/page.tsx 호환성 */
export function buildTier1NameSet(): Set<string> {
  const competitors = loadCompetitors();
  const nameSet = new Set<string>();
  for (const c of competitors) {
    nameSet.add(c.name);
    for (const keyword of c.keywords) {
      nameSet.add(keyword);
    }
  }
  return nameSet;
}

/** Tier1 영문명 조회 - dashboard/page.tsx 호환성 */
export function tier1EnglishOf(name: string): string {
  const competitors = loadCompetitors();
  const hit = competitors.find(c => c.name === name || c.keywords.includes(name));
  return hit?.english ?? '';
}

/** Tier1 이름 집합 (캐시) */
let tier1NameSetCache: Set<string> | null = null;

function getTier1NameSet(): Set<string> {
  if (!tier1NameSetCache) {
    tier1NameSetCache = buildTier1NameSet();
  }
  return tier1NameSetCache;
}

/** dashboard/page.tsx 호환성용 getter */
export const TIER1_NAME_SET = {
  has(name: string): boolean {
    return getTier1NameSet().has(name);
  },
  [Symbol.iterator]() {
    return getTier1NameSet()[Symbol.iterator]();
  },
} as Set<string>;

export interface CompetitorArticle {
  title: string;
  source: string;
  pubDate: Date;
  link: string;
  neg: boolean;
}

export interface CompetitorStat {
  name: string;
  english: string;
  count: number;
  negCount: number;
  top3: CompetitorArticle[];
  negatives: CompetitorArticle[];
}
