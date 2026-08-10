// 챗봇 API — 질문 이해(LLM) → DB 조회 → (선택) 심층 분석(LLM).
// 심층 분석이 꺼져 있으면 LLM은 의도 분석 1회만 탄다. OPENAI_API_KEY가 없으면
// 의도 분석도 건너뛰고 규칙 기반으로 동작한다.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { runChatQuery, type ChatPeriod, type ChatScope } from '@/lib/sparkscope/chat-query';
import { parseIntent } from '@/lib/sparkscope/chat-intent';
import { summarizeChatResult } from '@/lib/sparkscope/chat-answer';

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

  const deep = Array.isArray(body?.modes) && body.modes.includes('deep');

  try {
    // 1) 질문 이해 — 검색어·기간·범위를 뽑고, 못 하는 요청인지 판별한다.
    const intent = await parseIntent(question);

    // 화면에서 고른 값이 우선. 질문에 기간·범위가 명시됐고 화면은 기본값이면 질문을 따른다.
    const finalPeriod: ChatPeriod = period === 'quarter' && intent.period ? intent.period : period;
    const finalScopes: ChatScope[] = scopes.length ? scopes : intent.scopes;

    if (!intent.needsArticles) {
      return NextResponse.json({
        intent: intent.kind,
        note: intent.note,
        unsupported: intent.unsupported,
        result: null,
      });
    }

    const result = await runChatQuery({
      question,
      period: finalPeriod,
      scopes: finalScopes,
      terms: intent.terms,
    });

    // 2) 심층 분석은 켜졌을 때만.
    const summary = deep ? await summarizeChatResult(question, result, intent) : null;

    return NextResponse.json({
      intent: intent.kind,
      note: intent.note,
      unsupported: intent.unsupported,
      summary,
      appliedPeriod: finalPeriod,
      appliedScopes: finalScopes,
      result,
    });
  } catch (e) {
    console.error('[api/chat] query failed', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
