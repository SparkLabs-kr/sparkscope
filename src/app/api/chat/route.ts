// 챗봇 조회 API — 지금은 DB 조회만 한다(LLM 호출 없음).
// 심층 분석·요약은 이후 단계에서 이 응답 위에 얹는다.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { runChatQuery, type ChatPeriod, type ChatScope } from '@/lib/sparkscope/chat-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// DB(서울)와 같은 리전에서 실행 — 대시보드와 동일한 이유.
export const preferredRegion = 'icn1';

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

  try {
    const result = await runChatQuery({ question, period, scopes });
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/chat] query failed', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
