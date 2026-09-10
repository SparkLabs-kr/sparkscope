/**
 * 다이제스트 항목 하나에 대한 질문. 로그인한 사람이면 누구나(열람 권한).
 *
 * 화면이 이미 보여주고 있는 요약·메타데이터를 그대로 받아 답한다. 원문
 * 발췌(sourceText)는 응답 크기 때문에 브라우저로 내려보내지 않으므로
 * 여기서도 쓰지 않는다 — 대신 grounding 을 받아 근거의 한계를 모델에 알린다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/authz';
import { askAboutItem } from '@/lib/sparkscope/inter-ask';

export const runtime = 'nodejs';

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
});

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { question, ...ctx } = parsed.data;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  try {
    const result = await askAboutItem(ctx, question);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[inter/ask] 실패:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
