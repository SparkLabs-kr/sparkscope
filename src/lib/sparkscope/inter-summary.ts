/**
 * Inter(해외 트렌드) 탭 상단 "AI 요약"(트렌드/포지션/액션) 사전계산.
 * dashboard-insights.ts와 같은 패턴 — daily-collect 크론에서 하루 1회 계산해
 * DashboardInsight(kind='inter_summary')에 저장하고, /api/inter는 읽기만 한다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const SUMMARY_WINDOW_DAYS = 7;

const SYSTEM = `당신은 스파크랩 포트폴리오팀의 트렌드 애널리스트입니다.
최근 수집된 해외 AI/바이오 업계 기사와 스파크랩 포트폴리오사 매칭 결과를 보고,
경영진이 한눈에 파악할 수 있도록 3가지를 한국어로 요약합니다.
1) trend: 지금 가장 두드러진 트렌드를 1문장(80자 이내)으로.
2) position: 이 트렌드에서 스파크랩·포트폴리오 생태계가 어떤 위치에 있는지 1문장(80자 이내).
   입력에 매칭된 포트폴리오사가 없으면 "직접 연관된 포트폴리오사 매칭은 아직 없음"이라고 사실대로 씁니다.
3) action: 지금 취해야 할 가장 중요한 액션 1문장(80자 이내).
원칙: 두괄식, 사실만(과장·추측 금지), 입력에 없는 내용 지어내지 않기.
응답은 반드시 valid JSON 객체로, 추가 설명 없이.`;

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

function buildUserPrompt(
  domainLabel: string,
  sectorCounts: { sector: string; count: number }[],
  sampleTitles: string[],
  matches: { company: string; reason: string }[],
): string {
  return `=== 도메인: ${domainLabel} (최근 ${SUMMARY_WINDOW_DAYS}일) ===

세부 섹터별 기사 건수:
${sectorCounts.map(s => `- ${s.sector}: ${s.count}건`).join('\n') || '(데이터 없음)'}

주요 기사 제목(한국어):
${sampleTitles.map((t, i) => `${i + 1}. ${t}`).join('\n') || '(없음)'}

포트폴리오사 매칭 결과:
${matches.map(m => `- ${m.company}: ${m.reason}`).join('\n') || '(매칭 없음)'}

출력 스키마: {"trend": "...", "position": "...", "action": "..."}
JSON 객체만 반환:`;
}

/** 도메인 하나의 요약을 계산해 DashboardInsight에 저장. 실패해도 throw하지 않음(폴백 유지). */
export async function computeInterSummaryForDomain(domain: 'bio' | 'ai'): Promise<boolean> {
  try {
    const since = new Date(Date.now() - SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const verdicts = await prisma.interNewsVerdict.findMany({
      where: { relevant: true, domain, news: { publishedAt: { gte: since } } },
      include: { news: true },
      orderBy: { news: { publishedAt: 'desc' } },
    });
    if (verdicts.length === 0) {
      console.log(`[inter-summary] ${domain}: 최근 ${SUMMARY_WINDOW_DAYS}일 관련 기사 없음, 스킵`);
      return false;
    }

    const sectorCountMap = new Map<string, number>();
    for (const v of verdicts) {
      const key = v.sector ?? '(미분류)';
      sectorCountMap.set(key, (sectorCountMap.get(key) ?? 0) + 1);
    }
    const sectorCounts = Array.from(sectorCountMap.entries())
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count);

    const sampleTitles = verdicts.slice(0, 15).map(v => v.titleKo || v.news.title);

    const matchRows = await prisma.interPortfolioMatch.findMany({
      where: { verdictId: { in: verdicts.map(v => v.id) } },
      take: 10,
      orderBy: { matchedAt: 'desc' },
    });
    const matches = matchRows.map(m => ({ company: m.companyName, reason: m.reason }));

    const domainLabel = domain === 'bio' ? '바이오' : 'AI';
    const resp = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      max_completion_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(domainLabel, sectorCounts, sampleTitles, matches) },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(extractJson(text));
    const trend = typeof parsed?.trend === 'string' ? parsed.trend.trim() : '';
    const position = typeof parsed?.position === 'string' ? parsed.position.trim() : '';
    const action = typeof parsed?.action === 'string' ? parsed.action.trim() : '';
    if (!trend || !position || !action) throw new Error('빈 필드 포함된 응답');

    await prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: 'inter_summary', key: domain } },
      create: { kind: 'inter_summary', key: domain, value: JSON.stringify({ trend, position, action }) },
      update: { value: JSON.stringify({ trend, position, action }), computedAt: new Date() },
    });
    return true;
  } catch (e: any) {
    console.error(`[inter-summary] ${domain} 요약 계산 실패:`, e?.message ?? e);
    return false;
  }
}

export async function computeAndStoreInterSummaries(): Promise<void> {
  await computeInterSummaryForDomain('bio');
  await computeInterSummaryForDomain('ai');
}
