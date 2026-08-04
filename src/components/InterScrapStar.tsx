'use client';
// Inter(해외 트렌드) 기사 스크랩 별표 — ScrapStar와 같은 UX, 엔드포인트만 /api/inter/scrap.
import { useState } from 'react';

export function InterScrapStar({ id, initial, onChange }: { id: string; initial: boolean; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation(); // 부모가 <a>라서 링크 이동을 막는다
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inter/scrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdictId: id }),
      });
      if (res.ok) {
        const next = (await res.json()).isScrapped as boolean;
        setOn(next);
        onChange?.(next);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={on ? '스크랩 해제' : '스크랩'}
      aria-pressed={on}
      className={`shrink-0 text-lg leading-none transition-colors ${on ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
