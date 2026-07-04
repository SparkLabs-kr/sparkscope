'use client';
import { useState } from 'react';

export function ScrapStar({ id, initial }: { id: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const res = await fetch('/api/scrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: id }),
    });
    if (res.ok) setOn((await res.json()).isScrapped);
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={on ? '스크랩 해제' : '스크랩'}
      className={`text-lg leading-none transition-colors ${on ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
