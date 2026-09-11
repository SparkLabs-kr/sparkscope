/**
 * 다이제스트 항목에 대한 질문 — 사내 챗봇과 같은 엔진을 쓴다.
 *
 * 처음에는 이 기사 하나만 보는 가벼운 호출을 따로 만들었다. 그러면 "이번 주
 * 다른 뉴스는?" 같은 질문에 답할 수 없고, 모델도 요약용(gpt-4o-mini)이라
 * 챗봇(gpt-5.4-mini)보다 약하다. 이미 있는 에이전트를 쓰면 기사 DB 검색과
 * 실시간 검색까지 그대로 따라온다.
 *
 * 기사 맥락은 대화의 첫 턴으로 밀어 넣는다 — 에이전트에 "지금 보고 있는
 * 기사" 같은 인자가 없기 때문이고, 그 편이 에이전트를 건드리지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/authz';
import { runChatAgent, type AgentTurn } from '@/lib/sparkscope/chat-agent';
import { getLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 챗봇과 같은 이유 — DB(서울)와 같은 리전에서 돈다.
export const preferredRegion = 'icn1';
// 도구를 여러 번 부르면 오래 걸린다. 챗봇과 같은 여유를 준다.
export const maxDuration = 120;

const Body = z.object({
  question: z.string().trim().min(2).max(500),
  title: z.string().trim().min(1).max(400),
  source: z.string().trim().max(120).default(''),
  publishedAt: z.string().trim().max(40).default(''),
  url: z.string().trim().url().max(2000),
  summary: z.array(z.string().max(2000)).max(12).default([]),
  alsoIn: z.array(z.string().max(120)).max(30).default([]),
  grounding: z.enum(['full', 'partial', 'headline']).default('headline'),
  portfolio: z
    .array(z.object({ company: z.string().max(120), reason: z.string().max(500) }))
    .max(10)
    .optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(12)
    .default([]),
});

/** 읽고 있는 기사를 대화 첫 턴으로 만든다. */
function articleTurns(c: z.infer<typeof Body>): AgentTurn[] {
  const lines = [
    '지금 사용자가 읽고 있는 기사입니다. 이 기사에 대한 질문이면 아래 내용을 근거로 답하고,',
    '기사에 없는 사실을 "기사에 따르면"처럼 말하지 마세요. 기사와 무관한 질문에는 평소대로 답하면 됩니다.',
    '',
    `제목: ${c.title}`,
    `매체: ${c.source}`,
    `보도일: ${c.publishedAt}`,
    `링크: ${c.url}`,
    c.grounding === 'headline'
      ? '수집 상태: 제목만 수집됨 (본문 요약 없음)'
      : `수집 상태: ${c.grounding}`,
  ];
  if (c.summary.length) lines.push('', '요약:', ...c.summary);
  if (c.alsoIn.length) lines.push('', `같은 소식을 다룬 매체: ${c.alsoIn.join(', ')}`);
  if (c.portfolio?.length) {
    lines.push('', '엮인 포트폴리오사:');
    for (const p of c.portfolio) lines.push(`- ${p.company}: ${p.reason}`);
  }
  return [
    { role: 'user', text: lines.join('\n') },
    { role: 'assistant', text: '기사 내용을 확인했습니다. 무엇이든 물어보세요.' },
  ];
}

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { question, history, ...ctx } = parsed.data;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const locale = getLocale();
  try {
    const outcome = await runChatAgent({
      question,
      history: [...articleTurns(parsed.data), ...(history as AgentTurn[])],
      // 기사 하나에서 출발하지만 에이전트가 DB 전체를 볼 수 있어야
      // "이번 주 다른 뉴스는?" 같은 질문에 답할 수 있다.
      period: 'week',
      scopes: ['portfolio', 'competitor', 'sparklabs', 'industry', 'inter'],
      deep: false,
      asTable: false,
      userEmail: gate.user.email,
      locale: locale === 'en' ? 'en' : 'ko',
    });
    return NextResponse.json({
      answer: outcome.summary ?? '',
      followUps: outcome.followUps ?? [],
      headlineOnly: ctx.grounding === 'headline',
      steps: outcome.steps?.length ?? 0,
    });
  } catch (e) {
    console.error('[inter/ask] 실패:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
