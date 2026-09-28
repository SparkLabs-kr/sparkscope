/**
 * 데일리 브리핑 추천 헤드라인 5개 + 검수 화면의 교체 후보 목록.
 *
 * "중요도가 제일 높은 5개"를 뽑는다. 분야(스파크랩·포트폴리오·업계·해외)를 일부러 섞지 않는다 —
 * 그날 중요한 게 전부 포트폴리오 기사면 5개 다 포트폴리오여도 된다(2026-09-28 소윤 결정).
 *
 * 국내(Article.importance·priorityScore)와 해외(InterNewsVerdict — 중요도 칸 없음)는 점수 체계가
 * 달라 규칙으로는 한 줄에 세울 수 없다. 그래서 양쪽 상위 후보를 추려 AI에게 한 번에 보여 주고
 * 순위를 매기게 한다(호출 1회). AI가 실패하면 국내 중요도 순으로 대신한다.
 *
 * 추천은 수집이 끝날 때마다 한 번만 계산해 DashboardInsight(briefing_reco)에 저장한다.
 * 검수 화면에서 본 추천과 발송 때 쓰이는 추천이 같아야 하기 때문이다 — AI는 부를 때마다 조금씩
 * 다른 답을 내므로, 매번 새로 계산하면 "화면에선 A였는데 영상엔 B"가 된다.
 * 새 수집이 끝나면(daily-collect RunLog가 바뀌면) 다시 계산한다.
 *
 * 서버 전용 — OpenAI SDK를 쓰므로 클라이언트 컴포넌트에서 import 하지 않는다(CLAUDE.md i18n 절 참고).
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { loadDigestCandidates, type ReviewArticle } from './review';
import { buildClusteredPool } from './digest';
import { BRIEFING_MAX, kstDateKey, type BriefingHeadline } from './briefing';

const KIND_RECO = 'briefing_reco';
const MODEL = 'gpt-4.1';
/** 추천 대상 창 — 발송 재료 창(loadSendArticles 3일)과 같게 둔다. 교체 후보는 검수 화면과 같은 7일. */
const RECO_WINDOW_DAYS = 3;
const PICKER_WINDOW_DAYS = 7;
/** AI에게 보여줄 후보 수 — 국내·해외 각각 */
const SHORTLIST_INTRA = 12;
const SHORTLIST_INTER = 10;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '🏢 스파크랩 뉴스',
  portfolio_company: '💼 포트폴리오사',
  portfolio_company_tw: '💼 포트폴리오사 · 대만',
  portfolio_company_gv: '💼 포트폴리오사 · 글로벌',
  competitor: '🤝 AC·VC 업계 동향',
  industry_trend: '🌐 스타트업계 뉴스',
};
const DOMAIN_LABEL: Record<string, string> = { ai: 'AI', bio: '바이오' };
const IMPORTANCE_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

/** 교체 후보 한 줄 — 헤드라인 + 화면에 보여줄 보조 정보 */
export interface BriefingCandidate extends BriefingHeadline {
  pubDate: string;
  /** 국내: CRITICAL/HIGH/MEDIUM/LOW. 해외는 없음 */
  importance?: string;
  /** 해외: 연결된 포트폴리오사 수 */
  matchCount?: number;
}

export interface BriefingRecommendation {
  headlines: BriefingHeadline[];
  method: 'ai' | 'rule';
  /** 이 추천의 근거가 된 수집 완료 시각(ISO) — 바뀌면 다시 계산한다 */
  basis: string;
  computedAt: string;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function intraCandidate(a: ReviewArticle): BriefingCandidate {
  return {
    kind: 'intra',
    ref: a.id,
    title: a.title,
    summary: a.oneLiner || a.title,
    source: a.source,
    url: a.link,
    label: CATEGORY_LABEL[a.category] ?? a.category,
    pubDate: new Date(a.pubDate).toISOString(),
    importance: a.importance,
  };
}

/**
 * 국내 후보 — 검수 화면과 같은 가드를 통과한 기사를 중요도 순으로.
 * cluster=true(추천용)면 같은 사건은 하나로 묶는다. 교체 목록은 묶지 않는다 — 묶으면 대표 1건만
 * 남아서, 편집자가 원하는 매체의 기사(예: 영문 대표에 가려진 한국어 기사)를 고를 수 없다.
 */
async function loadIntra(windowDays: number | null, cluster: boolean): Promise<BriefingCandidate[]> {
  // null = 검수 화면 후보 창 그대로(loadDigestCandidates — 7일 전 0시부터). 시간 단위로 다시 자르면
  // 검수 목록엔 있는 기사가 교체 목록에선 빠진다.
  const since = windowDays === null ? null : daysAgo(windowDays);
  const all = (await loadDigestCandidates()).filter(a => !since || new Date(a.pubDate) >= since);
  // buildClusteredPool은 id 자리에 링크를 넣으므로, 대표 기사의 id를 링크로 되찾는다.
  const idByLink = new Map(all.map(a => [a.link, a.id]));
  const pool = cluster ? (buildClusteredPool(all) as ReviewArticle[]) : all;
  return pool
    .map(a => ({ ...a, id: idByLink.get(a.link) ?? a.id }))
    .sort((a, b) =>
      (IMPORTANCE_RANK[b.importance] ?? 0) - (IMPORTANCE_RANK[a.importance] ?? 0)
      || b.priorityScore - a.priorityScore)
    .map(intraCandidate);
}

/** 해외 후보 — 관련 판정된 Inter 기사. 포트폴리오 연결이 많은 것 → 최신 순. */
async function loadInter(windowDays: number): Promise<BriefingCandidate[]> {
  const rows = await prisma.interNewsVerdict.findMany({
    where: { relevant: true, news: { publishedAt: { gte: daysAgo(windowDays) } } },
    select: {
      titleKo: true, reason: true, domain: true,
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
      label: `🔭 해외 · ${DOMAIN_LABEL[r.domain ?? ''] ?? '기타'}`,
      pubDate: r.news.publishedAt.toISOString(),
      matchCount: r._count.matches,
    }));
}

/** 검수 화면 교체 후보 전체(7일). 국내 중요도 순 → 해외. */
export async function loadBriefingCandidates(): Promise<BriefingCandidate[]> {
  const [intra, inter] = await Promise.all([loadIntra(null, false), loadInter(PICKER_WINDOW_DAYS)]);
  return [...intra, ...inter];
}

const RANK_SYSTEM = `당신은 스파크랩(SparkLabs, 한국의 스타트업 액셀러레이터·VC)의 아침 브리핑 편집자입니다.
임직원이 출근길에 2~3분 동안 들을 헤드라인 ${BRIEFING_MAX}개를 고릅니다.

기준은 "중요도" 하나입니다.
- 스파크랩과 포트폴리오사에 직접 영향을 주거나, 스타트업·투자 업계에서 가장 큰 사건일수록 중요합니다.
- 분야를 골고루 섞지 마세요. 중요한 것이 한 분야에 몰려 있으면 그대로 고릅니다.
- 같은 사건을 다룬 기사는 하나만 고릅니다. 국내 기사와 해외 기사가 같은 사건을 각자 보도한 경우가
  많으니(예: 해외 원문과 그걸 옮긴 국내 기사) 특히 주의하세요. 둘 중 우리에게 더 가까운 쪽 하나만 남깁니다.
- 주가 등락·행사 스케치·칼럼처럼 사건이 아닌 기사는 뒤로 미룹니다.

JSON 배열로 후보 번호만, 중요한 순서대로 정확히 ${BRIEFING_MAX}개 답하세요. 예: [3, 0, 12, 7, 5]`;

async function rankWithAI(pool: BriefingCandidate[]): Promise<BriefingCandidate[] | null> {
  const lines = pool.map((c, i) =>
    `${i}. [${c.kind === 'intra' ? `국내 ${c.label.replace(/^\S+\s/, '')}${c.importance ? ` · ${c.importance}` : ''}` : `해외 ${c.label.replace(/^\S+\s/, '')}${c.matchCount ? ` · 포트폴리오 연결 ${c.matchCount}` : ''}`}] ${c.title} — ${c.summary}`);
  const resp = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 100,
    temperature: 0,
    messages: [
      { role: 'system', content: RANK_SYSTEM },
      { role: 'user', content: lines.join('\n') },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? '';
  const match = text.match(/\[[\d\s,]*\]/);
  if (!match) return null;
  const picked: BriefingCandidate[] = [];
  for (const i of JSON.parse(match[0]) as number[]) {
    const c = pool[i];
    if (c && !picked.includes(c)) picked.push(c);
  }
  return picked.length > 0 ? picked.slice(0, BRIEFING_MAX) : null;
}

async function currentBasis(): Promise<string> {
  const last = await prisma.runLog.findFirst({
    where: { runType: 'daily-collect', status: 'SUCCESS', finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return last?.finishedAt?.toISOString() ?? 'none';
}

/** 후보 한 줄에서 화면·저장용 헤드라인만 남긴다. */
function toHeadline(c: BriefingCandidate): BriefingHeadline {
  const { pubDate: _p, importance: _i, matchCount: _m, ...h } = c;
  return h;
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
        if (cached.basis === basis && cached.headlines?.length > 0) return cached;
      } catch { /* 깨진 캐시는 새로 계산 */ }
    }
  }

  const [intra, inter] = await Promise.all([loadIntra(RECO_WINDOW_DAYS, true), loadInter(RECO_WINDOW_DAYS)]);
  const pool = [...intra.slice(0, SHORTLIST_INTRA), ...inter.slice(0, SHORTLIST_INTER)];
  let picked: BriefingCandidate[] | null = null;
  try {
    picked = await rankWithAI(pool);
  } catch (e) {
    console.error('[briefing-reco] AI 순위 실패 — 국내 중요도 순으로 대신합니다:', e);
  }
  const rec: BriefingRecommendation = {
    headlines: (picked ?? intra.slice(0, BRIEFING_MAX)).map(toHeadline),
    method: picked ? 'ai' : 'rule',
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
