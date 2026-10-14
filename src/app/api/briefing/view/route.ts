// 브리핑 영상 시청 이벤트 수집. 로그인 없이 열리는 페이지에서 부르므로 공개 API다(middleware PUBLIC_API_EXACT).
// token이 DigestSubscriber 와 맞으면 그 구독자로 연결하고, 안 맞거나 없으면 익명으로 남긴다.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRealSessionUser } from '@/lib/authz';

export const runtime = 'nodejs';

const EVENTS = new Set(['open', 'play', 'half', 'complete']);

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const dateKey = typeof body?.dateKey === 'string' ? body.dateKey : '';
  const event = typeof body?.event === 'string' ? body.event : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !EVENTS.has(event)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const visitorId = typeof body?.visitorId === 'string' && body.visitorId.length <= 64 ? body.visitorId : null;
  const token = typeof body?.token === 'string' && body.token.length <= 64 ? body.token : '';

  // 개인 식별: 메일 토큰이 있으면 그 구독자, 없으면 회사 구글 계정으로 로그인한 사람의 이메일로 찾는다.
  let subscriberId: string | null = null;
  if (token) {
    const sub = await prisma.digestSubscriber.findUnique({ where: { token }, select: { id: true } }).catch(() => null);
    subscriberId = sub?.id ?? null;
  } else {
    const me = await getRealSessionUser().catch(() => null);
    if (me?.email) {
      const sub = await prisma.digestSubscriber.findUnique({ where: { email: me.email.toLowerCase() }, select: { id: true } }).catch(() => null);
      subscriberId = sub?.id ?? null;
    }
  }

  await prisma.briefingView.create({ data: { dateKey, event, visitorId, subscriberId } });
  return NextResponse.json({ ok: true });
}
