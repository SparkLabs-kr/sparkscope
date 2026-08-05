// Inter(해외 트렌드) 탭 — DB 실시간 데이터 조회 + 섹터 지표 계산
//
// RSS 수집(inter-collect) → Gemini 필터링(inter-filter) →
// GPT 포트폴리오 매칭(inter-portfolio-match) 파이프라인에서 데이터 생성
//
// 파일명이 -sample-data 지만 실제 DB 데이터를 다룬다(초기 목업 시절 이름이 남은 것).
//
// ⚠ 2026-08-04 수정: 섹터 배지("긴급"/"모니터링")가 예전엔 배열 인덱스로 정해졌다
// (`idx % 2 === 0 ? 'urgent' : 'watch'`, `idx % 3 === 0 ? '긴급' : '모니터링'`).
// 즉 데이터와 아무 관계가 없어서, 항암은 항상 "긴급", 신약발굴은 항상 "모니터링"이 떴고
// 배지 사유 AI 요약은 그 가짜 배지를 정당화하는 문장을 지어내고 있었다.
// 지금은 아래 computeBadge()가 실제 건수·증감률·포트폴리오 매치 수로 배지를 정한다.

import { prisma } from '@/lib/prisma';
import {
  INTER_EVENT_TYPES,
  legacySectorToTopic,
  topicSectorsFor,
} from './sparkscope/inter-taxonomy';
import { nearestSummaryPeriodKey } from './sparkscope/inter-summary-periods';

export type InterDomain = 'bio' | 'ai';
export type InterCountry = 'us' | 'cn' | 'jp' | 'sa' | 'other' | 'all';
export type SourceKind = 'news' | 'paper' | 'opinion';
export type AlertLevel = 'urgent' | 'watch' | 'pos';

export const COUNTRY_TABS: { id: InterCountry; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'us', label: '미국' },
  { id: 'cn', label: '중국' },
  { id: 'jp', label: '일본' },
  { id: 'sa', label: '사우디' },
  { id: 'other', label: '기타' },
];

export interface DomainSummary {
  label: string;
  trend: string;
  position: string;
  action: string;
  source: 'ai' | 'fallback';
  computedAt: string | null; // ISO — fallback이면 null
}

export const DOMAIN_LABEL: Record<InterDomain, string> = { bio: '바이오', ai: 'AI' };

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

/**
 * DashboardInsight(kind='inter_summary')에서 도메인 × 기간별 사전계산 요약을 읽는다. 없으면 폴백.
 * since/until은 화면에서 선택한 조회 기간 — 가장 가까운 사전계산 기간(7일/1개월/3개월/1년/3년)의
 * 값을 찾아 반환한다. 이렇게 해야 "가장 많이 걸린 포트폴리오사" 칩(선택 기간 기준 집계)과
 * AI 문장이 같은 기간을 보고 하는 말이 된다.
 */
export async function getDomainSummary(domain: InterDomain, since: Date, until: Date): Promise<DomainSummary> {
  const periodKey = nearestSummaryPeriodKey(since, until);
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: 'inter_summary', key: `${domain}_${periodKey}` } },
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
  hint?: string;
}

// 피드 소스 → 도메인 (Gemini 필터링이 domain을 못 채운 구버전 판정 데이터에 대한 fallback).
const BIO_SOURCES = /Endpoints News|STAT News|Fierce Biotech|BioCentury|BioPharma Dive/i;

function legacyDomainGuess(source: string): InterDomain {
  return BIO_SOURCES.test(source) ? 'bio' : 'ai';
}

type VerdictRow = {
  id: string;
  relevant: boolean;
  domain: string | null;
  sector: string | null;
  topicSector: string | null;
  eventType: string | null;
  country: string | null;
  titleKo: string | null;
  isScrapped: boolean;
  news: { id: string; title: string; url: string; source: string; publishedAt: Date };
};

/** 주제 축 값 — 백필된 topicSector 우선, 없으면 레거시 sector에서 매핑(규제·투자는 매핑 불가 → null). */
function topicOf(v: VerdictRow): string | null {
  return v.topicSector ?? legacySectorToTopic(v.sector);
}

async function getRelevantVerdicts(
  domain: InterDomain,
  since?: Date,
  until?: Date,
  country?: InterCountry,
): Promise<VerdictRow[]> {
  const publishedAt =
    since || until ? { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } : undefined;
  const verdicts = await prisma.interNewsVerdict.findMany({
    where: {
      relevant: true,
      ...(publishedAt ? { news: { publishedAt } } : {}),
      // country가 아직 안 채워진 구버전 판정 데이터가 537건 있어서, 국가 필터를 걸면
      // 그 데이터는 빠진다(전체 탭에서만 보인다).
      ...(country && country !== 'all' ? { country } : {}),
    },
    select: {
      id: true, relevant: true, domain: true, sector: true, topicSector: true, eventType: true,
      country: true, titleKo: true, isScrapped: true,
      news: { select: { id: true, title: true, url: true, source: true, publishedAt: true } },
    },
  });
  let filtered = verdicts.filter(v => (v.domain ?? legacyDomainGuess(v.news.source)) === domain);
  // country=undefined/'all'이면 전체. 국가 미판별(레거시) 기사는 특정 국가 탭에는 안 잡히고 '전체'에서만 보인다.
  if (country && country !== 'all') filtered = filtered.filter(v => v.country === country);
  return filtered;
}

// 도메인+기간에 대한 verdict/match를 한 번만 조회해서 stats·sectors 양쪽에 재사용.
// prevVerdicts(직전 동일 기간)는 섹터별 증감률(momentum) 계산용.
export interface InterData {
  verdicts: VerdictRow[];
  prevVerdicts: VerdictRow[];
  matches: { id: string; verdictId: string; companyName: string; reason: string }[];
  range: { since: Date; until: Date } | null;
}

export async function loadInterData(
  domain: InterDomain,
  since?: Date,
  until?: Date,
  country: InterCountry = 'all',
): Promise<InterData> {
  // 직전 동일 기간 — "지난 3개월 대비 이번 3개월" 비교용
  let prevSince: Date | undefined;
  let prevUntil: Date | undefined;
  if (since && until) {
    const span = until.getTime() - since.getTime();
    prevUntil = new Date(since.getTime() - 1);
    prevSince = new Date(prevUntil.getTime() - span);
  }

  const [verdicts, prevVerdicts] = await Promise.all([
    getRelevantVerdicts(domain, since, until, country),
    prevSince && prevUntil ? getRelevantVerdicts(domain, prevSince, prevUntil, country) : Promise.resolve([]),
  ]);
  const matches = await prisma.interPortfolioMatch.findMany({
    where: { verdictId: { in: verdicts.map(v => v.id) } },
    select: { id: true, verdictId: true, companyName: true, reason: true },
  });
  return { verdicts, prevVerdicts, matches, range: since && until ? { since, until } : null };
}

export function getDomainStats({ verdicts, matches }: InterData): InterStat[] {
  return [
    { label: '수집·선별된 기사', value: String(verdicts.length), hint: 'AI 관련성 판정을 통과한 해외 기사·논문 수' },
    { label: '포트폴리오 매치', value: String(matches.length), hint: '포트폴리오사와 연결된다고 판정된 건수' },
    { label: '매칭 기업 수', value: String(new Set(matches.map(m => m.companyName)).size), hint: '한 건이라도 매칭된 포트폴리오사 수' },
    { label: '데이터 소스', value: String(new Set(verdicts.map(v => v.news.source)).size), hint: '기사를 가져온 해외 매체 수' },
  ];
}

export interface PortfolioMatch {
  co: string;
  desc: string;
}

export interface SourceItem {
  id: string;            // verdictId — 스크랩 토글 키
  badge: SourceKind;
  title: string;         // 한국어 번역 제목 (없으면 원문)
  titleOriginal: string;
  url: string;
  media: string;
  date: string;
  alert: AlertLevel;
  isScrapped: boolean;
}

// 섹터 배지 — 실제 데이터에서 계산한다(예전 idx 기반 가짜 배지 대체).
export type BadgeKind = 'surge' | 'opportunity' | 'major' | 'quiet' | 'none';

export interface SectorMetrics {
  count: number;
  prevCount: number;
  deltaPct: number | null;      // 직전 동일 기간 대비 증감률. 직전 0건이면 비교 불가(null)
  share: number;                // 도메인 전체 중 이 섹터 비중 (0~1)
  matchCount: number;
  matchedCompanies: string[];
  sourceCount: number;
  paperCount: number;
  latestDate: string | null;
  timeline: number[];           // 기간을 12구간으로 나눈 건수 (스파크라인용)
}

export interface SectorBlock {
  id: string;
  sectorKey: string;
  icon: string;
  name: string;
  sub: string;
  badge: { kind: BadgeKind; label: string; why: string };
  metrics: SectorMetrics;
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

/**
 * 섹터 배지 판정 규칙 — 화면에 뜬 라벨을 숫자로 되짚을 수 있어야 한다.
 *  - 0건            → '데이터 없음'
 *  - 증감 +50% 이상 & 4건 이상 → '급증'   (직전 동일 기간 대비)
 *  - 포트폴리오 매치 3건 이상   → '기회'   (우리 포트폴리오와 직접 연결)
 *  - 도메인 내 비중 12% 이상   → '주요 흐름'
 *  - 그 외                    → '관측 중'
 * why에는 그 판정의 근거 숫자를 그대로 담는다(AI 요약 프롬프트·툴팁에 재사용).
 */
export function computeBadge(m: SectorMetrics): { kind: BadgeKind; label: string; why: string } {
  if (m.count === 0) return { kind: 'none', label: '데이터 없음', why: '이 기간 수집된 기사 0건' };
  if (m.deltaPct !== null && m.deltaPct >= 50 && m.count >= 4)
    return { kind: 'surge', label: '급증', why: `직전 동일 기간 ${m.prevCount}건 → ${m.count}건 (${m.deltaPct > 0 ? '+' : ''}${m.deltaPct}%)` };
  if (m.matchCount >= 3)
    return { kind: 'opportunity', label: '기회', why: `포트폴리오 매치 ${m.matchCount}건 (${m.matchedCompanies.slice(0, 3).join(', ')})` };
  if (m.share >= 0.12)
    return { kind: 'major', label: '주요 흐름', why: `이 도메인 기사 전체의 ${Math.round(m.share * 100)}% (${m.count}건)` };
  return { kind: 'quiet', label: '관측 중', why: `${m.count}건, 직전 대비 ${m.deltaPct === null ? '비교 불가' : `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct}%`}` };
}

function bucketTimeline(dates: Date[], range: { since: Date; until: Date } | null, buckets = 12): number[] {
  if (!range || dates.length === 0) return new Array(buckets).fill(0);
  const span = Math.max(1, range.until.getTime() - range.since.getTime());
  const out = new Array(buckets).fill(0);
  for (const d of dates) {
    const t = d.getTime();
    if (t < range.since.getTime() || t > range.until.getTime()) continue;
    const i = Math.min(buckets - 1, Math.floor(((t - range.since.getTime()) / span) * buckets));
    out[i] += 1;
  }
  return out;
}

export function getSectorData(domain: InterDomain, data: InterData): SectorBlock[] {
  const { verdicts, prevVerdicts, matches, range } = data;
  const matchesByVerdictId = new Map<string, typeof matches>();
  matches.forEach(m => {
    const arr = matchesByVerdictId.get(m.verdictId) ?? [];
    arr.push(m);
    matchesByVerdictId.set(m.verdictId, arr);
  });

  // 주제 축(topicSector) 기준으로 그룹화 — 매트릭스의 행과 동일한 축이라야 화면이 일관된다.
  // 예전엔 레거시 sector로 묶어서 '투자·산업동향'(사건유형)이 한 줄을 차지하고 남의 기사를 빨아들였다.
  const sectors = topicSectorsFor(domain === 'ai' ? 'AI' : '바이오');
  const total = verdicts.length;

  const sectorData: SectorBlock[] = sectors.map(sector => {
    const sectorVerdicts = verdicts.filter(v => topicOf(v) === sector.key);
    const prevCount = prevVerdicts.filter(v => topicOf(v) === sector.key).length;

    const sectorMatches: PortfolioMatch[] = [];
    const matchesSet = new Set<string>();
    let matchCount = 0;
    sectorVerdicts.forEach(v => {
      (matchesByVerdictId.get(v.id) ?? []).forEach(m => {
        matchCount += 1;
        const key = `${m.companyName}|${m.reason}`;
        if (!matchesSet.has(key)) {
          sectorMatches.push({ co: m.companyName, desc: m.reason });
          matchesSet.add(key);
        }
      });
    });

    const items: Record<SourceKind, SourceItem[]> = { news: [], paper: [], opinion: [] };
    sectorVerdicts
      .slice()
      .sort((a, b) => b.news.publishedAt.getTime() - a.news.publishedAt.getTime())
      .forEach(v => {
        const kind = getSourceKind(v.news.source);
        items[kind].push({
          id: v.id,
          badge: kind,
          title: truncate(v.titleKo || v.news.title),
          titleOriginal: v.news.title,
          url: v.news.url,
          media: v.news.source,
          date: formatDate(v.news.publishedAt),
          alert: getAlertLevel(v.relevant),
          isScrapped: v.isScrapped,
        });
      });

    const dates = sectorVerdicts.map(v => v.news.publishedAt);
    const latest = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
    const metrics: SectorMetrics = {
      count: sectorVerdicts.length,
      prevCount,
      deltaPct: prevCount > 0 ? Math.round(((sectorVerdicts.length - prevCount) / prevCount) * 100) : null,
      share: total > 0 ? sectorVerdicts.length / total : 0,
      matchCount,
      matchedCompanies: Array.from(new Set(sectorMatches.map(m => m.co))),
      sourceCount: new Set(sectorVerdicts.map(v => v.news.source)).size,
      paperCount: items.paper.length,
      latestDate: latest ? formatDate(latest) : null,
      timeline: bucketTimeline(dates, range),
    };

    return {
      id: `sec-${sector.key}`,
      sectorKey: sector.key,
      icon: sector.icon,
      name: sector.key,
      sub: sector.sub,
      badge: computeBadge(metrics),
      metrics,
      matches: sectorMatches.slice(0, 5),
      items,
    };
  });

  return sectorData;
}

// ── 도메인 전체 개요 (#5 요약 블록용) — 전부 실제 집계값 ──
export interface InterOverview {
  domainLabel: string;
  total: number;
  prevTotal: number;
  deltaPct: number | null;
  sourceCount: number;
  paperCount: number;
  matchCount: number;
  matchedCompanyCount: number;
  topSectors: { name: string; count: number; deltaPct: number | null; share: number }[];
  topCompanies: { name: string; count: number; sectors: string[] }[];
  byCountry: { id: InterCountry; label: string; count: number }[];
  timeline: { label: string; count: number }[];
  emptySectors: string[];
}

export function buildOverview(domain: InterDomain, data: InterData, sectors: SectorBlock[]): InterOverview {
  const { verdicts, prevVerdicts, matches, range } = data;
  const total = verdicts.length;

  const byCompany = new Map<string, { count: number; sectors: Set<string> }>();
  const sectorOfVerdict = new Map(verdicts.map(v => [v.id, topicOf(v) ?? '분류 전']));
  for (const m of matches) {
    let e = byCompany.get(m.companyName);
    if (!e) { e = { count: 0, sectors: new Set() }; byCompany.set(m.companyName, e); }
    e.count += 1;
    e.sectors.add(sectorOfVerdict.get(m.verdictId) ?? '기타');
  }

  const countryCount = new Map<string, number>();
  for (const v of verdicts) countryCount.set(v.country ?? 'unknown', (countryCount.get(v.country ?? 'unknown') ?? 0) + 1);

  // 타임라인 — 기간 길이에 따라 주/월 버킷
  const timeline: { label: string; count: number }[] = [];
  if (range) {
    const days = Math.max(1, Math.round((range.until.getTime() - range.since.getTime()) / 86400000));
    const byMonth = days > 92;
    const key = (d: Date) => (byMonth ? `${d.getFullYear()}.${d.getMonth() + 1}` : `${d.getMonth() + 1}/${d.getDate()}`);
    const bucket = new Map<string, number>();
    const labels: string[] = [];
    const cur = new Date(range.since);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(range.until);
    let guard = 0;
    while (cur <= end && guard < 1200) {
      const k = key(cur);
      if (labels[labels.length - 1] !== k) { labels.push(k); bucket.set(k, 0); }
      cur.setDate(cur.getDate() + (byMonth ? 1 : 7));
      guard++;
    }
    for (const v of verdicts) {
      // 주 단위 버킷은 라벨 간격이 7일이므로 가장 가까운 이전 라벨에 넣는다
      const d = v.news.publishedAt;
      if (byMonth) {
        const k = key(d);
        if (bucket.has(k)) bucket.set(k, (bucket.get(k) ?? 0) + 1);
      } else {
        const idx = Math.min(labels.length - 1, Math.max(0, Math.floor((d.getTime() - range.since.getTime()) / (7 * 86400000))));
        const k = labels[idx];
        if (k) bucket.set(k, (bucket.get(k) ?? 0) + 1);
      }
    }
    labels.forEach(l => timeline.push({ label: l, count: bucket.get(l) ?? 0 }));
  }

  return {
    domainLabel: DOMAIN_LABEL[domain],
    total,
    prevTotal: prevVerdicts.length,
    deltaPct: prevVerdicts.length > 0 ? Math.round(((total - prevVerdicts.length) / prevVerdicts.length) * 100) : null,
    sourceCount: new Set(verdicts.map(v => v.news.source)).size,
    paperCount: sectors.reduce((s, x) => s + x.metrics.paperCount, 0),
    matchCount: matches.length,
    matchedCompanyCount: byCompany.size,
    topSectors: sectors
      .slice()
      .sort((a, b) => b.metrics.count - a.metrics.count)
      .slice(0, 4)
      .map(s => ({ name: s.name, count: s.metrics.count, deltaPct: s.metrics.deltaPct, share: s.metrics.share })),
    topCompanies: Array.from(byCompany.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([name, e]) => ({ name, count: e.count, sectors: Array.from(e.sectors) })),
    byCountry: COUNTRY_TABS.filter(c => c.id !== 'all').map(c => ({ id: c.id, label: c.label, count: countryCount.get(c.id) ?? 0 })),
    timeline,
    emptySectors: sectors.filter(s => s.metrics.count === 0).map(s => s.name),
  };
}

// ── 주제 × 사건유형 매트릭스 ──────────────────────────────────────────
// 셀 하나가 "항암 × 투자·딜" 조합이고, 클릭하면 그 조합의 판정 근거·매치기업·대표기사가 열린다.
// 전부 실제 집계값이며 AI 호출 없음(문장을 지어내지 않는다).

export interface MatrixCell {
  id: string;                 // "cell-항암-투자·딜"
  topicKey: string;
  eventKey: string;
  count: number;
  prevCount: number;
  deltaPct: number | null;
  matchCount: number;
  matchedCompanies: string[];
  badge: { kind: BadgeKind; label: string; why: string };
  topItems: SourceItem[];     // 대표 기사 (최신 3건)
}

export interface MatrixRow {
  topicKey: string;
  icon: string;
  sub: string;
  total: number;
  prevTotal: number;
  deltaPct: number | null;
  cells: MatrixCell[];
}

export interface InterMatrix {
  eventTypes: { key: string; icon: string; sub: string }[];
  rows: MatrixRow[];
  maxCell: number;
  /** 백필이 아직 안 닿아 주제/사건유형이 비어 매트릭스에 못 들어간 건수 */
  untagged: number;
  headline: {
    total: number;
    prevTotal: number;
    deltaPct: number | null;
    hottest: { label: string; count: number; prevCount: number; deltaPct: number | null } | null;
    matchCount: number;
    matchedCompanyCount: number;
    /** 포트폴리오 매치가 하나라도 있는 주제 수 / 전체 주제 수 (칸 단위가 아니라 주제 단위) */
    overlapTopicCount: number;
    totalTopicCount: number;
    overlapTopics: string[];
  };
}

/**
 * 셀 배지 — 셀은 건수가 작으므로 섹터(computeBadge)보다 문턱을 낮춘다.
 * why에는 판정 근거 숫자를 그대로 담아 화면에서 되짚을 수 있게 한다.
 */
function computeCellBadge(m: { count: number; prevCount: number; deltaPct: number | null; matchCount: number; matchedCompanies: string[] }): { kind: BadgeKind; label: string; why: string } {
  if (m.count === 0) return { kind: 'none', label: '데이터 없음', why: '이 조합에 해당하는 기사가 없습니다' };
  // '급증'은 비교 기준이 실제로 있을 때만 붙인다(prevCount > 0).
  // 직전 기간이 0건인 건 "폭증"이 아니라 "비교할 게 없음"인 경우가 대부분이다 —
  // 수집 백필이 기간마다 고르지 않으면 직전이 0으로 잡혀서 거의 모든 칸이 급증으로 물든다.
  if (m.prevCount > 0 && m.deltaPct !== null && m.deltaPct >= 50 && m.count >= 3)
    return { kind: 'surge', label: '급증', why: `직전 동일 기간 ${m.prevCount}건 → ${m.count}건 (+${m.deltaPct}%)` };
  if (m.matchCount >= 2)
    return { kind: 'opportunity', label: '기회', why: `포트폴리오 매치 ${m.matchCount}건 (${m.matchedCompanies.slice(0, 3).join(', ')})` };
  if (m.count >= 4)
    return { kind: 'major', label: '주요 흐름', why: `${m.count}건 · 직전 ${m.prevCount}건` };
  return { kind: 'quiet', label: '관측 중', why: `${m.count}건, 직전 대비 ${m.deltaPct === null ? '비교 불가' : `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct}%`}` };
}

export function buildMatrix(domain: InterDomain, data: InterData): InterMatrix {
  const { verdicts, prevVerdicts, matches } = data;
  const topics = topicSectorsFor(domain === 'ai' ? 'AI' : '바이오');
  const events = INTER_EVENT_TYPES;

  const matchesByVerdictId = new Map<string, typeof matches>();
  matches.forEach(m => {
    const arr = matchesByVerdictId.get(m.verdictId) ?? [];
    arr.push(m);
    matchesByVerdictId.set(m.verdictId, arr);
  });

  const rows: MatrixRow[] = topics.map(topic => {
    const topicVerdicts = verdicts.filter(v => topicOf(v) === topic.key);
    const prevTopicVerdicts = prevVerdicts.filter(v => topicOf(v) === topic.key);

    const cells: MatrixCell[] = events.map(ev => {
      const cellVerdicts = topicVerdicts.filter(v => v.eventType === ev.key);
      const prevCount = prevTopicVerdicts.filter(v => v.eventType === ev.key).length;

      const companies = new Set<string>();
      let matchCount = 0;
      cellVerdicts.forEach(v => {
        (matchesByVerdictId.get(v.id) ?? []).forEach(m => {
          matchCount += 1;
          companies.add(m.companyName);
        });
      });

      const topItems: SourceItem[] = cellVerdicts
        .slice()
        .sort((a, b) => b.news.publishedAt.getTime() - a.news.publishedAt.getTime())
        .slice(0, 3)
        .map(v => {
          const kind = getSourceKind(v.news.source);
          return {
            id: v.id,
            badge: kind,
            title: truncate(v.titleKo || v.news.title),
            titleOriginal: v.news.title,
            url: v.news.url,
            media: v.news.source,
            date: formatDate(v.news.publishedAt),
            alert: getAlertLevel(v.relevant),
            isScrapped: v.isScrapped,
          };
        });

      const base = {
        count: cellVerdicts.length,
        prevCount,
        deltaPct: prevCount > 0 ? Math.round(((cellVerdicts.length - prevCount) / prevCount) * 100) : null,
        matchCount,
        matchedCompanies: Array.from(companies),
      };

      return {
        id: `cell-${topic.key}-${ev.key}`,
        topicKey: topic.key,
        eventKey: ev.key,
        ...base,
        badge: computeCellBadge(base),
        topItems,
      };
    });

    return {
      topicKey: topic.key,
      icon: topic.icon,
      sub: topic.sub,
      total: topicVerdicts.length,
      prevTotal: prevTopicVerdicts.length,
      deltaPct: prevTopicVerdicts.length > 0
        ? Math.round(((topicVerdicts.length - prevTopicVerdicts.length) / prevTopicVerdicts.length) * 100)
        : null,
      cells,
    };
  });

  const allCells = rows.flatMap(r => r.cells);
  const filled = allCells.filter(c => c.count > 0);

  // 가장 뜨거운 칸 — 증감률로 고르되 (1) 최소 3건, (2) 직전 기간에 비교할 값이 있어야 한다.
  // 직전 0건을 "무한대 증가"로 치면, 수집 백필이 기간마다 고르지 않을 때 아무 의미 없는
  // 1~2건 칸이 1위를 차지한다. 비교 가능한 칸이 하나도 없으면 그냥 건수 1위로 대체한다.
  const MIN_HOT = 3;
  const comparable = filled.filter(c => c.count >= MIN_HOT && c.prevCount > 0 && c.deltaPct !== null);
  const hottestCell = comparable.length > 0
    ? comparable.slice().sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0) || b.count - a.count)[0]
    : filled.slice().sort((a, b) => b.count - a.count)[0];

  const overlap = filled.filter(c => c.matchCount > 0);
  const overlapTopicSet = new Set(overlap.map(c => c.topicKey));

  return {
    eventTypes: events.map(e => ({ key: e.key, icon: e.icon, sub: e.sub })),
    rows,
    maxCell: Math.max(1, ...allCells.map(c => c.count)),
    untagged: verdicts.filter(v => !topicOf(v) || !v.eventType).length,
    headline: {
      total: verdicts.length,
      prevTotal: prevVerdicts.length,
      deltaPct: prevVerdicts.length > 0
        ? Math.round(((verdicts.length - prevVerdicts.length) / prevVerdicts.length) * 100)
        : null,
      hottest: hottestCell
        ? {
            label: `${hottestCell.topicKey} × ${hottestCell.eventKey}`,
            count: hottestCell.count,
            prevCount: hottestCell.prevCount,
            deltaPct: hottestCell.deltaPct,
          }
        : null,
      matchCount: matches.length,
      matchedCompanyCount: new Set(matches.map(m => m.companyName)).size,
      // "칸" 단위(주제×사건유형, 25개)는 매트릭스 구조를 몰라야 이해가 안 되는 숫자라
      // 화면에는 사람이 바로 아는 단위인 "주제"(항암, 신약발굴 등, topics.length개) 기준으로 노출한다.
      overlapTopicCount: overlapTopicSet.size,
      totalTopicCount: rows.length,
      overlapTopics: Array.from(overlapTopicSet).slice(0, 3),
    },
  };
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
