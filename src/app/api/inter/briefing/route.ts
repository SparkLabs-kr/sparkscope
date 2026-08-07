// 포트폴리오사 브리핑 생성/발송 API.
//
// POST /api/inter/briefing
//   body: { ...BriefingInput, send?: boolean }
//   - send 없이 호출하면 HTML만 만들어 돌려준다(화면 미리보기·복사용).
//   - send: true면 만든 HTML을 "로그인한 본인 메일"로만 보낸다. 1단계에는 포폴사
//     수신자 DB가 없어서 임의 주소로 보내는 경로를 아예 열지 않는다 — 대표님이 본인이
//     받아서 확인하고 직접 포워딩하는 흐름. 나중에 PortfolioCompany.contactEmail이
//     생기면 여기 to만 그 값으로 바꾸면 된다.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';
import {
  briefingSubject,
  renderBriefingHtml,
  summarizeBriefing,
  type BriefingInput,
} from '@/lib/sparkscope/inter-briefing';
import { sendDigestEmail } from '@/lib/sparkscope/mailer';

export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const maxDuration = 60;

function parseInput(b: any): BriefingInput | null {
  if (!b || typeof b.company !== 'string' || !b.company.trim()) return null;
  if (!b.sector || !b.overview || !Array.isArray(b.articles)) return null;
  return {
    company: String(b.company).slice(0, 80),
    domainLabel: String(b.domainLabel ?? '해외').slice(0, 20),
    periodLabel: String(b.periodLabel ?? '').slice(0, 40),
    sector: {
      name: String(b.sector.name ?? ''),
      badgeLabel: String(b.sector.badgeLabel ?? ''),
      badgeWhy: String(b.sector.badgeWhy ?? ''),
      count: Number(b.sector.count) || 0,
      deltaPct: b.sector.deltaPct === null ? null : Number(b.sector.deltaPct),
      share: Number(b.sector.share) || 0,
      sourceCount: Number(b.sector.sourceCount) || 0,
      paperCount: Number(b.sector.paperCount) || 0,
      matchCount: Number(b.sector.matchCount) || 0,
    },
    overview: {
      total: Number(b.overview.total) || 0,
      deltaPct: b.overview.deltaPct === null ? null : Number(b.overview.deltaPct),
      sourceCount: Number(b.overview.sourceCount) || 0,
      matchCount: Number(b.overview.matchCount) || 0,
      matchedCompanyCount: Number(b.overview.matchedCompanyCount) || 0,
      topSectors: (b.overview.topSectors ?? []).slice(0, 5).map((s: any) => ({
        name: String(s?.name ?? ''),
        count: Number(s?.count) || 0,
        deltaPct: s?.deltaPct === null || s?.deltaPct === undefined ? null : Number(s.deltaPct),
      })),
    },
    articles: b.articles.slice(0, 30).map((a: any) => ({
      title: String(a?.title ?? ''),
      url: String(a?.url ?? ''),
      media: String(a?.media ?? ''),
      date: String(a?.date ?? ''),
      reason: String(a?.reason ?? ''),
      eventKey: a?.eventKey ? String(a.eventKey) : null,
    })),
  };
}

export async function POST(req: Request) {
  // 권한은 스크랩(별표)과 같은 기준 — SCRAP_ALLOWED_EMAILS에 있는 사람만.
  // 포폴사 대표에게 나갈 문서를 만드는 기능이라 대시보드 열람 권한보다 좁게 잡는다.
  // (canScrap은 OPEN_ACCESS 협업 모드에선 항상 true라, 발표·개발 중에는 그대로 열린다.)
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!canScrap(email)) {
    return NextResponse.json({ error: '브리핑 생성 권한이 없습니다.' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const input = parseInput(raw);
  if (!input) return NextResponse.json({ error: '브리핑 데이터가 올바르지 않습니다.' }, { status: 400 });

  const body = await summarizeBriefing(input);
  const html = renderBriefingHtml(input, body);
  const subject = briefingSubject(input);

  if (raw?.send === true) {
    if (!email) {
      return NextResponse.json(
        { html, subject, isAi: body.isAi, error: '로그인해야 본인 메일로 받을 수 있습니다. (미리보기·복사는 가능)' },
        { status: 401 }
      );
    }
    try {
      await sendDigestEmail({ subject, html, to: email });
      return NextResponse.json({ html, subject, isAi: body.isAi, sentTo: email });
    } catch (e) {
      console.error('[inter-briefing] send failed:', e);
      return NextResponse.json(
        { html, subject, isAi: body.isAi, error: '메일 발송에 실패했습니다.' },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ html, subject, isAi: body.isAi });
}
