/**
 * 데일리 브리핑 추천 헤드라인 5개 + 검수 화면의 교체 후보 목록.
 *
 * 추천은 항상 5개, 칸 수를 정해 두고 칸마다 AI가 가장 중요한 기사를 고른다(2026-09-30 소윤 결정):
 *   스파크랩 소식이 있는 날  스파크랩 1 · 포트폴리오 2 · AI 1 · 스타트업계 1
 *   없는 날                  포트폴리오 2 · AI 2(국내 1 · 글로벌 1) · 스타트업계 1
 * 칸을 채울 후보가 모자라면 AI 칸으로 넘긴다. 칸 계산은 quotas(), 선정은 rankWithAI().
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
import { BRIEFING_MAX, kstDateKey, type BriefingHeadline } from './briefing';

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
const STOCK_TICKER = /주가|특징주|급등락|상한가|하한가|장중|시황|[‘'"]上[’'"]|[‘'"]下[’'"]/;
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
async function recentlyBriefedUrls(): Promise<Set<string>> {
  const today = kstDateKey();
  const keys = Array.from({ length: 7 }, (_, i) => kstDateKey(new Date(Date.now() - (i + 1) * 864e5)));
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: 'daily_briefing', key: { in: keys.filter(k => k !== today) } },
    select: { value: true },
  });
  const urls = new Set<string>();
  for (const r of rows) {
    try { for (const h of (JSON.parse(r.value).headlines ?? [])) urls.add(h.url); } catch { /* 깨진 행은 무시 */ }
  }
  return urls;
}

/**
 * 다이제스트에 실린 기사만 재료로 쓴다(2026-09-28 소윤 결정 — "다이제스트에 나온 것 중 뽑는다,
 * 기간도 다이제스트를 그대로 따라간다"). 예전엔 여기서 3일·7일 창을 따로 잘라서, 다이제스트에
 * 버젓이 실린 스파크랩 기사 3건(9/21~22)이 추천에서는 빠졌다.
 * 검수 화면 미리보기와 같은 조립(review.ts buildReviewDigest)을 쓴다 — 편집자가 보는 메일이 기준.
 */
async function buildDigestForBriefing(): Promise<DigestData> {
  const candidates = await loadDigestCandidates();
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
  1: '스파크랩', 2: '포트폴리오', 3: 'AI 국내', 4: 'AI 글로벌', 5: '스타트업계',
};

type Group = 'S' | 'P' | 'D' | 'G' | 'T';
const GROUP_TIER: Record<Group, number> = { S: 1, P: 2, D: 3, G: 4, T: 5 };
const GROUP_NAME: Record<Group, string> = {
  S: '스파크랩 자사 소식', P: '포트폴리오사 소식', D: '국내 AI 기업·업계 소식', G: '글로벌 AI 기업·업계 소식', T: '스타트업계 소식',
};

/**
 * 칸 수(2026-09-30 소윤 결정 — 항상 5개):
 *   스파크랩 소식이 있는 날  스파크랩 1 · 포트폴리오 2 · AI 1(국내·글로벌 중 더 중요한 쪽) · 스타트업계 1
 *   없는 날                  포트폴리오 2 · AI 2(국내 1 · 글로벌 1) · 스타트업계 1
 * 후보가 모자란 칸은 AI 칸으로 넘긴다(국내·글로벌 반반 원칙 유지).
 */
function quotas(avail: Record<Group, number>): Record<Group, number> {
  const q: Record<Group, number> = { S: 0, P: 0, D: 0, G: 0, T: 0 };
  q.S = Math.min(1, avail.S);
  q.P = Math.min(2, avail.P);
  q.T = Math.min(1, avail.T);
  let ai = BRIEFING_MAX - q.S - q.P - q.T;
  if (ai === 1) {
    // 한 칸이면 국내·글로벌 중 하나 — 어느 쪽인지는 AI가 고른다(여기선 가능한 쪽만 열어 둔다).
    q.D = avail.D > 0 ? 1 : 0;
    q.G = avail.G > 0 ? 1 : 0;
    return q; // D·G 둘 다 1이면 "둘 중 하나" — rankWithAI가 1개만 고르게 한다
  }
  q.D = Math.min(Math.floor(ai / 2), avail.D);
  q.G = Math.min(ai - q.D, avail.G);
  q.D = Math.min(ai - q.G, avail.D); // 글로벌이 모자라면 국내로
  return q;
}

const RANK_SYSTEM = `당신은 스파크랩(한국의 스타트업 액셀러레이터·VC)의 아침 브리핑 편집자입니다.
임직원이 출근길에 들을 헤드라인을 고릅니다. 그룹마다 정해진 개수만큼, 그 그룹 안에서 가장 중요한 기사를 고르세요.

중요도 기준
- 스파크랩·포트폴리오사에 직접 영향을 주는 사건 > 업계 전반에 큰 사건 > 일반 소식.
- 투자 유치·인수합병·상장·대형 계약·신제품 출시·규제 변화처럼 "사건"이 있는 기사를 우선합니다.
- 주가 등락·행사 스케치·인터뷰·칼럼은 뒤로 미룹니다.
- 같은 사건을 다룬 기사는 그룹이 달라도 하나만 고릅니다(국내 기사와 해외 기사가 같은 사건일 수 있음).
- "국내 AI"는 한국 기업·기관이 주인공인 AI 소식, "글로벌 AI"는 해외 기업·기관이 주인공인 AI 소식입니다.

JSON으로만 답하세요: {"picks": {"S": ["S0"], "P": ["P2","P0"], "D": ["D1"], "G": ["G0"], "T": ["T3"]}}
그룹마다 요청한 개수를 정확히 지키고, 요청하지 않은 그룹은 빈 배열로 두세요.`;

async function rankWithAI(
  pools: Record<Group, BriefingCandidate[]>, q: Record<Group, number>, aiEither: boolean,
): Promise<Record<Group, BriefingCandidate[]> | null> {
  const lines: string[] = [];
  (Object.keys(pools) as Group[]).forEach(g => {
    if (q[g] === 0) return;
    lines.push(`\n## ${GROUP_NAME[g]} — ${aiEither && (g === 'D' || g === 'G') ? '국내·글로벌 AI 합쳐 1개' : `${q[g]}개`}`);
    pools[g].forEach((c, i) => lines.push(`${g}${i}. ${c.title} — ${c.summary}${c.importance ? ` [${c.importance}]` : ''}`));
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

/** 칸 수에 맞춰 5칸을 채운다 — 재료는 다이제스트(같은 72시간 창)와 AI 트렌드·해외 트렌드. */
async function pickByTiers(): Promise<{ picked: BriefingCandidate[]; tiers: number[] }> {
  const [briefed, data, candidates] = await Promise.all([
    recentlyBriefedUrls(),
    buildDigestForBriefing(),
    loadDigestCandidates(),
  ]);
  const idByLink = new Map(candidates.map(a => [a.link, a.id]));
  const rankOf = (a: { importance?: string }) => IMPORTANCE_RANK[a.importance ?? ''] ?? 0;
  const fresh = (c: BriefingCandidate) => !briefed.has(c.url);

  // 스파크랩 — 다이제스트 섹션, 한국어 기사만(같은 사건의 영문판이 두 칸을 차지하지 않게).
  const S = data.sparklabsArticles.filter(a => isKorean(a.title)).map(a => fromArticle(a, idByLink)).filter(fresh);

  // 포트폴리오 — 다이제스트 섹션(회사당 1건). 주가 기사면 같은 회사 다른 기사로. 지난 7일 브리핑에 나간 회사 제외.
  const briefedCompanies = new Set(candidates.filter(a => briefed.has(a.link)).map(a => a.matchedKeyword));
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

  // 국내 AI — 72시간 후보 중 AI 주제의 국내 기사(업계·경쟁사), 같은 사건 묶고 중요도 순.
  const domesticAi = buildClusteredPool(candidates.filter(a =>
    (a.category === 'industry_trend' || a.category === 'competitor')
    && isKorean(a.title) && AI_TOPIC.test(a.title) && !STOCK_TICKER.test(a.title)));
  const D = domesticAi
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
    .filter(a => isKorean(a.title) && !AI_TOPIC.test(a.title) && !STOCK_TICKER.test(a.title))
    .map(a => fromArticle(a, idByLink))
    .filter(fresh);

  const pools: Record<Group, BriefingCandidate[]> = { S, P, D, G, T };
  const q = quotas({ S: S.length, P: P.length, D: D.length, G: G.length, T: T.length });
  const aiEither = q.D === 1 && q.G === 1 && q.S + q.P + q.T === BRIEFING_MAX - 1;

  let chosen: Record<Group, BriefingCandidate[]> | null = null;
  try {
    chosen = await rankWithAI(pools, q, aiEither);
  } catch (e) {
    console.error('[briefing-reco] AI 선정 실패 — 그룹별 중요도 순으로 대신합니다:', e);
  }
  // AI 답을 칸 수에 맞춰 다듬는다(모자라면 그룹 앞에서부터 채우고, 넘치면 자른다).
  const want = { ...q };
  if (aiEither) {
    const aiPick = chosen?.D[0] ? 'D' : chosen?.G[0] ? 'G' : (D.length ? 'D' : 'G');
    want.D = aiPick === 'D' ? 1 : 0;
    want.G = aiPick === 'G' ? 1 : 0;
  }
  const picked: BriefingCandidate[] = [];
  const tiers: number[] = [];
  const used = new Set<string>();
  (['S', 'P', 'D', 'G', 'T'] as Group[]).forEach(g => {
    const order = [...(chosen?.[g] ?? []), ...pools[g]];
    let n = 0;
    for (const c of order) {
      if (n >= want[g]) break;
      if (used.has(c.url)) continue;
      used.add(c.url);
      picked.push(c);
      tiers.push(GROUP_TIER[g]);
      n++;
    }
  });
  return { picked, tiers };
}

/**
 * 오늘의 추천 5개. 같은 수집 결과로 이미 계산해 둔 게 있으면 그대로 돌려준다.
 * force=true면 새로 계산한다(검수 화면의 "추천 다시 받기").
 */
export async function getBriefingRecommendation(force = false): Promise<BriefingRecommendation> {
  const dateKey = kstDateKey();
  const basis = await currentBasis();
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

  const { picked, tiers } = await pickByTiers();
  const rec: BriefingRecommendation = {
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
