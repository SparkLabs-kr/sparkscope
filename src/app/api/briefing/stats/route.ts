// 브리핑 영상 시청 집계 API — 본부별 요약. 관리자(ADMIN)만 본다.
// 기간은 브리핑 날짜 범위(from·to, YYYY-MM-DD). 생략하면 최근 7일.
// 개인별 목록은 이 API가 아니라 관리자 화면(/dashboard/briefing-stats)에서 서버가 직접 읽는다.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/authz';
import { addDays, divisionStats, kstToday, programOf } from '@/lib/sparkscope/briefing-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  // 역할이 ADMIN인 사람만(명단 기준). canManage 는 스크랩 허용 목록도 통과시키므로 쓰지 않는다.
  const user = await getSessionUser();
  if (user?.role !== 'ADMIN' || !user.active) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const to = DATE_RE.test(url.searchParams.get('to') ?? '') ? url.searchParams.get('to')! : kstToday();
  const fromParam = url.searchParams.get('from') ?? '';
  const from = DATE_RE.test(fromParam) ? fromParam : addDays(to, -6);
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366) {
    return NextResponse.json({ error: 'bad range' }, { status: 400 });
  }
  const program = programOf(url.searchParams.get('program'));

  return NextResponse.json({ from, to, program, rows: await divisionStats({ from, to }, program) });
}
