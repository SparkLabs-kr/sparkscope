'use client';
import { useState } from 'react';

const FIELD_LABEL: Record<string, string> = { excludeWords: '제외어', contextWords: '문맥어' };

interface ArticleRef { id: string; title: string; link: string; source: string }

export type QueueItem =
  | {
      kind: 'ai';
      id: string;
      article: ArticleRef;
      targetName: string;
      field: string;
      currentValue: string | null;
      addition: string;
      reason: string;
      createdAt: string | Date;
    }
  | {
      kind: 'user';
      id: string;
      article: ArticleRef;
      reportedBy: string;
      reason: string;
      createdAt: string | Date;
    };

// 노이즈 제안 통합 목록 — AI가 낸 재발방지 제안과 사용자가 접수한 신고를 한 탭에서 시간순으로
// 섞어 보여준다. 둘 다 승인해야만 실제로 반영되는 건 같지만, 승인 시 호출하는 API는 다르다
// (AI 제안 승인 → MonitoringTarget 설정 반영 / 사용자 신고 승인 → Article.isNoise 처리 + AI 제안 생성).
export function NoiseQueueList({ items: initial }: { items: QueueItem[] }) {
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(item: QueueItem, action: 'approve' | 'reject') {
    if (busyId) return;
    setBusyId(item.id);
    const base = item.kind === 'ai' ? '/api/noise-suggestions' : '/api/noise-report-requests';
    const res = await fetch(`${base}/${item.id}/${action}`, { method: 'POST' });
    if (res.ok) setItems(prev => prev.filter(it => it.id !== item.id));
    setBusyId(null);
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-12 text-center">대기 중인 제안·신고가 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map(item => {
        const a = item.article;
        return (
          <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  {item.kind === 'ai' ? (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-spark-light-purple text-spark-purple">🤖 AI 제안</span>
                  ) : (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">👤 사용자 신고</span>
                  )}
                </div>
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-gray-900 hover:text-spark-purple">
                  {a.title}
                </a>
                <div className="text-xs text-gray-500 mt-0.5">
                  {a.source}
                  {item.kind === 'ai' ? ` · 감시대상: ${item.targetName}` : ` · 신고자: ${item.reportedBy}`}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => resolve(item, 'reject')}
                  disabled={busyId === item.id}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  거절
                </button>
                <button
                  onClick={() => resolve(item, 'approve')}
                  disabled={busyId === item.id}
                  className="rounded-lg bg-spark-purple px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  승인
                </button>
              </div>
            </div>

            {item.kind === 'ai' ? (
              <div className="mt-3 rounded-lg bg-spark-light-purple/30 border border-spark-light-purple p-3 text-sm">
                <div className="font-semibold text-spark-purple mb-1">
                  {FIELD_LABEL[item.field] ?? item.field}에 추가 제안: <span className="font-mono">"{item.addition}"</span>
                </div>
                <div className="text-xs text-gray-500 mb-1">현재 값: {item.currentValue || '(없음)'}</div>
                <div className="text-xs text-gray-600">{item.reason}</div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-gray-700">
                {item.reason}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
