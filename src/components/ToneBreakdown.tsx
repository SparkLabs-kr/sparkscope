'use client';
// 톤 분석 — 막대를 클릭하면 해당 논조(긍정/중립/부정)의 기사 목록이 펼쳐진다.
import { useState } from 'react';

interface ToneArticle {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date | string;
  tone: string;
}

const TONES = [
  { key: 'POSITIVE', label: '긍정', bar: 'bg-emerald-600', soft: 'border-emerald-100 bg-emerald-50/60' },
  { key: 'NEUTRAL', label: '중립', bar: 'bg-slate-400', soft: 'border-spark-border bg-spark-subtle' },
  { key: 'NEGATIVE', label: '부정', bar: 'bg-red-500', soft: 'border-red-100 bg-red-50/60' },
];

export function ToneBreakdown({ articles }: { articles: ToneArticle[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = articles.length || 1;

  return (
    <div className="space-y-2 mt-1">
      {TONES.map(t => {
        const list = articles.filter(a => (a.tone || 'NEUTRAL') === t.key);
        const pct = (list.length / total) * 100;
        const isOpen = open === t.key;
        const clickable = list.length > 0;
        return (
          <div key={t.key}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => setOpen(isOpen ? null : t.key)}
              className={`w-full flex items-center gap-3 text-sm rounded-lg px-1.5 py-1 -mx-1.5 transition-colors ${clickable ? 'hover:bg-spark-subtle cursor-pointer' : 'cursor-default opacity-70'}`}
            >
              <span className="w-9 text-left text-spark-ink-soft">{t.label}</span>
              <span className="flex-1 h-5 bg-spark-subtle rounded overflow-hidden">
                <span className={`block h-full rounded ${t.bar}`} style={{ width: `${pct}%` }} />
              </span>
              <span className="w-9 text-right font-semibold tabular-nums text-spark-ink">{list.length}</span>
              <span className={`w-3 text-[11px] text-spark-muted transition-transform ${clickable ? '' : 'invisible'} ${isOpen ? 'rotate-90' : ''}`}>›</span>
            </button>
            {isOpen && (
              <div className="mt-2 mb-1 ml-9 space-y-1.5 max-h-72 overflow-y-auto scroll-slim pr-1">
                {list.map(a => {
                  const d = new Date(a.pubDate);
                  return (
                    <a key={a.id} href={a.link} target="_blank" rel="noopener noreferrer" className={`block rounded-lg border ${t.soft} p-2 hover:brightness-[0.97] transition`}>
                      <div className="text-xs text-spark-ink leading-snug line-clamp-2">{a.title}</div>
                      <div className="text-[10px] text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-spark-muted pt-0.5">막대를 클릭하면 해당 논조의 기사 목록이 열립니다.</p>
    </div>
  );
}
