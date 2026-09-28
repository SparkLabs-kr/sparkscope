// 데일리 브리핑 🤖 추천 다시 계산 — 검수 화면의 [추천 다시 받기]. 결과는 캐시에 덮어써져 발송 때도 이걸 쓴다.
import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/authz';
import { getBriefingRecommendation } from '@/lib/sparkscope/briefing-reco';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const gate = await requireManager();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ reco: await getBriefingRecommendation(true) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
