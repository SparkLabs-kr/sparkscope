'use client';
/**
 * 분석 오류 의심 큐 — 매주 월요일 자동 감사(analysis-audit.ts)가 쌓은 항목.
 *
 * 노이즈 제안(NoiseQueueList)과 승인/거절 뼈대는 같지만 한 가지가 다르다: 여기선
 * "확정"을 눌러도 시스템이 자동으로 값을 안 고친다. 1차 자동 검사 자체가 오탐이
 * 많았던 걸 확인했기 때문에(45건 중 30건), 관리자가 실제 값을 직접 입력해야
 * Article.tone/riskFlag/oneLiner가 바뀐다.
 */
import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import { articleTitle } from '@/lib/sparkscope/article-title';

export interface AuditFlagItem {
  id: string;
  article: { id: string; title: string; titleEn?: string | null; link: string; source: string };
  snapshotTone: string | null;
  snapshotRiskFlag: string | null;
  snapshotOneLiner: string | null;
  issue: string;
  confidence: string; // 'high' | 'low'
  createdAt: string | Date;
}

const RISK_OPTIONS = [
  { value: '', label: '(없음)' },
  { value: 'litigation', label: '소송·수사·규제' },
  { value: 'crisis', label: '사고·재무' },
  { value: 'controversy', label: '논란·평판' },
];

export function AnalysisAuditQueueList({ items: initial }: { items: AuditFlagItem[] }) {
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ tone: string; riskFlag: string; oneLiner: string }>({ tone: '', riskFlag: '', oneLiner: '' });

  function startEdit(item: AuditFlagItem) {
    setEditing(item.id);
    setForm({
      tone: item.snapshotTone ?? '',
      riskFlag: item.snapshotRiskFlag ?? '',
      oneLiner: item.snapshotOneLiner ?? '',
    });
  }

  async function confirm(item: AuditFlagItem) {
    if (busyId) return;
    setBusyId(item.id);
    const res = await fetch(`/api/analysis-audit-flags/${item.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tone: form.tone, riskFlag: form.riskFlag || null, oneLiner: form.oneLiner }),
    });
    if (res.ok) { setItems(prev => prev.filter(it => it.id !== item.id)); setEditing(null); }
    setBusyId(null);
  }

  async function dismiss(item: AuditFlagItem) {
    if (busyId) return;
    setBusyId(item.id);
    const res = await fetch(`/api/analysis-audit-flags/${item.id}/dismiss`, { method: 'POST' });
    if (res.ok) setItems(prev => prev.filter(it => it.id !== item.id));
    setBusyId(null);
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-12 text-center">{t('의심되는 분석 오류가 없습니다.')}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map(item => {
        const a = item.article;
        const isEditing = editing === item.id;
        return (
          <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    item.confidence === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {item.confidence === 'high' ? `⚠️ ${t('확실')}` : `❓ ${t('원문 확인 필요')}`}
                  </span>
                </div>
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-gray-900 hover:text-spark-purple">
                  {articleTitle(a, locale)}
                </a>
                <div className="text-xs text-gray-500 mt-0.5">{t(a.source)}</div>
              </div>
              {!isEditing && (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => dismiss(item)}
                    disabled={busyId === item.id}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t('기각')}
                  </button>
                  <button
                    onClick={() => startEdit(item)}
                    disabled={busyId === item.id}
                    className="rounded-lg bg-spark-purple px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {t('확정 → 값 수정')}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 rounded-lg bg-red-50 border border-red-100 p-3 text-sm">
              <div className="text-xs text-gray-500 mb-1">
                {t('저장된 값')}: tone={item.snapshotTone ?? '—'} · riskFlag={item.snapshotRiskFlag ?? '—'}
              </div>
              <div className="text-xs text-gray-500 mb-1">{t('저장된 요약')}: {item.snapshotOneLiner ?? '—'}</div>
              <div className="text-xs text-gray-700 font-semibold">{t('의심 사유')}: {item.issue}</div>
            </div>

            {isEditing && (
              <div className="mt-3 rounded-lg bg-spark-light-purple/30 border border-spark-light-purple p-3 space-y-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="text-xs font-semibold text-gray-600 w-20">tone</label>
                  <select
                    value={form.tone}
                    onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
                    className="text-xs border border-gray-200 rounded px-2 py-1"
                  >
                    <option value="POSITIVE">POSITIVE</option>
                    <option value="NEUTRAL">NEUTRAL</option>
                    <option value="NEGATIVE">NEGATIVE</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="text-xs font-semibold text-gray-600 w-20">riskFlag</label>
                  <select
                    value={form.riskFlag}
                    onChange={e => setForm(f => ({ ...f, riskFlag: e.target.value }))}
                    className="text-xs border border-gray-200 rounded px-2 py-1"
                  >
                    {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">oneLiner</label>
                  <textarea
                    value={form.oneLiner}
                    onChange={e => setForm(f => ({ ...f, oneLiner: e.target.value }))}
                    rows={2}
                    className="text-xs border border-gray-200 rounded px-2 py-1.5 w-full"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setEditing(null)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                  >
                    {t('취소')}
                  </button>
                  <button
                    onClick={() => confirm(item)}
                    disabled={busyId === item.id}
                    className="rounded-lg bg-spark-purple px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {t('저장')}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
