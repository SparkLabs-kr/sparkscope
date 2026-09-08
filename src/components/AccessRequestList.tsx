'use client';
/** 요청 목록 + 승인·거절. 결정하면 그 줄만 바뀌고 나머지는 그대로 둔다. */
import { useState } from 'react';
import type { AccessRequest } from '@/lib/sparkscope/access-request';

export function AccessRequestList({ requests }: { requests: AccessRequest[] }) {
  const [rows, setRows] = useState(requests);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (token: string, decision: 'approve' | 'deny') => {
    setBusy(token); setErr(null);
    try {
      const res = await fetch('/api/access-request/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error === 'already_staff'
          ? '이미 사내 계정으로 등록된 주소입니다.'
          : data?.error === 'already_decided'
            ? '이미 처리된 요청입니다.'
            : '처리하지 못했습니다.');
        return;
      }
      setRows(rs => rs.map(r => r.token === token
        ? { ...r, status: decision === 'approve' ? 'approved' : 'denied' }
        : r));
    } finally {
      setBusy(null);
    }
  };

  const pending = rows.filter(r => r.status === 'pending');
  const done = rows.filter(r => r.status !== 'pending');

  return (
    <div>
      {err && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div>
      )}

      {pending.length === 0 ? (
        <p className="text-[13.5px] text-spark-muted border border-spark-border rounded-xl px-4 py-8 text-center">
          대기 중인 요청이 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map(r => (
            <li key={r.token} className="border border-spark-border rounded-xl p-4 bg-white">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-1">
                <span className="font-bold rounded bg-spark-light-purple text-spark-purple px-1.5 py-0.5 text-[12px]">
                  {r.companyName}
                </span>
                <span className="font-semibold text-[14.5px]">{r.name}</span>
                {r.title && <span className="text-[12.5px] text-spark-muted">{r.title}</span>}
                <span className="ml-auto text-[11.5px] text-spark-muted tabular-nums">
                  {r.requestedAt.slice(0, 10)}
                </span>
              </div>
              <div className="text-[12.5px] text-spark-ink-soft">{r.email}</div>
              {r.referrer && (
                <div className="text-[12px] text-spark-muted mt-0.5">담당자 · {r.referrer}</div>
              )}
              {r.notified === false && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-800">
                  이 요청은 알림 메일이 나가지 않았습니다. 승인·거절은 그대로 가능합니다.
                  {r.notifyError ? ` (${r.notifyError})` : ''}
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  type="button" disabled={busy === r.token}
                  onClick={() => decide(r.token, 'approve')}
                  className="px-4 py-1.5 rounded-lg bg-spark-purple text-white text-[13px] font-semibold disabled:opacity-50"
                >
                  {busy === r.token ? '처리 중...' : '승인'}
                </button>
                <button
                  type="button" disabled={busy === r.token}
                  onClick={() => decide(r.token, 'deny')}
                  className="px-4 py-1.5 rounded-lg border border-spark-border text-[13px] font-semibold text-spark-muted disabled:opacity-50"
                >
                  거절
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <h2 className="text-[13px] font-bold text-spark-muted mt-8 mb-2">처리된 요청</h2>
          <ul className="space-y-1.5">
            {done.map(r => (
              <li key={r.token} className="flex flex-wrap items-baseline gap-2 text-[12.5px] text-spark-muted border-b border-spark-border pb-1.5">
                <span className={r.status === 'approved' ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                  {r.status === 'approved' ? '승인' : '거절'}
                </span>
                <span className="text-spark-ink-soft">{r.companyName}</span>
                <span>{r.email}</span>
                {r.decidedBy && <span className="ml-auto">{r.decidedBy}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
