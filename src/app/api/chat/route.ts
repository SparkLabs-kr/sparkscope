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
import { runLiveSearch, summarizeLiveSearch } from '@/lib/sparkscope/chat-live';
import { getLocale } from '@/lib/i18n/server';
import { ensureArticleEnDeep } from '@/lib/sparkscope/translate-content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// DB(서울)와 같은 리전에서 실행 — 대시보드와 동일한 이유.
export const preferredRegion = 'icn1';
// 심층 분석까지 켜면 LLM 두 번을 타므로 넉넉히.
export const maxDuration = 120;

const PERIODS: ChatPeriod[] = ['today', 'week', 'month', 'quarter', 'all'];
const SCOPES: ChatScope[] = ['portfolio', 'competitor', 'sparklabs', 'industry', 'inter'];

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

  const live = body?.live === true;
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question && !live) return NextResponse.json({ error: '질문이 비어 있습니다.' }, { status: 400 });

  const period: ChatPeriod = PERIODS.includes(body?.period) ? body.period : 'quarter';
  const scopes: ChatScope[] = Array.isArray(body?.scopes)
    ? body.scopes.filter((s: any): s is ChatScope => SCOPES.includes(s))
    : [];

  // 답변 언어 — UI 토글과 같은 쿠키를 읽는다.
  const locale = getLocale();

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

  // NDJSON 스트림 — 한 줄에 이벤트 하나.
  //   {"type":"progress", ...}  조회가 진행되는 동안 여러 번
  //   {"type":"done", ...}      최종 답변 (기존 응답 본문과 같은 모양)
  //   {"type":"error", ...}
  // 조회에 5~20초가 걸리는데 그동안 화면이 비어 있어서, 무엇을 하고 있는지 흘려보낸다.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true; // 사용자가 창을 닫았거나 연결이 끊긴 경우
        }
      };

      try {
        // live=true인데 keyword가 비어있으면(호출부 버그로 검색어를 못 채운 경우)
        // 예전엔 이 if를 그냥 통과시켜 조용히 아래 일반 채팅 흐름(question='')으로 넘어갔다
        // — 사용자는 "실시간 검색"을 눌렀는데 실제로는 우리 DB 조회 결과가 나와서 헷갈렸다
        // (2026-08-14 발견). 명확한 에러로 바로 알려준다.
        if (live && !keyword) {
          send({ type: 'error', error: '실시간 검색어를 확인할 수 없습니다. 다시 시도해 주세요.' });
          return;
        }
        // 실시간 검색 (사용자가 "추가 검색할까요?" → "예" 선택했을 때)
        if (live && keyword) {
          send({ type: 'progress', phase: 'tool_start', label: '실시간 뉴스 검색' });
          const result = await runLiveSearch(keyword);
          send({
            type: 'progress',
            phase: 'tool_done',
            label: '실시간 뉴스 검색',
            detail: `${keyword} → ${result.total}건`,
          });
          send({ type: 'progress', phase: 'thinking', label: '결과 정리하는 중' });
          const summary = await summarizeLiveSearch(keyword, result);
          send({
            type: 'done',
            intent: 'search',
            note: null,
            unsupported: null,
            summary:
              summary ??
              `"${keyword}"의 실시간 뉴스 검색 결과예요. 우리 DB의 노이즈 필터를 거치지 않은 원본이라 관련 없는 기사가 섞여있을 수 있어요.`,
            appliedPeriod: period,
            appliedScopes: scopes,
            resultKind: 'live',
            result,
          });
          return;
        }

        // 키가 없으면 에이전트를 못 돌린다 — 규칙 기반 단일 조회로 집계만 보여준다.
        if (!process.env.OPENAI_API_KEY) {
          const result = await runChatQuery({ question, period, scopes, limit: 20 });
          send({
            type: 'done',
            intent: 'search',
            note: 'AI 분석이 꺼져 있어 검색 결과만 보여드려요.',
            unsupported: null,
            summary: null,
            appliedPeriod: period,
            appliedScopes: scopes,
            resultKind: 'search',
            result,
          });
          return;
        }

        const { summary, result, resultKind, digestHtml, followUps, title, steps, usage } = await runChatAgent({
          question,
          history,
          period,
          scopes,
          deep,
          asTable,
          userEmail: session.user.email,
          locale,
          onProgress: (e) => send({ type: 'progress', ...e }),
        });

        // 근거 기사 목록의 제목도 영어로 — 답변 본문만 영어면 목록이 따로 노는 느낌이 난다.
        // 실시간 검색(live) 결과는 우리 DB에 없는 기사라 캐시할 대상이 없어 건너뛴다.
        if (locale === 'en' && result?.articles?.length) {
          await ensureArticleEnDeep([result.articles]);
        }

        // gpt-5.4-mini 단가($/1M): 입력 0.75 / 캐시된 입력 0.075 / 출력 4.50
        const cost =
          ((usage.inputTokens - usage.cachedTokens) * 0.75 + usage.cachedTokens * 0.075 + usage.outputTokens * 4.5) / 1e6;
        console.log(
          `[api/chat] "${question.slice(0, 30)}" | ${steps.join(' → ')} | ` +
            `LLM ${usage.calls}회 in ${usage.inputTokens}(캐시 ${usage.cachedTokens}) out ${usage.outputTokens} ≈ $${cost.toFixed(4)}`
        );

        send({
          type: 'done',
          intent: 'search',
          note: null,
          unsupported: null,
          summary,
          appliedPeriod: period,
          appliedScopes: scopes,
          resultKind,
          digestHtml,
          result,
          followUps,
          title,
        });
      } catch (e) {
        console.error('[api/chat] query failed', e);
        send({ type: 'error', error: '조회 중 오류가 발생했습니다.' });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* 이미 닫혔으면 무시 */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // 프록시가 버퍼링하면 스트리밍이 의미가 없다.
      'X-Accel-Buffering': 'no',
    },
  });
}
