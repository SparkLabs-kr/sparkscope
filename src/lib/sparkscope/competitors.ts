/**
 * 경쟁사 모니터링 — Tier 1 직접 경쟁 액셀러레이터.
 * (기준: competitor-watchlist-tier1.txt)
 *
 * 기사 제목에서 어떤 경쟁사를 다루는지 식별한다.
 * ※ "프라이머 / Primer"는 화장품·페인트 프라이머 등 일반명사 오탐이 많아,
 *    회사 고유 별칭(프라이머사제파트너스·권도균)이 없으면 활동 키워드(투자·데모데이 등)
 *    동반 시에만 경쟁사로 인정한다.
 */
import { matchesAsToken } from './relevance';

export interface CompetitorDef {
  name: string;             // 대표 한글명 (표시용)
  english: string;          // 영문명 (표시용)
  match: string[];          // 토큰 매칭 후보 [일반명들..., 강한별칭...]
  strongFrom?: number;      // match[strongFrom..] 는 회사 고유 별칭(오탐 거의 없음)
  requireActivity?: boolean; // true면 일반명은 활동 키워드 동반 시에만 매칭
}

export const TIER1_COMPETITORS: CompetitorDef[] = [
  { name: '프라이머', english: 'Primer', match: ['프라이머', 'Primer', '프라이머사제파트너스', '권도균'], strongFrom: 2, requireActivity: true },
  { name: '퓨처플레이', english: 'FuturePlay', match: ['퓨처플레이', 'FuturePlay'] },
  { name: '블루포인트파트너스', english: 'Bluepoint Partners', match: ['블루포인트파트너스', '블루포인트', 'Bluepoint'] },
  { name: '본엔젤스', english: 'BonAngels', match: ['본엔젤스벤처파트너스', '본엔젤스', 'BonAngels'] },
  { name: '매쉬업엔젤스', english: 'Mashup Angels', match: ['매쉬업엔젤스', 'Mashup Angels', '매시업엔젤스'] },
  { name: '디캠프', english: 'D.CAMP', match: ['디캠프', 'D.CAMP', '은행권청년창업재단'] },
  { name: '소풍벤처스', english: 'Sopoong Ventures', match: ['소풍벤처스', 'Sopoong'] },
  { name: '더벤처스', english: 'The Ventures', match: ['더벤처스', 'The Ventures'] },
  { name: '씨엔티테크', english: 'CNT Tech', match: ['씨엔티테크', 'CNT테크', 'CNT Tech'] },
];

// 액셀러레이터 활동 키워드 — 노이즈 큰 이름(프라이머)의 오탐 방지용.
const ACTIVITY_KEYWORDS = [
  '투자', '유치', '데모데이', '파트너십', '펀드', '결성', '조성', '포트폴리오',
  '액셀러', '스타트업', '선정', '창업', '벤처', '시드', '라운드', '보육', '육성',
];

function hasActivity(title: string): boolean {
  return ACTIVITY_KEYWORDS.some(k => title.includes(k));
}

/** 기사 제목이 어느 Tier1 경쟁사에 해당하는지 (없으면 null). 목록 순서대로 첫 매칭 우선. */
export function matchCompetitor(title: string): CompetitorDef | null {
  if (!title) return null;
  for (const c of TIER1_COMPETITORS) {
    const strongIdx = c.strongFrom ?? c.match.length;
    const strongHit = c.match.slice(strongIdx).some(m => matchesAsToken(title, m));
    const generalHit = c.match.slice(0, strongIdx).some(m => matchesAsToken(title, m));
    if (!strongHit && !generalHit) continue;
    // 노이즈 큰 이름: 강한 별칭이 없고 일반명만 걸렸다면 활동 키워드가 있어야 인정
    if (c.requireActivity && !strongHit && generalHit && !hasActivity(title)) continue;
    return c;
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
  isTier1: boolean;               // Tier1 직접 경쟁 9곳 여부 (뱃지 표시용)
  count: number;
  negCount: number;
  top3: CompetitorArticle[];      // 최근 기사 상위 3건
  negatives: CompetitorArticle[]; // 부정 기사 전체
}

// Tier1 식별용: 대표명 + 별칭 전체를 하나의 집합으로 (matchedKeyword 대조용)
export const TIER1_NAME_SET: Set<string> = new Set(
  TIER1_COMPETITORS.flatMap(c => [c.name, ...c.match]),
);
export function tier1EnglishOf(name: string): string {
  const hit = TIER1_COMPETITORS.find(c => c.name === name || c.match.includes(name));
  return hit?.english ?? '';
}
