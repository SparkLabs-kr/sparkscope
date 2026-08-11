// 챗봇 API — 에이전트가 도구(기사검색·월별추이·오탐점검·데이터현황)를 직접 여러 번 불러
// 답을 만든다. 0건이 나오면 스스로 검색어를 바꿔 다시 찾는다.
//
// OPENAI_API_KEY가 없으면 규칙 기반 단일 조회로 조용히 내려간다(집계만 나오고 요약은 없다).
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { runChatQuery, type ChatPeriod, type ChatScope } from '@/lib/sparkscope/chat-query';
import { runChatAgent, type AgentTurn } from '@/lib/sparkscope/chat-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// DB(서울)와 같은 리전에서 실행 — 대시보드와 동일한 이유.
export const preferredRegion = 'icn1';
// 심층 분석까지 켜면 LLM 두 번을 타므로 넉넉히.
export const maxDuration = 120;

const PERIODS: ChatPeriod[] = ['today', 'week', 'month', 'quarter', 'all'];
const SCOPES: ChatScope[] = ['portfolio', 'competitor', 'sparklabs', 'inter'];

export async function POST(req: Request) {
  const session = OPEN_ACCESS
    ? ({ user: { email: 'dev@localhost' } } as any)
    : await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return NextResponse.json({ error: '질문이 비어 있습니다.' }, { status: 400 });

  const period: ChatPeriod = PERIODS.includes(body?.period) ? body.period : 'quarter';
  const scopes: ChatScope[] = Array.isArray(body?.scopes)
    ? body.scopes.filter((s: any): s is ChatScope => SCOPES.includes(s))
    : [];

  const modes: string[] = Array.isArray(body?.modes) ? body.modes : [];
  const deep = modes.includes('deep');
  const asTable = modes.includes('table');

  // 이전 대화 — 후속 질문("그중 부정적인 것만")을 이해하는 데 쓴다.
  const history: AgentTurn[] = Array.isArray(body?.history)
    ? body.history
        .filter((t: any) => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.text === 'string' && t.text.trim())
        .map((t: any) => ({ role: t.role, text: String(t.text).slice(0, 2000) }))
        .slice(-6)
    : [];

  try {
    // 키가 없으면 에이전트를 못 돌린다 — 규칙 기반 단일 조회로 집계만 보여준다.
    if (!process.env.OPENAI_API_KEY) {
      const result = await runChatQuery({ question, period, scopes, limit: 20 });
      return NextResponse.json({
        intent: 'search',
        note: 'AI 분석이 꺼져 있어 검색 결과만 보여드려요.',
        unsupported: null,
        summary: null,
        appliedPeriod: period,
        appliedScopes: scopes,
        result,
      });
    }

    const { summary, result, steps, usage } = await runChatAgent({
      question,
      history,
      period,
      scopes,
      deep,
      asTable,
    });
    // gpt-5.4-mini 단가($/1M): 입력 0.75 / 캐시된 입력 0.075 / 출력 4.50
    const cost =
      ((usage.inputTokens - usage.cachedTokens) * 0.75 + usage.cachedTokens * 0.075 + usage.outputTokens * 4.5) / 1e6;
    console.log(
      `[api/chat] "${question.slice(0, 30)}" | ${steps.join(' → ')} | ` +
        `LLM ${usage.calls}회 in ${usage.inputTokens}(캐시 ${usage.cachedTokens}) out ${usage.outputTokens} ≈ $${cost.toFixed(4)}`
    );

    return NextResponse.json({
      intent: 'search',
      note: null,
      unsupported: null,
      summary,
      appliedPeriod: period,
      appliedScopes: scopes,
      result,
    });
  } catch (e) {
    console.error('[api/chat] query failed', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
