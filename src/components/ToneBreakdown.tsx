'use client';
// 톤 분석 — 클릭 없이 세 논조(긍정/중립/부정)의 비율과 기사 목록이 한 화면에 바로 보인다.

interface ToneArticle {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date | string;
  tone: string;
}

const TONES = [
  { key: 'POSITIVE', label: '긍정', dot: 'bg-emerald-600', bar: 'bg-emerald-600', border: 'border-emerald-200', head: 'text-emerald-700', soft: 'bg-emerald-50/60 hover:bg-emerald-50' },
  { key: 'NEUTRAL', label: '중립', dot: 'bg-slate-400', bar: 'bg-slate-400', border: 'border-spark-border', head: 'text-spark-ink-soft', soft: 'bg-spark-subtle hover:bg-spark-subtle/70' },
  { key: 'NEGATIVE', label: '부정', dot: 'bg-red-500', bar: 'bg-red-500', border: 'border-red-200', head: 'text-red-700', soft: 'bg-red-50/60 hover:bg-red-50' },
];

export function ToneBreakdown({ articles }: { articles: ToneArticle[] }) {
  const total = articles.length || 1;
  const groups = TONES.map(t => ({
    ...t,
    list: articles.filter(a => (a.tone || 'NEUTRAL') === t.key),
  }));

  return (
    <div className="space-y-4 mt-1">
      {/* 한눈에 보는 비율 — 하나의 막대에 세 논조를 이어붙여 전체 대비를 바로 비교 */}
      <div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-spark-subtle">
          {groups.map(g => (
            g.list.length > 0 && (
              <span key={g.key} className={g.bar} style={{ width: `${(g.list.length / total) * 100}%` }} title={`${g.label} ${g.list.length}건`} />
            )
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          {groups.map(g => (
            <span key={g.key} className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${g.dot}`} />
              <span className="text-spark-ink-soft">{g.label}</span>
              <span className="font-semibold tabular-nums text-spark-ink">{g.list.length}</span>
              <span className="text-spark-muted">({Math.round((g.list.length / total) * 100)}%)</span>
            </span>
          ))}
        </div>
      </div>

      {/* 논조별 기사 — 클릭 없이 3열로 항상 펼쳐서 표시 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {groups.map(g => (
          <div key={g.key} className={`rounded-xl border ${g.border} overflow-hidden`}>
            <div className={`flex items-center justify-between px-3 py-2 text-xs font-bold ${g.head} bg-white`}>
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${g.dot}`} />
                {g.label}
              </span>
              <span className="tabular-nums">{g.list.length}건</span>
            </div>
            <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto scroll-slim">
              {g.list.length === 0 ? (
                <p className="text-[11px] text-spark-muted px-1 py-2">해당 논조 기사 없음</p>
              ) : g.list.map(a => {
                const d = new Date(a.pubDate);
                return (
                  <a key={a.id} href={a.link} target="_blank" rel="noopener noreferrer" className={`block rounded-lg border border-transparent ${g.soft} p-2 transition`}>
                    <div className="text-xs text-spark-ink leading-snug line-clamp-2">{a.title}</div>
                    <div className="text-[10px] text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
