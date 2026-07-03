// 메인 대시보드 — KPI 카드, 피칭 기회, 톤 분석, 매체 분포, 최근 기사 테이블
import { prisma } from '@/lib/prisma';
import { ArticlesTable } from '@/components/ArticlesTable';
import { TrendChart } from '@/components/TrendChart';
import { MediaChart } from '@/components/MediaChart';
import { RoadmapPreview } from '@/components/RoadmapPreview';
import { OPEN_ACCESS } from '@/lib/flags';

export const dynamic = 'force-dynamic';

async function loadDashboardData() {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const where = { pubDate: { gte: since }, isNoise: false };

  const [total, sparklabsCount, portfolioCount, pitchCount, articles, sourceGroups, toneGroups, pitches] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.count({ where: { ...where, category: 'sparklabs_self' } }),
    prisma.article.count({ where: { ...where, category: 'portfolio_company' } }),
    prisma.article.count({ where: { ...where, pitchScore: { gte: 75 } } }),
    prisma.article.findMany({ where, orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }], take: 30 }),
    prisma.article.groupBy({ by: ['source'], where, _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 8 }),
    prisma.article.groupBy({ by: ['tone'], where: { ...where, category: 'portfolio_company' }, _count: { _all: true } }),
    prisma.article.findMany({ where: { ...where, pitchScore: { gte: 60 } }, orderBy: { pitchScore: 'desc' }, take: 5 }),
  ]);

  // 30일 추이 (포트폴리오 상위 6개)
  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);
  const trendArticles = await prisma.article.findMany({
    where: { pubDate: { gte: since30 }, isNoise: false, category: 'portfolio_company' },
    select: { matchedKeyword: true, pubDate: true },
  });

  // 회사별 일별 카운트
  const trendData = buildTrendData(trendArticles);

  return {
    kpi: { total, sparklabsCount, portfolioCount, pitchCount },
    articles,
    sources: sourceGroups.map(s => ({ source: s.source, count: s._count._all })),
    tones: toneGroups.map(t => ({ tone: t.tone ?? 'NEUTRAL', count: t._count._all })),
    pitches,
    trendData,
  };
}

function buildTrendData(records: { matchedKeyword: string; pubDate: Date }[]) {
  const counts = new Map<string, number>();
  records.forEach(r => counts.set(r.matchedKeyword, (counts.get(r.matchedKeyword) ?? 0) + 1));
  const top6 = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);

  const days: string[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }

  const datasets = top6.map(name => {
    const dayCounts = new Map<string, number>();
    records
      .filter(r => r.matchedKeyword === name)
      .forEach(r => {
        const k = `${r.pubDate.getMonth() + 1}/${r.pubDate.getDate()}`;
        dayCounts.set(k, (dayCounts.get(k) ?? 0) + 1);
      });
    return { label: name, data: days.map(d => dayCounts.get(d) ?? 0) };
  });

  return { labels: days, datasets };
}

export default async function DashboardPage() {
  const data = await loadDashboardData();
  const todayLabel = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-3xl font-bold">{todayLabel}</h1>
          <p className="text-sm text-gray-500 mt-1">최근 7일 데이터 기준</p>
        </div>
      </div>

      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="총 수집 기사" value={data.kpi.total} />
        <KpiCard label="스파크랩 직접 언급" value={data.kpi.sparklabsCount} />
        <KpiCard label="포트폴리오사 노출" value={data.kpi.portfolioCount} />
        <KpiCard label="피칭 기회 (≥75점)" value={data.kpi.pitchCount} highlight />
      </div>

      {/* 추이 차트 + 피칭 기회 */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="font-bold">📈 포트폴리오사 누적 노출 (30일)</div>
              <div className="text-xs text-gray-500 mt-0.5">상위 6개사, 일별 추이</div>
            </div>
          </div>
          <TrendChart {...data.trendData} />
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-3">🎯 기획기사 피칭 기회</div>
          {data.pitches.length > 0 ? (
            <div className="space-y-3">
              {data.pitches.map(p => (
                <div key={p.id} className="p-3 bg-gradient-to-br from-amber-50 to-amber-100 border-l-4 border-amber-500 rounded-r-lg">
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-sm font-bold text-amber-900">{p.pitchTopic ?? p.matchedKeyword}</div>
                    <div className="text-xs px-2 py-0.5 bg-amber-500 text-white rounded-full font-bold">{p.pitchScore}점</div>
                  </div>
                  <div className="text-xs text-amber-800 truncate">{p.title}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">최근 7일 내 피칭 기회 (60점 이상) 없음</p>
          )}
        </div>
      </div>

      {/* 매체 + 톤 */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-4">📰 매체별 노출 분포</div>
          <MediaChart data={data.sources} />
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-4">💬 톤 분석 (포트폴리오)</div>
          <ToneBars tones={data.tones} />
        </div>
      </div>

      {/* 기사 테이블 */}
      <div className="bg-white p-5 rounded-xl border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <div>
            <div className="font-bold">📋 최근 수집 기사</div>
            <div className="text-xs text-gray-500 mt-0.5">최근 7일 · 상위 30건 · 검색·필터는 곧 추가 예정</div>
          </div>
        </div>
        <ArticlesTable articles={data.articles as any} />
      </div>

      {/* 발표용 고도화 미리보기 — 협업 개발 단계(OPEN_ACCESS)에서만 표시 */}
      {OPEN_ACCESS && <RoadmapPreview />}
    </>
  );
}

function KpiCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200">
      <div className="text-xs font-semibold text-gray-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${highlight ? 'text-spark-purple' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function ToneBars({ tones }: { tones: { tone: string; count: number }[] }) {
  const map = new Map(tones.map(t => [t.tone, t.count]));
  const positive = map.get('POSITIVE') ?? 0;
  const neutral = map.get('NEUTRAL') ?? 0;
  const negative = map.get('NEGATIVE') ?? 0;
  const total = positive + neutral + negative || 1;

  return (
    <div className="space-y-3 mt-4">
      <ToneRow label="긍정" count={positive} total={total} color="bg-green-600" />
      <ToneRow label="중립" count={neutral} total={total} color="bg-slate-400" />
      <ToneRow label="부정" count={negative} total={total} color="bg-red-600" />
    </div>
  );
}

function ToneRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = (count / total) * 100;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-12 text-gray-500">{label}</div>
      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-10 text-right font-semibold">{count}</div>
    </div>
  );
}
