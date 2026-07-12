/**
 * 경쟁사 모니터링 — data/monitoring-targets.csv 기준
 *
 * [1] category='competitor'인 기업만 필터링
 */
import { matchesAsToken } from './relevance';
import { getCompetitorTargets, type MonitoringTarget } from './monitoring-targets-loader';

export interface CompetitorDef {
  name: string;
  english: string;
  keywords: string[];
}

let competitorsCache: CompetitorDef[] | null = null;

/** monitoring-targets.csv에서 competitor만 로드 */
function loadCompetitors(): CompetitorDef[] {
  if (competitorsCache) return competitorsCache;

  const targets = getCompetitorTargets();
  competitorsCache = targets.map(t => ({
    name: t.name,
    english: t.englishName || t.name,
    keywords: [t.primaryKeyword, ...t.helperKeywords],
  }));
  return competitorsCache;
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

/** Lazy initialization - 첫 접근 시점에 생성 */
let tier1NameSetCache: Set<string> | null = null;
export const TIER1_NAME_SET = new Proxy(new Set<string>(), {
  get(target, prop) {
    if (tier1NameSetCache === null) {
      tier1NameSetCache = buildTier1NameSet();
    }
    return tier1NameSetCache[prop as keyof Set<string>];
  },
}) as Set<string>;

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
