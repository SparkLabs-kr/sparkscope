'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export function NoiseReportButton({ id, initial }: { id: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [suggestionCreated, setSuggestionCreated] = useState(false);

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
      const data = await res.json();
      const next = data.isNoise as boolean;
      setOn(next);
      const justReported = next && !wasOn; // 방금 새로 신고 처리된 경우에만 안내
      setShowUndo(justReported);
      setSuggestionCreated(justReported && !!data.suggestionCreated);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!showUndo) return;
    // AI 제안이 생겼으면 링크 읽고 클릭할 시간을 좀 더 준다 — 5초는 놓치기 쉬움
    // (2026-08-06: "신고했는데 아무것도 안 뜬다" 문의 — 제안이 별도 페이지에 조용히 쌓여서 몰랐음).
    const t = setTimeout(() => setShowUndo(false), suggestionCreated ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [showUndo, suggestionCreated]);

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
        <span className="absolute right-0 top-full mt-1 z-10 whitespace-nowrap rounded-md bg-gray-900 text-white text-[11px] px-2 py-1.5 shadow-lg flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            노이즈로 처리했습니다
            <button
              type="button"
              onClick={() => { setShowUndo(false); toggle(); }}
              className="underline font-semibold hover:text-spark-purple-light"
            >
              실행취소
            </button>
          </span>
          {suggestionCreated && (
            <Link href="/dashboard/noise-suggestions" className="underline font-semibold text-emerald-300 hover:text-emerald-200">
              🔍 AI 재발방지 제안 생성됨 · 확인하러 가기
            </Link>
          )}
        </span>
      )}
    </span>
  );
}
