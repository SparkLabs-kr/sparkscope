'use client';
import { useState } from 'react';

// 일반 사용자용 노이즈 신고 요청 버튼 — 관리자의 NoiseReportButton과 달리 클릭 즉시 처리되지 않고
// 사유를 입력받아 요청만 접수한다(승인은 관리자가 별도로 함). Article.isNoise는 여기서 바뀌지 않는다.
export function NoiseReportRequestButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const trimmed = reason.trim();
    if (busy || !trimmed) return;
    setBusy(true);
    setError('');
    const res = await fetch('/api/noise-report-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: id, reason: trimmed }),
    });
    setBusy(false);
    if (res.ok) {
      setSent(true);
      setOpen(false);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? '신고 접수에 실패했습니다.');
    }
  }

  if (sent) {
    return (
      <span
        title="신고가 접수됐습니다. 관리자 검토 후 처리됩니다."
        className="leading-none text-emerald-600"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3.5 8.5L6.5 11.5L12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="노이즈 신고 요청"
        className="leading-none transition-colors text-gray-300 hover:text-red-400"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="6.4" />
          <line x1="4.7" y1="4.7" x2="11.3" y2="11.3" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg border border-gray-200 bg-white p-2.5 text-left shadow-lg"
          onClick={e => e.stopPropagation()}
        >
          <div className="mb-1 text-[11px] font-semibold text-gray-700">노이즈 신고 사유</div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="예: 회사와 무관한 동명이인 기사입니다"
            className="w-full resize-none rounded border border-gray-200 p-1.5 text-xs focus:border-spark-purple focus:outline-none"
          />
          {error && <div className="mt-1 text-[11px] text-red-600">{error}</div>}
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50">
              취소
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !reason.trim()}
              className="rounded bg-spark-purple px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              신고
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
