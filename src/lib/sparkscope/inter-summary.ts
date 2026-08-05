/**
 * Inter(해외 트렌드) 탭 상단 "AI 요약"(트렌드/포지션/액션) 사전계산.
 * dashboard-insights.ts와 같은 패턴 — daily-collect 크론에서 하루 1회 계산해
 * DashboardInsight(kind='inter_summary')에 저장하고, /api/inter는 읽기만 한다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { SUMMARY_PERIODS } from './inter-summary-periods';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const SYSTEM = `당신은 스파크랩 포트폴리오팀의 트렌드 애널리스트입니다.
최근 수집된 해외 AI/바이오 업계 기사와 스파크랩 포트폴리오사 매칭 결과를 보고,
"과학은 잘 모르지만 사업은 잘 아는" 경영진이 한눈에 이해할 수 있도록 3가지를 한국어로 요약합니다.

각 항목은 2~3문장으로 씁니다. 첫 문장은 두괄식 결론, 이어지는 문장은 "왜 그렇게 판단했는지"를
구체적 근거(기사 속 수치·사례·회사명)로 뒷받침합니다. "~연구가 두드러집니다" 같은 근거 없는
뭉뚱그린 문장만으로는 절대 끝내지 마세요 — 반드시 어떤 내용인지, 어떤 숫자인지를 덧붙입니다.

■ 쉬운 말로, 비즈니스 관점으로 — 이게 가장 중요한 규칙입니다.
  전문용어(바이오마커명, 유전자/단백질명, 학술 용어 등)를 문장에 그대로 나열하지 마세요.
  기사 제목에 어려운 원어 용어가 있어도, "그게 사업적으로 무슨 의미인지"로 즉시 풀어서 설명합니다.
  한 문장에 낯선 전문용어는 최대 1개까지만 — 그것도 꼭 필요할 때만 쓰고 바로 뒤에 쉬운 말로 풀어줍니다.
  예) (X) 세포노화(senescence) 바이오마커를 활용한 circulating senescence signature 연구가 부각됩니다.
      (O) 혈액검사만으로 몸이 얼마나 빨리 늙고 있는지 예측하는 연구 결과가 잇따라 나왔습니다
          — 노화 속도를 재는 새로운 혈액 지표가 논문 2건에서 검증됐습니다.
  숫자·회사명·건수는 계속 구체적으로 쓰되(이건 유지), 그걸 감싸는 설명은 중학생도 알아들을 말로 쓰세요.

1) trend: 가장 두드러진 트렌드 + 그게 왜 중요한지를 쉬운 말로, 근거(수치나 사례 2개 이상)와 함께.
2) position: 이 트렌드에서 스파크랩·포트폴리오 생태계가 어떤 위치에 있는지 + 어떤 포트폴리오사가
   구체적으로 어떤 사업 기회·위협과 연관되는지를 쉬운 말로. 입력에 매칭된 포트폴리오사가 없으면
   뭉뚱그리지 말고 "직접 연관된 포트폴리오사 매칭은 아직 없습니다"라고 사실대로 짧게 씁니다
   (이 경우만 1문장 허용).
3) action: 지금 취해야 할 가장 중요한 액션 + 왜 그 액션이 지금 시급한지(트렌드/수치 근거 재인용).

■ 하이라이트 — 문장 안에서 핵심 키워드(회사명·수치·쉬운 말로 풀어쓴 핵심 개념)는
  **키워드** 형식(마크다운 굵게)으로 감쌉니다. 전문용어 원어 자체를 하이라이트하지 말고,
  그걸 풀어쓴 쉬운 표현 쪽을 하이라이트하세요. 문장마다 최소 1개 이상.

■ 말투 — 모든 문장이 반드시 "~습니다/~합니다"로 끝나는 존댓말 종결형이어야 합니다.
  "부각됐다", "매칭됐다", "점검해야 한다" 같은 평서형(~다) 종결은 쓰지 않습니다.
  예) (X) AI 신약개발 투자가 확대됐다.  →  (O) AI 신약개발 투자가 확대됐습니다.
  예) (X) 기회를 우선 점검해야 한다.    →  (O) 기회를 우선 점검해야 합니다.

원칙: 사실만(과장·추측 금지), 입력에 없는 근거·수치·회사명은 지어내지 않기 —
입력에 뒷받침할 근거가 부족하면 문장 수를 줄이더라도 있는 사실만 씁니다.
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
  periodLabel: string,
  sectorCounts: { sector: string; count: number }[],
  sampleTitles: { ko: string; original: string }[],
  matches: { company: string; reason: string }[],
): string {
  return `=== 도메인: ${domainLabel} (${periodLabel}) ===

세부 섹터별 기사 건수:
${sectorCounts.map(s => `- ${s.sector}: ${s.count}건`).join('\n') || '(데이터 없음)'}

주요 기사 제목(한국어 / 원문 — 구체적 용어·수치는 원문에서 확인):
${sampleTitles.map((t, i) => `${i + 1}. ${t.ko} (${t.original})`).join('\n') || '(없음)'}

포트폴리오사 매칭 결과(사유에 나온 구체적 연결고리를 position 근거로 활용):
${matches.map(m => `- ${m.company}: ${m.reason}`).join('\n') || '(매칭 없음)'}

출력 스키마: {"trend": "...", "position": "...", "action": "..."}
JSON 객체만 반환:`;
}

/**
 * 도메인 하나 × 기간(period) 하나의 요약을 계산해 DashboardInsight에 저장.
 * 화면의 기간 선택(7일/1개월/3개월/1년/3년)과 AI 문장이 항상 같은 기준을 보게 하려고
 * 기간별로 따로 계산·저장한다 — "가장 많이 걸린 포트폴리오사" 칩(선택 기간 기준)과
 * AI 문장(예전엔 항상 7일 고정)이 서로 다른 말을 하던 문제를 근본적으로 없앤다.
 * 실패해도 throw하지 않음(폴백 유지).
 */
export async function computeInterSummaryForDomain(domain: 'bio' | 'ai', periodKey: string): Promise<boolean> {
  const period = SUMMARY_PERIODS.find(p => p.key === periodKey);
  if (!period) throw new Error(`알 수 없는 기간 키: ${periodKey}`);

  try {
    const since = new Date(Date.now() - period.days * 24 * 60 * 60 * 1000);
    const verdicts = await prisma.interNewsVerdict.findMany({
      where: { relevant: true, domain, news: { publishedAt: { gte: since } } },
      include: { news: true },
      orderBy: { news: { publishedAt: 'desc' } },
    });
    if (verdicts.length === 0) {
      console.log(`[inter-summary] ${domain}/${periodKey}: ${period.label} 관련 기사 없음, 스킵`);
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

    const sampleTitles = verdicts.slice(0, 25).map(v => ({ ko: v.titleKo || v.news.title, original: v.news.title }));

    const matchRows = await prisma.interPortfolioMatch.findMany({
      where: { verdictId: { in: verdicts.map(v => v.id) } },
      take: 10,
      orderBy: { matchedAt: 'desc' },
    });
    const matches = matchRows.map(m => ({ company: m.companyName, reason: m.reason }));

    const domainLabel = domain === 'bio' ? '바이오' : 'AI';
    const resp = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      max_completion_tokens: 1100,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(domainLabel, period.label, sectorCounts, sampleTitles, matches) },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(extractJson(text));
    const trend = typeof parsed?.trend === 'string' ? parsed.trend.trim() : '';
    const position = typeof parsed?.position === 'string' ? parsed.position.trim() : '';
    const action = typeof parsed?.action === 'string' ? parsed.action.trim() : '';
    if (!trend || !position || !action) throw new Error('빈 필드 포함된 응답');

    const key = `${domain}_${periodKey}`;
    await prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: 'inter_summary', key } },
      create: { kind: 'inter_summary', key, value: JSON.stringify({ trend, position, action }) },
      update: { value: JSON.stringify({ trend, position, action }), computedAt: new Date() },
    });
    return true;
  } catch (e: any) {
    console.error(`[inter-summary] ${domain}/${periodKey} 요약 계산 실패:`, e?.message ?? e);
    return false;
  }
}

export async function computeAndStoreInterSummaries(): Promise<void> {
  for (const domain of ['bio', 'ai'] as const) {
    for (const period of SUMMARY_PERIODS) {
      await computeInterSummaryForDomain(domain, period.key);
    }
  }
}
