/**
 * 다이제스트 구독 설정 저장.
 *
 * 두 가지 방법으로 본인을 확인한다.
 *  - token: 메일 푸터 링크로 들어온 경우. 로그인 계정이 없는 사람(대부분)이 이 경로를 쓴다.
 *  - 로그인 세션: 대시보드에서 바꾸는 경우. 세션 이메일로 자기 행만 찾는다.
 * 둘 다 "자기 행 하나"만 건드릴 수 있어서, 남의 구독을 바꿀 방법이 없다.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SECTION_KEYS, type SectionKey } from '@/lib/sparkscope/subscription';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    sections?: Partial<Record<SectionKey, boolean>>;
    active?: boolean;
  };

  // 1) 누구의 행을 바꿀 것인가
  let where: { token: string } | { email: string };
  if (body.token) {
    where = { token: body.token };
  } else {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    where = { email };
  }

  // 2) 바꿀 값만 추린다 — 요청 본문에 없는 섹션은 건드리지 않는다.
  const data: Record<string, boolean> = {};
  for (const k of SECTION_KEYS) {
    const v = body.sections?.[k];
    if (typeof v === 'boolean') data[k] = v;
  }
  if (typeof body.active === 'boolean') data.active = body.active;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '바꿀 항목이 없습니다.' }, { status: 400 });
  }

  try {
    const subscriber = await prisma.digestSubscriber.update({
      where: where as any,
      data,
      select: {
        email: true, active: true,
        sparklabs: true, portfolio: true, inter: true,
        aiSignals: true, bioSignals: true, competitor: true, industry: true,
      },
    });
    return NextResponse.json({ ok: true, subscriber });
  } catch {
    // update는 대상이 없으면 던진다. 토큰이 틀렸거나, 로그인은 했는데 아직 구독자가 아닌 경우.
    return NextResponse.json({ error: '구독 정보를 찾을 수 없습니다.' }, { status: 404 });
  }
}
