// Inter(해외 트렌드) 탭 — DB 실시간 데이터 조회
//
// RSS 수집(inter-collect) → Gemini 필터링(inter-filter) →
// GPT 포트폴리오 매칭(inter-portfolio-match) 파이프라인에서 데이터 생성

import { prisma } from '@/lib/prisma';
import { trendSectorsFor } from './sparkscope/inter-taxonomy';

export type InterDomain = 'bio' | 'ai';
export type InterCountry = 'us' | 'cn' | 'jp' | 'sa' | 'all';
export type SourceKind = 'news' | 'paper' | 'opinion';
export type AlertLevel = 'urgent' | 'watch' | 'pos';

export const COUNTRY_TABS: { id: InterCountry; label: string }[] = [
  { id: 'us', label: '미국' },
  { id: 'cn', label: '중국' },
  { id: 'jp', label: '일본' },
  { id: 'sa', label: '사우디' },
  { id: 'all', label: '전체' },
];

export interface DomainSummary {
  label: string;
  trend: string;
  position: string;
  action: string;
  source: 'ai' | 'fallback';
  computedAt: string | null; // ISO — fallback이면 null
}

const DOMAIN_LABEL: Record<InterDomain, string> = { bio: '바이오', ai: 'AI' };

// 사전계산(DashboardInsight) 전이거나 실패했을 때만 쓰는 기본값 — 특정 트렌드처럼 보이지 않게 일반적인 문구로.
const FALLBACK_SUMMARY: Record<InterDomain, Omit<DomainSummary, 'label' | 'source' | 'computedAt'>> = {
  bio: {
    trend: '아직 AI 요약이 준비되지 않았습니다 (다음 수집 배치에서 자동 생성됩니다).',
    position: '-',
    action: '-',
  },
  ai: {
    trend: '아직 AI 요약이 준비되지 않았습니다 (다음 수집 배치에서 자동 생성됩니다).',
    position: '-',
    action: '-',
  },
};

/** DashboardInsight(kind='inter_summary')에서 도메인별 사전계산 요약을 읽는다. 없으면 폴백. */
export async function getDomainSummary(domain: InterDomain): Promise<DomainSummary> {
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: 'inter_summary', key: domain } },
  });
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed?.trend && parsed?.position && parsed?.action) {
        return {
          label: DOMAIN_LABEL[domain],
          trend: parsed.trend,
          position: parsed.position,
          action: parsed.action,
          source: 'ai',
          computedAt: row.computedAt.toISOString(),
        };
      }
    } catch {
      // 저장된 값이 깨져 있으면 폴백으로 처리
    }
  }
  return { label: DOMAIN_LABEL[domain], ...FALLBACK_SUMMARY[domain], source: 'fallback', computedAt: null };
}

export interface InterStat {
  label: string;
  value: string;
}

// 피드 소스 → 도메인 (Gemini 필터링이 domain을 못 채운 구버전 판정 데이터에 대한 fallback).
const BIO_SOURCES = /Endpoints News|STAT News|Fierce Biotech|BioCentury|BioPharma Dive/i;

function legacyDomainGuess(source: string): InterDomain {
  return BIO_SOURCES.test(source) ? 'bio' : 'ai';
}

async function getRelevantVerdictsForDomain(domain: InterDomain, since?: Date, country?: InterCountry) {
  const verdicts = await prisma.interNewsVerdict.findMany({
    where: {
      relevant: true,
      ...(since ? { news: { publishedAt: { gte: since } } } : {}),
    },
    include: { news: true },
  });
  let filtered = verdicts.filter(v => (v.domain ?? legacyDomainGuess(v.news.source)) === domain);
  // country=undefined/'all'이면 전체. 국가 미판별(레거시) 기사는 특정 국가 탭에는 안 잡히고 '전체'에서만 보인다.
  if (country && country !== 'all') filtered = filtered.filter(v => v.country === country);
  return filtered;
}

// 도메인+기간에 대한 verdict/match를 한 번만 조회해서 stats·sectors 양쪽에 재사용
export interface InterData {
  verdicts: Awaited<ReturnType<typeof getRelevantVerdictsForDomain>>;
  matches: { id: string; verdictId: string; companyName: string; reason: string }[];
}

export async function loadInterData(domain: InterDomain, since?: Date, country?: InterCountry): Promise<InterData> {
  const verdicts = await getRelevantVerdictsForDomain(domain, since, country);
  const matches = await prisma.interPortfolioMatch.findMany({
    where: { verdictId: { in: verdicts.map(v => v.id) } },
  });
  return { verdicts, matches };
}

export function getDomainStats({ verdicts, matches }: InterData): InterStat[] {
  return [
    { label: '필터링됨 (관련)', value: String(verdicts.length) },
    { label: '포트폴리오 매치', value: String(matches.length) },
    { label: '매칭 기업 수', value: String(new Set(matches.map(m => m.companyName)).size) },
    { label: '데이터 소스', value: String(new Set(verdicts.map(v => v.news.source)).size) },
  ];
}

export interface PortfolioMatch {
  co: string;
  desc: string;
}

export interface SourceItem {
  badge: SourceKind;
  title: string;       // 한국어 번역 제목 (없으면 원문)
  titleOriginal: string;
  url: string;
  media: string;
  date: string;
  alert: AlertLevel;
}

export interface SectorBlock {
  id: string;
  icon: string;
  name: string;
  sub: string;
  badge: { cls: 'urgent' | 'watch' | 'pos' | 'neu'; label: string };
  matches: PortfolioMatch[];
  items: Record<SourceKind, SourceItem[]>;
}

function getSourceKind(source: string): SourceKind {
  const paper = /Nature|Cell|Science|Scientific American|arXiv/i;
  const opinion = /MIT|Review|Harvard|Telegraph|칼럼|기고/i;

  if (paper.test(source)) return 'paper';
  if (opinion.test(source)) return 'opinion';
  return 'news';
}

function getAlertLevel(relevant: boolean): AlertLevel {
  return relevant ? 'pos' : 'watch';
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

function truncate(s: string): string {
  return s.length > 70 ? s.slice(0, 67) + '…' : s;
}

export function getSectorData(domain: InterDomain, { verdicts, matches }: InterData): SectorBlock[] {
  const matchesByVerdictId = new Map<string, typeof matches>();
  matches.forEach(m => {
    const arr = matchesByVerdictId.get(m.verdictId) ?? [];
    arr.push(m);
    matchesByVerdictId.set(m.verdictId, arr);
  });

  // 2. 고정 섹터 목록 기준으로 그룹화 — verdict.sector가 그 섹터 key와 일치하는 기사만 포함
  //    (구버전 판정 데이터처럼 sector가 비어 있으면 어느 섹터에도 들어가지 않음)
  const sectors = trendSectorsFor(domain === 'ai' ? 'AI' : '바이오');

  const sectorData: SectorBlock[] = sectors.map((sector, idx) => {
    const sectorVerdicts = verdicts.filter(v => v.sector === sector.key);

    const sectorMatches: PortfolioMatch[] = [];
    const matchesSet = new Set<string>();
    sectorVerdicts.forEach(v => {
      (matchesByVerdictId.get(v.id) ?? []).forEach(m => {
        const key = `${m.companyName}|${m.reason}`;
        if (!matchesSet.has(key)) {
          sectorMatches.push({ co: m.companyName, desc: m.reason });
          matchesSet.add(key);
        }
      });
    });

    const items: Record<SourceKind, SourceItem[]> = {
      news: [],
      paper: [],
      opinion: [],
    };

    sectorVerdicts.forEach(v => {
      const kind = getSourceKind(v.news.source);
      items[kind].push({
        badge: kind,
        title: truncate(v.titleKo || v.news.title),
        titleOriginal: v.news.title,
        url: v.news.url,
        media: v.news.source,
        date: formatDate(v.news.publishedAt),
        alert: getAlertLevel(v.relevant),
      });
    });

    return {
      id: `sec-${sector.key}`,
      icon: sector.icon,
      name: sector.key,
      sub: sector.sub,
      badge: sectorVerdicts.length > 0
        ? { cls: idx % 2 === 0 ? 'urgent' as const : 'watch' as const, label: idx % 3 === 0 ? '긴급' : '모니터링' }
        : { cls: 'neu' as const, label: '데이터 없음' },
      matches: sectorMatches.slice(0, 5),
      items,
    };
  });

  return sectorData;
}

// 레거시: 참고용 소스 목록
export const SOURCE_CANDIDATES: Record<InterDomain, { region: string; outlets: string[] }[]> = {
  ai: [
    { region: 'AI·스타트업 버티컬', outlets: ['TechCrunch', 'The Information', 'VentureBeat', 'CB Insights', 'Wired', 'The Verge', 'Ars Technica'] },
    { region: '의견 & 학술', outlets: ['MIT Technology Review', 'Nature', 'Cell', 'Science', 'Scientific American'] },
    { region: '종합 경제', outlets: ['Bloomberg', 'Wall Street Journal', 'Financial Times', 'Reuters', 'New York Times', 'CNN', 'Washington Post'] },
  ],
  bio: [
    { region: '바이오·헬스케어 버티컬', outlets: ['Endpoints News', 'STAT News', 'Fierce Biotech', 'BioCentury', 'BioPharma Dive'] },
    { region: '의견 & 학술', outlets: ['MIT Technology Review', 'Nature', 'Cell', 'Science', 'Scientific American'] },
  ],
};
