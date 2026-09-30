// 잔디 연결 테스트 — 검수 화면 버튼. 관리 권한자만. 발송 기록은 남기지 않는다.
import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/authz';
import { sendJandiTest } from '@/lib/briefing-video/notify';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.response;
  try {
    await sendJandiTest(process.env.NEXTAUTH_URL ?? new URL(req.url).origin);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
