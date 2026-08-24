'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

export function BookmarkIcon({ id, initial }: { id: string; initial: boolean }) {
  const t = useT();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const res = await fetch('/api/bookmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: id }),
    });
    if (res.ok) setOn((await res.json()).isBookmarked);
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={on ? t('북마크 해제') : t('내 북마크에 추가')}
      className={`leading-none transition-colors ${on ? 'text-spark-purple' : 'text-gray-300 hover:text-spark-purple/60'}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 18" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M1 1.7C1 1.3 1.3 1 1.7 1h10.6c.4 0 .7.3.7.7v15l-6-4-6 4Z" />
      </svg>
    </button>
  );
}
