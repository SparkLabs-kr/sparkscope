/**
 * 데일리 브리핑 추천 헤드라인 5개 + 검수 화면의 교체 후보 목록.
 *
 * 추천은 항상 5개, 칸 수를 정해 두고 칸마다 AI가 가장 중요한 기사를 고른다(2026-10-02 소윤 결정):
 *   데일리·위클리 모두  AI 트렌드 2칸 고정(해외 우선) + 나머지 3칸 스파크랩(최대 1) → 포트폴리오
 *   (2026-10-06: 위클리도 데일리와 같은 칸, AI는 해외 우선 — 국내는 해외에서도 다룰 만큼 클 때만)
 * 칸 계산은 quotas(), 선정은 rankWithAI().
 *
 * 바이오는 추천에도 교체 후보에도 넣지 않는다.
 *
 * 수집 1회당 한 번 계산해 DashboardInsight(briefing_reco)에 저장한다 — AI 선정은 부를 때마다
 * 조금씩 다를 수 있고 AI 트렌드 목록도 2시간마다 바뀌므로, 매번 새로 계산하면 "화면에선 A였는데
 * 영상엔 B"가 된다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { buildClusteredPool } from './digest';
import { loadDigestCandidates, buildReviewDigest } from './review';
import { attachInterDigest } from './inter-digest';
import { attachAiSignals } from './signal-digest';
import type { AnalyzedArticle, DigestData } from './types';
import { buildSignalFeed } from './signal-feed';
import { ensureArticleKo } from './translate-content';
import { isBlockedNoise } from './relevance';
import { BRIEFING_MAX, broadcastFor, kstDateKey, type BriefingHeadline, type BroadcastWindow, type BriefingProgram } from './briefing';

const KIND_RECO = 'briefing_reco';
const RANK_MODEL = 'gpt-4.1';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
/** 교체 후보 중 해외 기사 창 — 검수 화면 후보와 같은 7일 */
const PICKER_WINDOW_DAYS = 7;

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '🏢 스파크랩 뉴스',
  portfolio_company: '💼 포트폴리오사',
  portfolio_company_tw: '💼 포트폴리오사 · 대만',
  portfolio_company_gv: '💼 포트폴리오사 · 글로벌',
  competitor: '🤝 AC·VC 업계 동향',
  industry_trend: '🌐 스타트업계 뉴스',
};
const IMPORTANCE_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const TREND_LABEL = '📈 이번 주 AI 트렌드';
/**
 * 주가 시황 기사 — 추천에서만 뺀다(교체 후보에는 남긴다). 분석이 이런 기사에도 HIGH를 줘서,
 * 같은 사건 묶음의 대표로 "스카이랩스 주가 2.51% 하락"이 "타임 헬스테크 500 선정" 대신 뽑혔다
 * (2026-09-28). 묶기 전에 빼야 진짜 뉴스가 대표가 된다.
 */
// "상장 초기 16.98% 하락"처럼 등락률만 다룬 기사도(2026-10-01 위클리 시험에서 포트폴리오 칸에 뽑힘).
const STOCK_TICKER = /주가|특징주|급등락|상한가|하한가|장중|시황|[‘'"]上[’'"]|[‘'"]下[’'"]|\d+(\.\d+)?%\s*(하락|상승|급락|급등)/;
/**
 * 업계 칸(스타트업계·국내 AI)에 올리기엔 약한 기사 — 2026-10-02 데일리 5번에 "안광현 경기대 산학협력부총장
 * 취임"이 스타트업계 소식으로 나갔다(소윤: 오탐).
 *  - 인사·동정(취임·선임·임명·부고): 업계 흐름이 아니라 개인 소식
 *  - 요약이 "○○ 관련 — 매체" 기본 문구: AI가 내용을 못 읽어 대본 재료가 없는 기사
 * 스파크랩·포트폴리오 칸에는 적용하지 않는다 — 우리 회사 대표 선임은 중요한 소식이다.
 */
const PERSONNEL = /취임|선임|임명|신임\s|부임|인사\]|\[인사|동정|부고|별세|영입/;
function weakForBriefing(a: { title: string; oneLiner?: string | null }): boolean {
  return PERSONNEL.test(a.title) || /관련\s*[—-]\s*\S+\s*$/.test(a.oneLiner ?? '');
}
const INTER_LABEL = '🔭 해외 트렌드 · AI';

/** 교체 후보 한 줄 — 헤드라인 + 화면에 보여줄 보조 정보 */
export interface BriefingCandidate extends BriefingHeadline {
  pubDate: string;
  /** 국내: CRITICAL/HIGH/MEDIUM/LOW. 해외·트렌드는 없음 */
  importance?: string;
  /** 해외: 연결된 포트폴리오사 수 */
  matchCount?: number;
}

export interface BriefingRecommendation {
  headlines: BriefingHeadline[];
  program?: BriefingProgram;
  /** 'quota' — 칸 수 + 칸별 AI 선정(9/30~). 'rule'·'ai'는 예전 방식으로 만든 캐시 */
  method: 'ai' | 'rule' | 'quota';
  /** 헤드라인마다 어느 칸(1 스파크랩·2 포트폴리오·3 AI 국내·4 AI 글로벌·5 스타트업계)인지 — headlines와 같은 순서 */
  tiers?: number[];
  /** 이 추천의 근거가 된 수집 완료 시각(ISO) — 바뀌면 다시 계산한다 */
  basis: string;
  computedAt: string;
}

type IntraCandidate = BriefingCandidate & { category: string; company: string };

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** 교체 후보(국내) — 검수 화면 후보 전체, 묶지 않고 중요도 순. 묶으면 대표 1건만 남아 원하는 매체 기사를 못 고른다. */
async function loadIntraPicker(): Promise<IntraCandidate[]> {
  const all = await loadDigestCandidates();
  return [...all]
    .sort((a, b) =>
      (IMPORTANCE_RANK[b.importance] ?? 0) - (IMPORTANCE_RANK[a.importance] ?? 0)
      || b.priorityScore - a.priorityScore)
    .map(a => ({
      kind: 'intra' as const,
      ref: a.id,
      title: a.title,
      summary: a.oneLiner || a.title,
      source: a.source,
      url: a.link,
      label: CATEGORY_LABEL[a.category] ?? a.category,
      pubDate: new Date(a.pubDate).toISOString(),
      importance: a.importance,
      category: a.category,
      company: a.matchedKeyword,
    }));
}

/** 해외 후보 — 관련 판정된 Inter 기사 중 AI만(바이오 제외). 포트폴리오 연결이 많은 것 → 최신 순. */
async function loadInter(windowDays: number): Promise<BriefingCandidate[]> {
  const rows = await prisma.interNewsVerdict.findMany({
    where: { relevant: true, domain: 'ai', news: { publishedAt: { gte: daysAgo(windowDays) } } },
    select: {
      titleKo: true, reason: true,
      news: { select: { title: true, url: true, source: true, publishedAt: true } },
      _count: { select: { matches: true } },
    },
  });
  const seen = new Set<string>();
  return rows
    .filter(r => (seen.has(r.news.url) ? false : (seen.add(r.news.url), true)))
    .sort((a, b) => b._count.matches - a._count.matches
      || b.news.publishedAt.getTime() - a.news.publishedAt.getTime())
    .map(r => ({
      kind: 'inter' as const,
      ref: r.news.url,
      title: r.titleKo || r.news.title,
      summary: r.reason,
      source: r.news.source,
      url: r.news.url,
      label: INTER_LABEL,
      pubDate: r.news.publishedAt.toISOString(),
      matchCount: r._count.matches,
    }));
}

/** 이번 주 AI 트렌드 — 메일의 AI 트렌드 TOP 5와 같은 목록(사전계산을 읽으므로 빠르다). */
async function loadTrends(): Promise<BriefingCandidate[]> {
  const feed = await buildSignalFeed('ai');
  return feed.items.map(it => ({
    kind: 'trend' as const,
    ref: it.url,
    title: it.titleKo || it.title,
    summary: it.summaryKo || it.title,
    source: it.source,
    url: it.url,
    label: TREND_LABEL,
    pubDate: it.publishedAt ?? feed.generatedAt,
  }));
}

/** 화면·저장용 헤드라인만 남긴다(보조 정보 제거). */
function toHeadline(c: BriefingCandidate & Partial<IntraCandidate>): BriefingHeadline {
  const { pubDate: _p, importance: _i, matchCount: _m, category: _c, company: _k, ...h } = c;
  return h;
}
function toCandidate(c: IntraCandidate): BriefingCandidate {
  const { category: _c, company: _k, ...rest } = c;
  return rest;
}

/** 검수 화면 교체 후보 전체. 국내(7일) → AI 트렌드 → 해외 AI(7일). 바이오는 없다. */
export async function loadBriefingCandidates(): Promise<BriefingCandidate[]> {
  const [intra, trends, inter] = await Promise.all([
    loadIntraPicker(),
    loadTrends().catch(() => [] as BriefingCandidate[]),
    loadInter(PICKER_WINDOW_DAYS),
  ]);
  return [...intra.map(toCandidate), ...trends, ...inter];
}

async function currentBasis(): Promise<string> {
  const last = await prisma.runLog.findFirst({
    where: { runType: 'daily-collect', status: 'SUCCESS', finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return last?.finishedAt?.toISOString() ?? 'none';
}

/**
 * 최근 7일 동안 이미 브리핑에 나간 기사 url — 발송 때 저장된 스냅샷(daily_briefing)에서 읽는다.
 * 포트폴리오를 7일까지 넓혀 찾으므로, 이게 없으면 수요일에 나간 기사가 금·월에 또 나간다.
 * 오늘 스냅샷은 빼고 본다(오늘 재발송·재계산 때 자기 자신을 지우지 않게).
 */
/**
 * 같은 기사라도 주소가 바뀌어 들어온다 — 구글 뉴스 중계 주소였다가 원문 주소로 풀리거나, 같은 보도를
 * 다른 매체가 옮겨 싣는다(2026-10-01: 9/30 브리핑의 스카이랩스·국대 AI 기사가 주소만 바뀌어 다시 추천됨).
 * 그래서 주소와 함께 제목(공백·기호·" - 매체" 제거)으로도 맞춘다.
 */
export function titleKey(title: string): string {
  return title.replace(/\s+-\s+[^-]+$/, '').replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase();
}

interface Briefed { has(url: string, title?: string): boolean }

async function recentlyBriefed(): Promise<Briefed> {
  const urls = await recentlyBriefedUrls();
  return {
    has: (url, title) => urls.urls.has(url) || (!!title && urls.titles.has(titleKey(title))),
  };
}

async function recentlyBriefedUrls(): Promise<{ urls: Set<string>; titles: Set<string> }> {
  const today = kstDateKey();
  const keys = Array.from({ length: 7 }, (_, i) => kstDateKey(new Date(Date.now() - (i + 1) * 864e5)));
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: 'daily_briefing', key: { in: keys.filter(k => k !== today) } },
    select: { value: true },
  });
  const urls = new Set<string>();
  const titles = new Set<string>();
  for (const r of rows) {
    try {
      for (const h of (JSON.parse(r.value).headlines ?? [])) { urls.add(h.url); titles.add(titleKey(h.title ?? '')); }
    } catch { /* 깨진 행은 무시 */ }
  }
  titles.delete('');
  return { urls, titles };
}

/**
 * 다이제스트에 실린 기사만 재료로 쓴다(2026-09-28 소윤 결정 — "다이제스트에 나온 것 중 뽑는다,
 * 기간도 다이제스트를 그대로 따라간다"). 예전엔 여기서 3일·7일 창을 따로 잘라서, 다이제스트에
 * 버젓이 실린 스파크랩 기사 3건(9/21~22)이 추천에서는 빠졌다.
 * 검수 화면 미리보기와 같은 조립(review.ts buildReviewDigest)을 쓴다 — 편집자가 보는 메일이 기준.
 */
async function buildDigestForBriefing(w: BroadcastWindow): Promise<DigestData> {
  const candidates = await loadDigestCandidates(w);
  return attachAiSignals(await attachInterDigest(buildReviewDigest(candidates)));
}

function fromArticle(a: AnalyzedArticle & { id?: string }, idByLink: Map<string, string>): IntraCandidate {
  // 구글 뉴스 경유 기사는 제목 끝에 " - 조선비즈" 같은 매체명이 붙어 온다 — 화면·낭독에서 뗀다.
  const title = a.title.replace(/\s+-\s+[^-]{1,20}$/, '').trim() || a.title;
  return {
    kind: 'intra',
    ref: idByLink.get(a.link) ?? a.id ?? a.link,
    title,
    summary: a.oneLiner || a.title,
    source: a.source,
    url: a.link,
    label: CATEGORY_LABEL[a.category] ?? a.category,
    pubDate: new Date(a.pubDate).toISOString(),
    importance: a.importance,
    category: a.category,
    company: a.matchedKeyword,
  };
}

/** 제목에 한글이 있는가 — 영문 기사(같은 사건의 영문판)를 국내 단계에서 거르는 용도 */
const isKorean = (t: string) => /[가-힣]/.test(t);

/** 국내 AI 기업·업계 기사를 가려내는 1차 필터(최종 판단은 AI가 한다). */
const AI_TOPIC = /AI|인공지능|생성형|LLM|GPT|에이전트|챗봇|딥러닝|머신러닝|파운데이션 ?모델|NPU|AI반도체|거대언어/i;

/** 추천 칸 종류 — 화면의 "추천①~⑤"가 이 순서다. */
export const SLOT_LABEL: Record<number, string> = {
  1: '스파크랩', 2: '국내 포트폴리오', 3: '해외 포트폴리오', 4: 'AI 트렌드', 5: '스타트업계',
};

type Group = 'S' | 'P' | 'D' | 'G' | 'T';
const GROUP_TIER: Record<Group, number> = { S: 1, P: 2, D: 3, G: 4, T: 5 };
const GROUP_NAME: Record<Group, string> = {
  S: '스파크랩 자사 소식', P: '국내 포트폴리오사 소식', D: '해외 포트폴리오사 소식(대만·글로벌벤처스)', G: '글로벌 AI 기업·업계 소식', T: '스타트업계 소식',
};

/**
 * 칸 수 — 데일리·위클리 공통, 항상 8개(2026-10-07 소윤 결정, 5개 규칙을 대체):
 *   AI 트렌드 3칸 고정(G — 해외 우선, 국내 AI는 [국내] 표시로 섞여 해외 매체급일 때만)
 *   나머지 5칸: 스파크랩(최대 1, 한국·대만·글로벌벤처스) → 포트폴리오
 *     스파크랩 있으면 국내 포폴 2 · 해외 포폴 2, 없으면 국내 3 · 해외 2 (D = 해외 포트폴리오: 대만·GV)
 *     한쪽 포폴이 모자라면 다른 쪽으로, 그래도 비면 AI 트렌드를 더 → 마지막으로 스타트업계
 */
function quotas(avail: Record<Group, number>): Record<Group, number> {
  const q: Record<Group, number> = { S: 0, P: 0, D: 0, G: 0, T: 0 };
  q.G = Math.min(3, avail.G);
  q.S = Math.min(1, avail.S);
  let room = BRIEFING_MAX - 3 - q.S;            // 포폴 몫 4(스파크랩 있음) 또는 5
  q.D = Math.min(2, avail.D);
  q.P = Math.min(room - 2, avail.P);
  room -= q.P + q.D;
  const moreP = Math.min(room, avail.P - q.P); q.P += moreP; room -= moreP;
  const moreD = Math.min(room, avail.D - q.D); q.D += moreD; room -= moreD;
  room += 3 - q.G;                              // AI가 3개 안 되면 그 칸도 남는다
  const moreG = Math.min(room, avail.G - q.G); q.G += moreG; room -= moreG;
  q.T = Math.min(room, avail.T);
  return q;
}

const RANK_SYSTEM = `당신은 스파크랩(한국의 스타트업 액셀러레이터·VC)의 아침 브리핑 편집자입니다.
임직원이 출근길에 들을 헤드라인을 고릅니다. 그룹마다 정해진 개수만큼, 그 그룹 안에서 가장 중요한 기사를 고르세요.

중요도 기준
- 스파크랩·포트폴리오사에 직접 영향을 주는 사건 > 업계 전반에 큰 사건 > 일반 소식.
- 투자 유치·인수합병·상장·대형 계약·신제품 출시·규제 변화처럼 "사건"이 있는 기사를 우선합니다.
- 주가 등락·행사 스케치·인터뷰·칼럼은 뒤로 미룹니다.
- 같은 사건을 다룬 기사는 그룹이 달라도 하나만 고릅니다(국내 기사와 해외 기사가 같은 사건일 수 있음).
- "글로벌 AI" 그룹은 해외 AI 소식을 우선합니다(OpenAI·Anthropic·구글·메타·엔비디아 등). [국내] 표시 기사는
  해외 주요 매체(로이터·블룸버그·TechCrunch 등)도 다룰 만큼 큰 사건일 때만 고르고, 아니면 해외 기사를 고르세요.

- "해외 포트폴리오사" 그룹은 대만·글로벌벤처스 포트폴리오사 소식입니다. 주가·매출 조회 페이지, 회사명만 우연히 겹친 기사(날씨·일반 명사 등)는 고르지 마세요.

JSON으로만 답하세요: {"picks": {"S": ["S0"], "P": ["P2","P0"], "D": ["D1"], "G": ["G0"], "T": ["T3"]}}
그룹마다 요청한 개수를 정확히 지키고, 요청하지 않은 그룹은 빈 배열로 두세요.`;

async function rankWithAI(
  pools: Record<Group, BriefingCandidate[]>, q: Record<Group, number>, aiEither: boolean,
): Promise<Record<Group, BriefingCandidate[]> | null> {
  const lines: string[] = [];
  (Object.keys(pools) as Group[]).forEach(g => {
    if (q[g] === 0) return;
    lines.push(`\n## ${GROUP_NAME[g]} — ${aiEither && (g === 'D' || g === 'G') ? '국내·글로벌 AI 합쳐 1개' : `${q[g]}개`}`);
    pools[g].forEach((c, i) => lines.push(`${g}${i}. ${c.label.includes('국내') ? '[국내] ' : ''}${g === 'D' && (c as Partial<IntraCandidate>).company ? `[회사: ${(c as Partial<IntraCandidate>).company}] ` : ''}${c.title} — ${c.summary}${c.importance ? ` [${c.importance}]` : ''}`));
  });
  const resp = await openai.chat.completions.create({
    model: RANK_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: RANK_SYSTEM }, { role: 'user', content: lines.join('\n') }],
  });
  const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as { picks?: Partial<Record<Group, string[]>> };
  if (!parsed.picks) return null;
  const out = { S: [], P: [], D: [], G: [], T: [] } as Record<Group, BriefingCandidate[]>;
  (Object.keys(out) as Group[]).forEach(g => {
    for (const id of parsed.picks?.[g] ?? []) {
      const c = pools[g][Number(String(id).replace(/^\D+/, ''))];
      if (c && !out[g].includes(c)) out[g].push(c);
    }
  });
  return out;
}

/**
 * 칸 수에 맞춰 5칸을 채운다 — 재료는 방송 기간(broadcastFor)의 다이제스트 섹션과 AI 트렌드·해외 트렌드.
 * 위클리는 한 주 정리라 "최근 브리핑에 나간 기사 제외"를 하지 않는다.
 */
export async function pickByTiers(w: BroadcastWindow): Promise<{ picked: BriefingCandidate[]; tiers: number[] }> {
  const [briefed, data, candidates] = await Promise.all([
    recentlyBriefed(),
    buildDigestForBriefing(w),
    loadDigestCandidates(w),
  ]);
  const idByLink = new Map(candidates.map(a => [a.link, a.id]));
  const rankOf = (a: { importance?: string }) => IMPORTANCE_RANK[a.importance ?? ''] ?? 0;
  const weekly = w.program === 'weekly';
  const fresh = (c: BriefingCandidate) => weekly || !briefed.has(c.url, c.title);

  // 스파크랩 — 다이제스트 섹션(한국·대만·글로벌벤처스 모두). 지난 브리핑에 나간 기사는 다시 넣지 않는다
  // (2026-10-07 소윤 결정 — 화~금 매일 나가므로 중복을 무조건 막는다. 10-01의 "메일과 맞춰 다시 넣기"를 대체).
  // 같은 사건의 한·영 기사가 두 칸을 차지하지 않게 한국어 기사를 앞에 둔다(1칸만 쓴다).
  const S = [...data.sparklabsArticles]
    .sort((x, y) => Number(isKorean(y.title)) - Number(isKorean(x.title)))
    .map(a => fromArticle(a, idByLink)).filter(fresh);

  // 포트폴리오 — 다이제스트 섹션(회사당 1건). 주가 기사면 같은 회사 다른 기사로. 지난 7일 브리핑에 나간 회사 제외.
  const briefedCompanies = new Set(weekly ? [] : candidates.filter(a => briefed.has(a.link, a.title)).map(a => a.matchedKeyword));
  const byCompany = (company: string) => candidates
    .filter(c => c.matchedKeyword === company && !STOCK_TICKER.test(c.title) && isKorean(c.title))
    .sort((x, y) => rankOf(y) - rankOf(x) || y.priorityScore - x.priorityScore)[0];
  const P = data.portfolioArticles
    .map(a => (STOCK_TICKER.test(a.title) || !isKorean(a.title) ? byCompany(a.matchedKeyword) : a))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map(a => fromArticle(a, idByLink))
    .filter(a => !briefedCompanies.has(a.company) && fresh(a))
    .sort((x, y) => rankOf(y) - rankOf(x))
    .slice(0, 8);

  // 해외 포트폴리오(대만·글로벌벤처스) — 후보 중 회사당 1건, 중요도 순. 제목은 한국어 번역(titleKo)으로 보여 준다.
  // 주가·매출 조회·투자자 목록 같은 페이지는 뺀다(2026-10-07 실측: "稜研科技(7812)營收查詢", "OpenSea - Funding Rounds & List of Investors").
  const OVERSEAS_JUNK = /營收|股市|股價|股票|Funding Rounds|List of Investors|Stock Price|Share Price/i;
  // 다이제스트 후보(우선순위 상위 500건)에 넣으면 국내 기사에 밀려 빠지고, 이름 가드도 한자 제목("耐能")에선
  // 영문 회사명을 못 찾아 떨어진다 — 그래서 따로 읽는다. 무관한 동명 기사("Rain Timecast")는 선정 AI가 거른다.
  const overseasRows = (await prisma.article.findMany({
    where: {
      category: { in: ['portfolio_company_tw', 'portfolio_company_gv'] },
      pubDate: { gte: w.since, ...(w.until ? { lt: w.until } : {}) },
      isNoise: false, analyzedAt: { not: null },
    },
    orderBy: { priorityScore: 'desc' },
    take: 60,
  })).filter(a => !isBlockedNoise(a) && !STOCK_TICKER.test(a.title) && !OVERSEAS_JUNK.test(a.title)
    // 제목이 너무 짧으면(단어 3개 이하·한자 10자 미만) 기사 제목이 아니라 페이지 이름일 때가 많다("Rain Timecast").
    && (a.title.split(/\s+/).length > 3 || /[\u3400-\u9FFF]{10,}/.test(a.title)))
    .map(a => ({ ...a, importance: a.importance ?? 'LOW', oneLiner: a.oneLiner ?? a.title, priorityScore: a.priorityScore ?? 0 }));
  await ensureArticleKo(overseasRows, { max: 40 }).catch(e => console.warn('[briefing-reco] 해외 제목 번역 실패(원문 사용):', e));
  const seenOverseas = new Set<string>();
  const D = overseasRows
    .sort((x, y) => rankOf(y) - rankOf(x) || y.priorityScore - x.priorityScore)
    .filter(a => (seenOverseas.has(a.matchedKeyword) ? false : (seenOverseas.add(a.matchedKeyword), true)))
    .map(a => ({ ...fromArticle(a as unknown as AnalyzedArticle & { id: string }, idByLink), title: a.titleKo || a.title }))
    .filter(a => !briefedCompanies.has(a.company) && fresh(a))
    .slice(0, 8);

  // 국내 AI — 72시간 후보 중 AI 주제의 국내 기사(업계·경쟁사), 같은 사건 묶고 중요도 순.
  const domesticAi = buildClusteredPool(candidates.filter(a =>
    (a.category === 'industry_trend' || a.category === 'competitor')
    && isKorean(a.title) && AI_TOPIC.test(a.title) && !STOCK_TICKER.test(a.title) && !weakForBriefing(a)));
  const DA = domesticAi
    .map(a => ({ ...fromArticle(a, idByLink), label: '🇰🇷 국내 AI' }))
    .filter(fresh)
    .sort((x, y) => rankOf(y) - rankOf(x))
    .slice(0, 8);

  // 글로벌 AI — 메일의 AI 트렌드 TOP 5 + 해외 트렌드 AI 카드
  const G: BriefingCandidate[] = [
    ...(data.aiSignals?.items ?? []).map(it => ({
      kind: 'trend' as const, ref: it.url, title: it.titleKo || it.title, summary: it.summaryKo || it.title,
      source: it.source, url: it.url, label: TREND_LABEL, pubDate: it.publishedAt ?? data.aiSignals!.generatedAt,
    })),
    ...(data.inter?.cards ?? []).filter(c => c.domainLabel === 'AI').map(c => ({
      kind: 'inter' as const, ref: c.url, title: c.title, summary: c.cellLabel, source: c.media, url: c.url,
      label: INTER_LABEL, pubDate: new Date().toISOString(), companies: c.companies.map(x => x.name),
    })),
  ].filter(fresh);

  // 스타트업계 — 다이제스트 "스타트업계 뉴스" 섹션(국내 AI 칸과 겹치지 않게 AI 주제는 뺀다).
  const T = data.industryArticles
    .filter(a => isKorean(a.title) && !AI_TOPIC.test(a.title) && !STOCK_TICKER.test(a.title) && !weakForBriefing(a))
    .map(a => fromArticle(a, idByLink))
    .filter(fresh);

  // AI 칸은 해외 우선 — 국내 AI는 [국내] 표시를 달아 글로벌 그룹 뒤에 붙인다(AI가 해외 매체급일 때만 고른다).
  const GA = [...G, ...DA];
  const pools: Record<Group, BriefingCandidate[]> = { S, P, D, G: GA, T };
  const counts = { S: S.length, P: P.length, D: D.length, G: GA.length, T: T.length };
  const q = quotas(counts);
  const aiEither = false; // 국내·글로벌 AI "둘 중 하나" 칸은 없어졌다(10-06부터 한 그룹)

  let chosen: Record<Group, BriefingCandidate[]> | null = null;
  try {
    chosen = await rankWithAI(pools, q, aiEither);
  } catch (e) {
    console.error('[briefing-reco] AI 선정 실패 — 그룹별 중요도 순으로 대신합니다:', e);
  }
  // AI 답을 칸 수에 맞춰 다듬는다(모자라면 그룹 앞에서부터 채우고, 넘치면 자른다).
  const want = { ...q };
  const picked: BriefingCandidate[] = [];
  const tiers: number[] = [];
  const used = new Set<string>();
  const usedLeads = new Set<string>();
  const take = (g: Group, c: BriefingCandidate): boolean => {
    if (used.has(c.url)) return false;
    // AI 칸에 같은 회사 소식이 둘 들어가지 않게("구글, 제미나이 4 발표"·"구글, 새 제미니 모델 발표" — 같은 사건).
    const lead = g === 'G' ? c.title.split(/[,，·…\s]/)[0] : '';
    if (lead && usedLeads.has(lead)) return false;
    if (lead) usedLeads.add(lead);
    used.add(c.url);
    picked.push(c);
    tiers.push(GROUP_TIER[g]);
    return true;
  };
  (['S', 'P', 'D', 'G', 'T'] as Group[]).forEach(g => {
    // 해외 포폴은 AI가 고른 것만 쓴다 — 동명 기사("Rain Timecast" 날씨)가 남은 칸 채우기로 끼어들지 않게.
    const order = g === 'D' && chosen ? [...chosen.D] : [...(chosen?.[g] ?? []), ...pools[g]];
    let n = 0;
    for (const c of order) {
      if (n >= want[g]) break;
      if (take(g, c)) n++;
    }
  });
  // 빈칸이 남으면(해외 포폴을 AI가 덜 골랐을 때 등) 국내 포폴 → AI 트렌드 → 스타트업계 순으로 채운다.
  for (const g of ['P', 'G', 'T'] as Group[]) {
    for (const c of [...(chosen?.[g] ?? []), ...pools[g]]) {
      if (picked.length >= BRIEFING_MAX) break;
      take(g, c);
    }
  }
  // 칸 순서대로(스파크랩 → 국내 포폴 → 해외 포폴 → AI → 스타트업계) 보이게 정렬
  const order = picked.map((c, i) => ({ c, t: tiers[i] })).sort((a, b) => a.t - b.t);
  picked.splice(0, picked.length, ...order.map(x => x.c));
  tiers.splice(0, tiers.length, ...order.map(x => x.t));
  return { picked, tiers };
}

/**
 * 오늘의 추천 5개. 같은 수집 결과로 이미 계산해 둔 게 있으면 그대로 돌려준다.
 * force=true면 새로 계산한다(검수 화면의 "추천 다시 받기").
 */
export async function getBriefingRecommendation(force = false): Promise<BriefingRecommendation> {
  // 다음 방송(월=위클리, 수·금=데일리) 기준. 캐시 키도 방송일 — 목요일에 보는 검수 화면은 금요일 방송분.
  const w = broadcastFor();
  const dateKey = w.dateKey;
  const basis = `${await currentBasis()}|${w.program}|${w.since.toISOString()}`;
  if (!force) {
    const row = await prisma.dashboardInsight.findUnique({
      where: { kind_key: { kind: KIND_RECO, key: dateKey } },
      select: { value: true },
    });
    if (row) {
      try {
        const cached = JSON.parse(row.value) as BriefingRecommendation;
        // 'ai'는 예전 방식으로 만든 캐시 — 규칙이 바뀌었으니 다시 계산한다.
        if (cached.basis === basis && cached.method === 'quota' && cached.headlines?.length > 0) return cached;
      } catch { /* 깨진 캐시는 새로 계산 */ }
    }
  }

  const { picked, tiers } = await pickByTiers(w);
  const rec: BriefingRecommendation = {
    program: w.program,
    headlines: picked.map(toHeadline),
    method: 'quota',
    tiers,
    basis,
    computedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(rec);
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_RECO, key: dateKey } },
    create: { kind: KIND_RECO, key: dateKey, value },
    update: { value },
  });
  return rec;
}
