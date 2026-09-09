'use client';
/**
 * 포트폴리오사 계정 목록 + 접근 해제·복구.
 *
 * 해제는 되돌릴 수 있게 둔다(계정을 지우지 않고 active 만 내린다). 다만
 * 실수로 누르기 쉬운 자리라 한 번 더 묻는다 — 누르는 순간 그 회사는
 * 열려 있던 창에서도 바로 튕긴다.
 */
import { useState } from 'react';
import type { CompanyAccount } from '@/lib/sparkscope/company-accounts';
import { useT } from '@/lib/i18n/client';

function when(iso: string | null) {
  return iso ? iso.slice(0, 10) : '—';
}

export function CompanyAccountList({ accounts }: { accounts: CompanyAccount[] }) {
  const t = useT();
  const [rows, setRows] = useState(accounts);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (userId: string, action: 'deactivate' | 'reactivate') => {
    setBusy(userId); setErr(null); setConfirming(null);
    try {
      const res = await fetch('/api/company-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(
          data?.error === 'is_staff'
            ? t('사내 계정은 이 화면에서 바꿀 수 없습니다.')
            : data?.error === 'not_approver'
              ? t('접근 해제 권한이 없습니다.')
              : t('처리하지 못했습니다.'),
        );
        return;
      }
      setRows(rs =>
        rs.map(r =>
          r.id === userId
            ? {
                ...r,
                active: action === 'reactivate',
                sessions: action === 'deactivate' ? 0 : r.sessions,
                deactivatedAt: action === 'deactivate' ? new Date().toISOString() : null,
              }
            : r,
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const active = rows.filter(r => r.active);
  const off = rows.filter(r => !r.active);

  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-bold mb-1">{t('포트폴리오사 계정')}</h2>
      <p className="text-[12.5px] text-spark-muted mb-4">
        {t('접근을 해제하면 즉시 로그아웃되고 새 로그인 링크도 받을 수 없습니다. 다시 열어줄 수 있습니다.')}
      </p>

      {err && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div>
      )}

      {active.length === 0 ? (
        <p className="text-[13px] text-spark-muted border border-spark-border rounded-xl px-4 py-6 text-center">
          {t('활성 포트폴리오사 계정이 없습니다.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map(a => (
            <li key={a.id} className="border border-spark-border rounded-xl px-4 py-3 bg-white">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-bold rounded bg-spark-light-purple text-spark-purple px-1.5 py-0.5 text-[12px]">
                  {a.companyName ?? t('회사 없음')}
                </span>
                <span className="font-semibold text-[14px]">{a.name ?? a.email}</span>
                <span className="text-[12.5px] text-spark-muted">{a.email}</span>
                <span className="ml-auto text-[11.5px] text-spark-muted tabular-nums">
                  {t('승인')} {when(a.invitedAt)}
                  {a.sessions > 0 && ` · ${t('로그인 중')}`}
                </span>
              </div>
              <div className="mt-2.5">
                {confirming === a.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-rose-800">
                      {t('이 계정의 접근을 해제할까요? 지금 열려 있는 창에서도 바로 로그아웃됩니다.')}
                    </span>
                    <button
                      type="button" disabled={busy === a.id}
                      onClick={() => act(a.id, 'deactivate')}
                      className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[12.5px] font-semibold disabled:opacity-50"
                    >
                      {busy === a.id ? t('처리 중...') : t('해제')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="px-3 py-1 rounded-lg border border-spark-border text-[12.5px] text-spark-muted"
                    >
                      {t('취소')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(a.id)}
                    className="px-3 py-1 rounded-lg border border-spark-border text-[12.5px] font-semibold text-spark-muted hover:border-rose-300 hover:text-rose-700 transition"
                  >
                    {t('접근 해제')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {off.length > 0 && (
        <>
          <h3 className="text-[13px] font-bold text-spark-muted mt-7 mb-2">{t('해제된 계정')}</h3>
          <ul className="space-y-1.5">
            {off.map(a => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-[12.5px] text-spark-muted border-b border-spark-border pb-2">
                <span className="text-spark-ink-soft">{a.companyName ?? '—'}</span>
                <span>{a.email}</span>
                <span className="tabular-nums">{t('해제')} {when(a.deactivatedAt)}</span>
                <button
                  type="button" disabled={busy === a.id}
                  onClick={() => act(a.id, 'reactivate')}
                  className="ml-auto px-2.5 py-0.5 rounded-md border border-spark-border font-semibold text-spark-purple hover:bg-spark-light-purple disabled:opacity-50"
                >
                  {busy === a.id ? t('처리 중...') : t('다시 열기')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
