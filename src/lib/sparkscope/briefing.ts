/**
 * 데일리 브리핑(월·수·금 영상)의 헤드라인 데이터.
 *
 * 브리핑은 그날 나간 다이제스트 메일을 재료로 만든다. 메일과 영상이 서로 다른 기사를
 * 고르면 안 되므로, 10:30 발송 크론이 메일용 DigestData를 만든 바로 그 자리에서
 * 헤드라인을 뽑아 저장한다(runner.ts). 영상 파이프라인은 이 스냅샷만 읽는다 —
 * AI 시그널 TOP 5를 파트너 배너용으로 물질화하는 것(signal-publish.ts)과 같은 패턴.
 *
 * 헤드라인은 국내·해외를 합쳐 중요도가 제일 높은 최대 5개다(추천: briefing-reco.ts).
 * 편집자가 검수 콘솔에서 고쳐 저장해 두면(briefing_picks — 아래 DailyEdits) 추천 대신 그걸 쓴다.
 * 고른 것은 "그날" 것만 유효하다 — 지난 발송일에 고른 목록이 다음 발송일에 새어 나가지 않게
 * KST 날짜를 키로 쓴다.
 *
 * 저장은 DashboardInsight(kind/key/value JSON)를 그대로 쓴다 — 스키마 변경 없음.
 */
import { prisma } from '@/lib/prisma';
import type { AnalyzedArticle, DigestData } from './types';
import type { InterDigestCard } from './inter-digest';

export const BRIEFING_MAX = 5;
/** 자동 선정일 때 해외 카드를 몇 개까지 넣을지 — 국내 TOP3 뒤를 채운다. */
const DEFAULT_INTER_SLOTS = 2;

const KIND_SNAPSHOT = 'daily_briefing';
const KIND_PICKS = 'briefing_picks';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface BriefingHeadline {
  kind: 'intra' | 'inter';
  /** 기사 id(국내) 또는 기사 URL(해외 — Inter 카드에는 id가 없다). 검수 콘솔의 선택 키. */
  ref: string;
  title: string;
  /** 대본 재료 — 국내는 AI 한 줄 요약, 해외는 "디지털헬스 × 연구성과" 같은 분류 라벨 */
  summary: string;
  source: string;
  url: string;
  /** 화면 라벨 — "💼 포트폴리오사", "🔭 해외 · AI" */
  label: string;
  /** 해외 카드에 연결된 우리 포트폴리오사 이름 (대본에서 "우리 ○○와 연결" 한마디용) */
  companies?: string[];
}

export interface BriefingSnapshot {
  dateKey: string;
  dateLabel: string;
  headlines: BriefingHeadline[];
  /** 편집자가 고른 목록을 썼는지, 자동 선정인지 — 영상 쪽에서 로그용 */
  source: 'editor' | 'auto';
  computedAt: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '🏢 스파크랩 뉴스',
  portfolio_company: '💼 포트폴리오사',
  portfolio_company_tw: '💼 포트폴리오사 · 대만',
  portfolio_company_gv: '💼 포트폴리오사 · 글로벌',
  competitor: '🤝 AC·VC 업계 동향',
  industry_trend: '🌐 스타트업계 뉴스',
};

/** d는 실제 타임스탬프 — KST 기준 날짜 문자열(YYYY-MM-DD). */
export function kstDateKey(d: Date = new Date()): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

export function intraHeadline(a: AnalyzedArticle & { id?: string }): BriefingHeadline {
  return {
    kind: 'intra',
    ref: a.id ?? a.link,
    title: a.title,
    summary: a.oneLiner || a.title,
    source: a.source,
    url: a.link,
    label: CATEGORY_LABEL[a.category] ?? a.category,
  };
}

export function interHeadline(c: InterDigestCard): BriefingHeadline {
  return {
    kind: 'inter',
    ref: c.url,
    title: c.title,
    summary: c.cellLabel,
    source: c.media,
    url: c.url,
    label: `🔭 해외 · ${c.domainLabel}`,
    companies: c.companies.map(x => x.name),
  };
}

/** 추천(briefing-reco.ts)마저 없을 때의 마지막 대안 — 메일 TOP3 + 해외 카드 상위로 채운다. */
export function defaultHeadlines(data: DigestData): BriefingHeadline[] {
  const intra = data.top3.map(a => intraHeadline(a));
  const inter = (data.inter?.cards ?? []).slice(0, DEFAULT_INTER_SLOTS).map(interHeadline);
  return [...intra, ...inter].slice(0, BRIEFING_MAX);
}

// ── 편집자 수정 (그날 하루치) ─────────────────────────────────────
//
// 편집자가 검수 콘솔에서 저장한 그날의 수정 — 브리핑 헤드라인 + 메일 TOP 3 + 제외 기사.
// 10:30 자동 발송(runner.ts)과 영상이 둘 다 이걸 읽는다.
//
// 이건 "매번 사람이 고른다"는 운영 방식이 아니라, 자동 선정이 우리 기준을 잘 잡을 때까지
// 틀린 걸 바로잡는 장치다. 그래서 자동 선정 결과(autoSuggested)를 같이 남긴다 — 날짜별로
// 쌓이는 "자동이 뭘 골랐고 사람이 뭘로 바꿨나"가 나중에 랭킹을 고칠 근거가 된다.
// 목표는 수정이 0건인 날이 계속되는 것(100% 자동화)이다.
//
// 링크로 저장한다 — 발송 경로는 기사 묶기(클러스터링)를 거치며 id 자리에 링크가 들어오고,
// 검수 화면과 발송 크론이 보는 후보 창도 달라서 id보다 링크가 양쪽에서 안정적으로 맞는다.

export interface DailyEdits {
  /** 브리핑 헤드라인(최대 5). 비어 있으면 자동 선정 */
  headlines: BriefingHeadline[];
  /** 메일 TOP 3로 올린 기사 링크(순서대로). 모자라면 자동 선정으로 채운다 */
  top3Links: string[];
  /** 메일·브리핑에서 뺀 기사 링크 */
  excludedLinks: string[];
  /** 저장 시점에 화면이 보여준 자동 선정 — 사람 수정과 비교하는 기록용 */
  autoSuggested?: { headlines: string[]; top3Links: string[] };
  savedAt?: string;
  savedBy?: string;
}

function hasAnyEdit(e: DailyEdits): boolean {
  return e.headlines.length > 0 || e.top3Links.length > 0 || e.excludedLinks.length > 0;
}

export async function loadDailyEdits(dateKey = kstDateKey()): Promise<DailyEdits | null> {
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: KIND_PICKS, key: dateKey } },
    select: { value: true },
  });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as Partial<DailyEdits>;
    const edits: DailyEdits = {
      headlines: Array.isArray(v.headlines) ? v.headlines.slice(0, BRIEFING_MAX) : [],
      top3Links: Array.isArray(v.top3Links) ? v.top3Links.map(String).slice(0, 3) : [],
      excludedLinks: Array.isArray(v.excludedLinks) ? v.excludedLinks.map(String) : [],
      autoSuggested: v.autoSuggested,
      savedAt: v.savedAt,
      savedBy: v.savedBy,
    };
    return hasAnyEdit(edits) ? edits : null;
  } catch {
    return null;
  }
}

/** 수정이 하나도 없으면(전부 비우면) 행을 지우고 자동 선정으로 돌아간다. */
export async function saveDailyEdits(edits: DailyEdits, dateKey = kstDateKey()): Promise<void> {
  if (!hasAnyEdit(edits)) {
    await prisma.dashboardInsight.deleteMany({ where: { kind: KIND_PICKS, key: dateKey } });
    return;
  }
  const value = JSON.stringify({
    ...edits,
    headlines: edits.headlines.slice(0, BRIEFING_MAX),
    top3Links: edits.top3Links.slice(0, 3),
    savedAt: new Date().toISOString(),
  });
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_PICKS, key: dateKey } },
    create: { kind: KIND_PICKS, key: dateKey, value },
    update: { value },
  });
}

/**
 * 메일 데이터에 그날 수정(제외·TOP 3)을 입힌다. pool은 발송 후보 전체 — 편집자가 고른 기사가
 * 자동 TOP 3 후보 밖에 있어도 찾을 수 있게 넓게 받는다.
 */
export function applyTop3Edits<T extends { link: string }>(
  autoTop3: T[], pool: T[], edits: DailyEdits | null,
): T[] {
  if (!edits) return autoTop3;
  const excluded = new Set(edits.excludedLinks);
  const byLink = new Map(pool.map(a => [a.link, a]));
  const picked: T[] = [];
  for (const link of edits.top3Links) {
    const a = byLink.get(link);
    if (a && !excluded.has(link) && !picked.includes(a)) picked.push(a);
  }
  for (const a of autoTop3) {
    if (picked.length >= 3) break;
    if (!excluded.has(a.link) && !picked.some(p => p.link === a.link)) picked.push(a);
  }
  return picked.slice(0, 3);
}

// ── 발송 시점 스냅샷 ─────────────────────────────────────────────

/**
 * 발송 크론이 메일 데이터를 만든 직후 호출한다. 우선순위: 편집자 선택 → 추천(recommended) →
 * 메일 TOP3 기반 기본값. 같은 날 다시 돌면(수동 재발송 등) 덮어쓴다.
 * 추천은 호출부가 넘긴다 — briefing-reco.ts가 이 파일을 import 하므로 여기서 부르면 순환한다.
 */
export async function publishBriefingSnapshot(
  data: DigestData, recommended: BriefingHeadline[] | null = null, dateKey = kstDateKey(),
): Promise<BriefingSnapshot> {
  const edits = await loadDailyEdits(dateKey);
  const picks = edits && edits.headlines.length > 0
    ? edits.headlines.filter(h => !edits.excludedLinks.includes(h.url))
    : null;
  const excluded = new Set(edits?.excludedLinks ?? []);
  const reco = (recommended ?? []).filter(h => !excluded.has(h.url));
  const snapshot: BriefingSnapshot = {
    dateKey,
    dateLabel: data.dateLabel,
    headlines: picks && picks.length > 0 ? picks : reco.length > 0 ? reco : defaultHeadlines(data),
    source: picks && picks.length > 0 ? 'editor' : 'auto',
    computedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(snapshot);
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_SNAPSHOT, key: dateKey } },
    create: { kind: KIND_SNAPSHOT, key: dateKey, value },
    update: { value },
  });
  return snapshot;
}

export async function loadBriefingSnapshot(dateKey = kstDateKey()): Promise<BriefingSnapshot | null> {
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: KIND_SNAPSHOT, key: dateKey } },
    select: { value: true },
  });
  if (!row) return null;
  try { return JSON.parse(row.value) as BriefingSnapshot; } catch { return null; }
}
