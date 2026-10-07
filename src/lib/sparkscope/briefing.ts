/**
 * 데일리 브리핑(월·수·금 영상)의 헤드라인 데이터.
 *
 * 브리핑은 그날 나간 다이제스트 메일을 재료로 만든다. 메일과 영상이 서로 다른 기사를
 * 고르면 안 되므로, 09:30 발송 크론이 메일용 DigestData를 만든 바로 그 자리에서
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
  /** intra 국내 기사 · trend 이번 주 AI 트렌드(signal-feed) · inter 해외 트렌드(Inter 기사) */
  kind: 'intra' | 'trend' | 'inter';
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
  /** daily(수·금) · weekly(월 Claw-e 뉴스데스크). 없으면 daily(예전 기록) */
  program?: BriefingProgram;
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

// ── 방송 일정과 기사 기간 (2026-10-01 소윤 결정) ─────────────────────
//
//   월 09:30 메일 · 09:45 잔디 — 위클리(Claw-e 뉴스데스크)만. 지난주 화 00:00 ~ 일 24:00 기사에서 5개
//   수 09:30 메일 · 09:45 잔디 — 데일리만. 월 09:30(지난 메일) 이후 기사에서 5개
//   금 09:30 메일 · 09:45 잔디 — 데일리만. 수 09:30 이후 기사에서 5개
//
// 검수 화면·추천·영상·메일 크론이 모두 이 함수 하나로 "다음 방송"을 정한다.

export type BriefingProgram = 'daily' | 'weekly';
export const SEND_KST = { h: 9, m: 30 };

export interface BroadcastWindow {
  program: BriefingProgram;
  /** 방송일(KST YYYY-MM-DD) */
  dateKey: string;
  since: Date;
  /** 없으면 지금까지 */
  until?: Date;
  /** "9월 29일부터 10월 4일까지" — 위클리 화면·인사말용 */
  label: string;
}

/** KST 날짜 dateKey의 hh:mm 실제 시각 */
function kstAt(dateKey: string, h: number, m: number, addDays = 0): Date {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + addDays, h - 9, m));
}

/**
 * 지금 기준 다음 방송(또는 오늘 오전 방송). 월·수·금 정오 전이면 오늘 방송, 아니면 다음 월·수·금.
 * 정오를 기준으로 삼는 이유: 09:30 발송·09:45 잔디 뒤 재실행·확인이 오전에 몰리기 때문.
 */
export function broadcastFor(now: Date = new Date()): BroadcastWindow {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  let offset = 0;
  for (; offset < 7; offset++) {
    const dow = (k.getUTCDay() + offset) % 7;
    if ([1, 3, 5].includes(dow) && (offset > 0 || k.getUTCHours() < 12)) break;
  }
  const dateKey = kstDateKey(new Date(now.getTime() + offset * 864e5));
  const dow = (k.getUTCDay() + offset) % 7;
  const md = (t: Date) => { const x = new Date(t.getTime() + KST_OFFSET_MS); return `${x.getUTCMonth() + 1}월 ${x.getUTCDate()}일`; };
  if (dow === 1) {
    const since = kstAt(dateKey, 0, 0, -6);   // 지난 화요일 0시
    const until = kstAt(dateKey, 0, 0);       // 월요일 0시(= 일요일 끝)
    return { program: 'weekly', dateKey, since, until, label: `${md(since)}부터 ${md(new Date(until.getTime() - 1))}까지` };
  }
  const since = kstAt(dateKey, SEND_KST.h, SEND_KST.m, -2); // 수→월, 금→수 09:30
  return { program: 'daily', dateKey, since, label: `${md(since)} 오후부터` };
}

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
// 09:30 자동 발송(runner.ts)과 영상이 둘 다 이걸 읽는다.
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

// 수정은 "다음 방송일" 키로 저장한다 — 목요일에 검수 화면에서 고친 건 금요일 방송분이다(09:30 발송이라
// 전날 미리 고르는 일이 많다). 방송일 오전에 고치면 그날 키가 된다(broadcastFor 정오 기준).
export async function loadDailyEdits(dateKey = broadcastFor().dateKey): Promise<DailyEdits | null> {
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
export async function saveDailyEdits(edits: DailyEdits, dateKey = broadcastFor().dateKey): Promise<void> {
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
 * 잘린 제목("…서울 DDP...") 되살리기 — 수집하는 RSS가 긴 제목을 말줄임으로 잘라 보내 와서(최근 2주 기사의
 * 약 17%), 브리핑 화면·잔디에 "…"로 끝나는 제목이 나갔다(2026-10-07 소윤: "제목은 무조건 끝까지").
 * 스냅샷을 저장할 때 원문 페이지의 og:title을 읽어 원래 제목으로 바꾼다. 앞부분이 같을 때만 바꾸고
 * (엉뚱한 페이지 방지), 실패하면 그대로 둔다 — 발송을 막지 않는다.
 */
const TRUNCATED = /(\.{2,}|…)\s*$/;
async function fullTitle(h: BriefingHeadline): Promise<string> {
  if (!TRUNCATED.test(h.title) || !/^https?:\/\//.test(h.url)) return h.title;
  try {
    const r = await fetch(h.url, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const html = (await r.text()).slice(0, 200_000);
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const og = m ? decode(m[1]).replace(/\s+[-|]\s+[^-|]{1,20}$/, '').trim() : '';
    const head = h.title.replace(TRUNCATED, '').trim();
    const norm = (s: string) => s.replace(/[^0-9a-zA-Z가-힣]/g, '');
    return og && og.length > head.length && norm(og).startsWith(norm(head).slice(0, 15)) ? og : h.title;
  } catch {
    return h.title;
  }
}
export async function completeTitles(headlines: BriefingHeadline[]): Promise<BriefingHeadline[]> {
  return Promise.all(headlines.map(async h => ({ ...h, title: await fullTitle(h) })));
}

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
    program: broadcastFor().program,
    dateLabel: data.dateLabel,
    headlines: await completeTitles(picks && picks.length > 0 ? picks : reco.length > 0 ? reco : defaultHeadlines(data)),
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
