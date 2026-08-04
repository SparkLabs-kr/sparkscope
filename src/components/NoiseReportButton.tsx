'use client';
import { useEffect, useState } from 'react';

export function NoiseReportButton({ id, initial }: { id: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [showUndo, setShowUndo] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const wasOn = on;
    const res = await fetch('/api/noise-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: id }),
    });
    if (res.ok) {
      const next = (await res.json()).isNoise as boolean;
      setOn(next);
      setShowUndo(next && !wasOn); // 방금 새로 신고 처리된 경우에만 실행취소 안내
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!showUndo) return;
    const t = setTimeout(() => setShowUndo(false), 5000);
    return () => clearTimeout(t);
  }, [showUndo]);

  return (
    <span className="relative inline-flex">
      <button
        onClick={toggle}
        disabled={busy}
        title={on ? '노이즈 해제' : '노이즈로 신고'}
        className={`leading-none transition-colors ${on ? 'text-red-600' : 'text-gray-300 hover:text-red-400'}`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="6.4" />
          <line x1="4.7" y1="4.7" x2="11.3" y2="11.3" />
        </svg>
      </button>
      {showUndo && (
        <span className="absolute right-0 top-full mt-1 z-10 whitespace-nowrap rounded-md bg-gray-900 text-white text-[11px] px-2 py-1 shadow-lg flex items-center gap-1.5">
          노이즈로 처리했습니다
          <button
            type="button"
            onClick={() => { setShowUndo(false); toggle(); }}
            className="underline font-semibold hover:text-spark-purple-light"
          >
            실행취소
          </button>
        </span>
      )}
    </span>
  );
}
