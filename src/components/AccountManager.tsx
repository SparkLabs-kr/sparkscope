'use client';
import { useT } from '@/lib/i18n/client';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Company {
  id: string;
  name: string;
  englishName: string | null;
  category: string;
}

interface Account {
  id: string;
  email: string;
  active: boolean;
  companyId: string | null;
  company: { id: string; name: string; category: string } | null;
  invitedBy: string | null;
  invitedAt: string | null;
  deactivatedAt: string | null;
  lastLoginAt: string | null;
}

// 분류명에 붙은 국가 접미사(_tw 등)를 라벨로 — 국가를 별도 필드로 빼는 작업(2.3)이
// 끝나면 여기도 그 필드를 읽게 바꾼다.
const COUNTRY_LABEL: Record<string, string> = {
  portfolio_company: '한국',
  portfolio_company_tw: '대만',
};

function fmt(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}

export function AccountManager() {
  const tr = useT();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // 계정을 발급한 직후 담당자에게 보내줄 로그인 주소. 발급 메일을 따로 보내지는 않으므로
  // 관리자가 이 주소를 전달한다.
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [email, setEmail] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!notice) return;
    // 안내를 지울 때 공유 주소도 함께 지운다 — 안 그러면 다음에 다른 안내가 떴을 때
    // 그 아래에 관계없는 주소가 그대로 남는다.
    const t = setTimeout(() => {
      setNotice(null);
      setShareUrl(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/accounts');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'failed');
      setAccounts(json.accounts ?? []);
      setCompanies(json.companies ?? []);
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? tr('목록을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !companyId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), companyId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? tr('발급에 실패했습니다.'));
      setNotice(
        json.revived
          ? tr('{email} 계정을 다시 활성화했습니다.', { email: email.trim() })
          : tr('{email} 계정을 발급했습니다. 아래 주소를 담당자에게 전달하세요.', { email: email.trim() }),
      );
      setShareUrl(`${window.location.origin}/login/portfolio`);
      setEmail('');
      setCompanyId('');
      await load();
    } catch (e: any) {
      setErr(e?.message ?? tr('발급에 실패했습니다.'));
    } finally {
      setSubmitting(false);
    }
  };

  const setActive = async (a: Account, active: boolean) => {
    if (!active && !confirm(tr('{email} 계정을 비활성화합니다. 열려 있는 세션도 함께 끊깁니다.', { email: a.email }))) return;
    setBusyId(a.id);
    try {
      const res = await fetch('/api/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? tr('변경에 실패했습니다.'));
      setShareUrl(null);
      setNotice(active ? tr('다시 활성화했습니다.') : tr('비활성화했습니다.'));
      await load();
    } catch (e: any) {
      setErr(e?.message ?? tr('변경에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  };

  const changeCompany = async (a: Account, newCompanyId: string) => {
    if (!newCompanyId || newCompanyId === a.companyId) return;
    setBusyId(a.id);
    try {
      const res = await fetch('/api/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, companyId: newCompanyId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? tr('변경에 실패했습니다.'));
      setShareUrl(null);
      setNotice(tr('소속 회사를 변경했습니다.'));
      await load();
    } catch (e: any) {
      setErr(e?.message ?? tr('변경에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      a => a.email.toLowerCase().includes(q) || (a.company?.name ?? '').toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const activeCount = accounts.filter(a => a.active).length;

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div>{notice}</div>
          {shareUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded border border-emerald-200 bg-white px-2 py-1 text-[12px] text-emerald-900">{shareUrl}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl).then(
                    () => setNotice(tr('로그인 주소를 복사했습니다.')),
                    () => {},
                  );
                }}
                className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-50"
              >
                {tr('주소 복사')}
              </button>
            </div>
          )}
        </div>
      )}
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}

      {/* 계정 발급 */}
      <form onSubmit={issue} className="rounded-xl border border-spark-border bg-white p-5">
        <h2 className="text-sm font-bold text-spark-ink mb-1">{tr('포트폴리오사 계정 발급')}</h2>
        <p className="text-xs text-spark-muted mb-4">
          {tr('비밀번호는 쓰지 않습니다. 여기서 발급해두면 그 메일로 로그인 링크를 요청할 수 있게 됩니다. 발급하지 않은 외부 메일은 링크를 받아도 들어올 수 없습니다.')}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="flex-1 min-w-[220px] rounded-lg border border-spark-border px-3 py-2 text-sm focus:outline-none focus:border-spark-purple"
          />
          <select
            required
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            className="min-w-[220px] rounded-lg border border-spark-border px-3 py-2 text-sm bg-white focus:outline-none focus:border-spark-purple"
          >
            <option value="">{tr('소속 회사 선택')}</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
                {COUNTRY_LABEL[c.category] ? ` · ${COUNTRY_LABEL[c.category]}` : ''}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-spark-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? tr('발급 중...') : tr('계정 발급')}
          </button>
        </div>
      </form>

      {/* 발급된 계정 */}
      <div className="rounded-xl border border-spark-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-bold text-spark-ink">
            {tr('발급된 계정')}{' '}
            <span className="text-spark-muted font-medium">
              {tr('활성 {active} / 전체 {total}', { active: String(activeCount), total: String(accounts.length) })}
            </span>
          </h2>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tr('메일·회사 검색')}
            className="rounded-lg border border-spark-border px-3 py-1.5 text-sm focus:outline-none focus:border-spark-purple"
          />
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-spark-muted">···</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-spark-muted">
            {accounts.length === 0 ? tr('아직 발급된 포트폴리오사 계정이 없습니다.') : tr('검색 결과가 없습니다.')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-spark-muted">
                  <th className="pb-2 pr-3 font-bold">{tr('메일')}</th>
                  <th className="pb-2 pr-3 font-bold">{tr('소속 회사')}</th>
                  <th className="pb-2 pr-3 font-bold">{tr('상태')}</th>
                  <th className="pb-2 pr-3 font-bold">{tr('발급')}</th>
                  <th className="pb-2 pr-3 font-bold">{tr('마지막 로그인')}</th>
                  <th className="pb-2 font-bold text-right">{tr('관리')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} className="border-t border-spark-border/60">
                    <td className="py-2.5 pr-3 font-medium text-spark-ink">{a.email}</td>
                    <td className="py-2.5 pr-3">
                      <select
                        value={a.companyId ?? ''}
                        disabled={busyId === a.id}
                        onChange={e => void changeCompany(a, e.target.value)}
                        className="rounded-md border border-spark-border bg-white px-2 py-1 text-[13px] disabled:opacity-50"
                      >
                        {!a.companyId && <option value="">{tr('미연결')}</option>}
                        {companies.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 pr-3">
                      {a.active ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{tr('활성')}</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">{tr('비활성')}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] text-spark-muted tabular-nums">
                      {fmt(a.invitedAt)}
                      {a.invitedBy && <div className="text-[11px]">{a.invitedBy}</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] text-spark-muted tabular-nums">{fmt(a.lastLoginAt)}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => void setActive(a, !a.active)}
                        disabled={busyId === a.id}
                        className="rounded-lg border border-spark-border px-2.5 py-1 text-[12px] font-semibold text-spark-ink-soft hover:bg-gray-50 disabled:opacity-50"
                      >
                        {a.active ? tr('비활성화') : tr('다시 활성화')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
