// 그날(KST) 편집 수정 저장 — 브리핑 헤드라인 + 메일 TOP 3 + 제외 기사. 10:30 자동 발송과 브리핑 영상이 읽는다.
// 전부 비워서 저장하면 자동 선정으로 돌아간다.
import { NextResponse } from 'next/server';
import { requireInternal } from '@/lib/authz';
import { BRIEFING_MAX, loadDailyEdits, saveDailyEdits, type BriefingHeadline } from '@/lib/sparkscope/briefing';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireInternal();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ edits: await loadDailyEdits() });
}

function isHeadline(h: any): h is BriefingHeadline {
  return h && (h.kind === 'intra' || h.kind === 'inter')
    && ['ref', 'title', 'summary', 'source', 'url', 'label'].every(k => typeof h[k] === 'string');
}
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

export async function POST(req: Request) {
  const gate = await requireInternal();
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { headlines, top3Links, excludedLinks, autoSuggested } = body;
  if (!Array.isArray(headlines) || !headlines.every(isHeadline) || !isStringList(top3Links) || !isStringList(excludedLinks)) {
    return NextResponse.json({ error: '저장 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  if (headlines.length > BRIEFING_MAX || top3Links.length > 3) {
    return NextResponse.json({ error: `헤드라인은 최대 ${BRIEFING_MAX}개, TOP 3는 최대 3개입니다.` }, { status: 400 });
  }
  const auto = autoSuggested as { headlines?: unknown; top3Links?: unknown } | undefined;
  await saveDailyEdits({
    headlines,
    top3Links,
    excludedLinks,
    autoSuggested: auto && isStringList(auto.headlines) && isStringList(auto.top3Links)
      ? { headlines: auto.headlines, top3Links: auto.top3Links }
      : undefined,
    savedBy: gate.user.email ?? undefined,
  });
  return NextResponse.json({ ok: true });
}
