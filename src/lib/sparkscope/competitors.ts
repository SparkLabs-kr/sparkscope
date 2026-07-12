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

/** monitoring-targets.csv에서 competitor만 로드 */
function loadCompetitors(): CompetitorDef[] {
  const targets = getCompetitorTargets();
  return targets.map(t => ({
    name: t.name,
    english: t.englishName || t.name,
    keywords: [t.primaryKeyword, ...t.helperKeywords],
  }));
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
