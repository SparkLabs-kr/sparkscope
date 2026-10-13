// 브리핑 영상 시청 집계 — 관리자 전용. 개인 이름·이메일이 나오므로 ADMIN 이 아니면 대시보드로 돌려보낸다.
// 기간은 브리핑 날짜 기준이다. 예: 화요일 방송 통계 = 시작일·종료일 모두 화요일 날짜.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/authz';
import {
  addDays,
  divisionStats,
  kstToday,
  personStats,
  programOf,
  type Program,
  type Range,
} from '@/lib/sparkscope/briefing-stats';

export const dynamic = 'force-dynamic';

const PROGRAMS: { key: Program; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'daily', label: '데일리' },
  { key: 'weekly', label: '위클리' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function pillClass(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 text-sm font-semibold ${
    active
      ? 'border-spark-purple bg-spark-purple text-white'
      : 'border-spark-border bg-white text-spark-ink-soft hover:border-spark-purple/40'
  }`;
}

export default async function BriefingStatsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; program?: string };
}) {
  // ADMIN 역할만(명단 기준). canManage 는 스크랩 허용 목록도 통과시키므로 쓰지 않는다.
  const user = await getSessionUser();
  if (user?.role !== 'ADMIN' || !user.active) redirect('/dashboard');

  const today = kstToday();
  const to = DATE_RE.test(searchParams.to ?? '') ? searchParams.to! : today;
  const from = DATE_RE.test(searchParams.from ?? '') ? searchParams.from! : addDays(to, -6);
  const program = programOf(searchParams.program);
  // 시작일이 종료일보다 뒤면 기간을 뒤집어 보여준다(잘못 고른 경우를 막는다).
  const range: Range = from <= to ? { from, to } : { from: to, to: from };

  const [divisions, people] = await Promise.all([divisionStats(range, program), personStats(range, program)]);

  const linkFor = (r: Range, p: Program) => `/dashboard/briefing-stats?from=${r.from}&to=${r.to}&program=${p}`;
  const yesterday = addDays(today, -1);
  const quick: { label: string; r: Range }[] = [
    { label: '어제', r: { from: yesterday, to: yesterday } },
    { label: '최근 7일', r: { from: addDays(today, -6), to: today } },
    { label: '최근 30일', r: { from: addDays(today, -29), to: today } },
  ];
  const isQuickActive = (r: Range) => r.from === range.from && r.to === range.to;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 text-spark-ink">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-spark-purple">관리자 전용</div>
          <h1 className="mt-1 text-2xl font-bold">👀 SparkScope 본부별 참여 현황</h1>
        </div>
        <Link href="/dashboard" className="text-sm text-spark-ink-soft hover:text-spark-purple">← 대시보드</Link>
      </div>

      {/* 방송 구분 */}
      <div className="mt-5 flex items-center gap-2">
        <span className="w-14 text-xs font-semibold text-spark-muted">방송</span>
        {PROGRAMS.map(g => (
          <Link key={g.key} href={linkFor(range, g.key)} className={pillClass(g.key === program)}>
            {g.label}
          </Link>
        ))}
      </div>

      {/* 날짜 선택 — 브리핑 날짜 기준 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="w-14 text-xs font-semibold text-spark-muted">날짜</span>
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="program" value={program} />
          <input type="date" name="from" defaultValue={range.from} className="rounded-lg border border-spark-border px-2 py-1.5 text-sm" />
          <span className="text-spark-muted">~</span>
          <input type="date" name="to" defaultValue={range.to} className="rounded-lg border border-spark-border px-2 py-1.5 text-sm" />
          <button type="submit" className="rounded-lg bg-spark-purple px-3 py-1.5 text-sm font-semibold text-white">조회</button>
        </form>
      </div>

      {/* 자주 쓰는 기간 바로가기 */}
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-16">
        {quick.map(q => (
          <Link key={q.label} href={linkFor(q.r, program)} className={pillClass(isQuickActive(q.r))}>
            {q.label}
          </Link>
        ))}
      </div>

      <p className="mt-4 text-xs text-spark-muted">
        조회 기간: {range.from} ~ {range.to} (브리핑 날짜 기준) · 방송: {PROGRAMS.find(p => p.key === program)?.label}
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-bold">본부별</h2>
        <p className="mt-1 text-xs text-spark-muted">시청자는 구독자 기준(잔디 등 익명은 방문 기준)</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-spark-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-spark-light-purple text-left text-spark-ink-soft">
              <tr>
                <th className="px-3 py-2">본부</th>
                <th className="px-3 py-2 text-right">시청자</th>
                <th className="px-3 py-2 text-right">클릭(열기)</th>
                <th className="px-3 py-2 text-right">재생</th>
                <th className="px-3 py-2 text-right">완주</th>
                <th className="px-3 py-2 text-right">완주율</th>
              </tr>
            </thead>
            <tbody>
              {divisions.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-spark-muted">이 기간에 기록이 없습니다.</td></tr>
              )}
              {divisions.map(d => (
                <tr key={d.division} className="border-t border-spark-border">
                  <td className="px-3 py-2 font-semibold">{d.division}</td>
                  <td className="px-3 py-2 text-right">{d.viewers}</td>
                  <td className="px-3 py-2 text-right">{d.opens}</td>
                  <td className="px-3 py-2 text-right">{d.plays}</td>
                  <td className="px-3 py-2 text-right">{d.completes}</td>
                  <td className="px-3 py-2 text-right">{d.completionRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">구독자별 (누가 봤는지)</h2>
        <p className="mt-1 text-xs text-spark-muted">최근 시청순 · 관리자만 보는 개인 정보입니다</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-spark-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-spark-light-purple text-left text-spark-ink-soft">
              <tr>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">본부</th>
                <th className="px-3 py-2">부서</th>
                <th className="px-3 py-2 text-right">클릭(열기)</th>
                <th className="px-3 py-2 text-right">재생</th>
                <th className="px-3 py-2 text-right">완주</th>
                <th className="px-3 py-2">마지막 시청(KST)</th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-spark-muted">이 기간에 기록이 없습니다.</td></tr>
              )}
              {people.map(p => (
                <tr key={p.email} className="border-t border-spark-border">
                  <td className="px-3 py-2 font-semibold">{p.name ?? p.email}</td>
                  <td className="px-3 py-2">{p.division}</td>
                  <td className="px-3 py-2">{p.department ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{p.opens}</td>
                  <td className="px-3 py-2 text-right">{p.plays}</td>
                  <td className="px-3 py-2 text-right">{p.completes}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(p.lastViewedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
