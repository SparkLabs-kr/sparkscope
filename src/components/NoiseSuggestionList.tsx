'use client';
import { useState } from 'react';

interface Item {
  suggestion: {
    id: string;
    targetName: string;
    field: string;
    currentValue: string | null;
    addition: string;
    reason: string;
    createdAt: string | Date;
  };
  article: { id: string; title: string; link: string; source: string };
}

const FIELD_LABEL: Record<string, string> = { excludeWords: '제외어', contextWords: '문맥어' };

export function NoiseSuggestionList({ items: initial }: { items: Item[] }) {
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(id: string, action: 'approve' | 'reject') {
    if (busyId) return;
    setBusyId(id);
    const res = await fetch(`/api/noise-suggestions/${id}/${action}`, { method: 'POST' });
    if (res.ok) setItems(prev => prev.filter(it => it.suggestion.id !== id));
    setBusyId(null);
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-12 text-center">대기 중인 제안이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map(({ suggestion: s, article: a }) => (
        <div key={s.id} className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-gray-900 hover:text-spark-purple">
                {a.title}
              </a>
              <div className="text-xs text-gray-500 mt-0.5">{a.source} · 신고된 기사 · 감시대상: {s.targetName}</div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => resolve(s.id, 'reject')}
                disabled={busyId === s.id}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                거부
              </button>
              <button
                onClick={() => resolve(s.id, 'approve')}
                disabled={busyId === s.id}
                className="rounded-lg bg-spark-purple px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                승인
              </button>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-spark-light-purple/30 border border-spark-light-purple p-3 text-sm">
            <div className="font-semibold text-spark-purple mb-1">
              {FIELD_LABEL[s.field] ?? s.field}에 추가 제안: <span className="font-mono">"{s.addition}"</span>
            </div>
            <div className="text-xs text-gray-500 mb-1">현재 값: {s.currentValue || '(없음)'}</div>
            <div className="text-xs text-gray-600">{s.reason}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
