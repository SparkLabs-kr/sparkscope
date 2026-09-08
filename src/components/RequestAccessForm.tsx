'use client';
/**
 * 요청 폼. 회사는 반드시 목록에서 고른다(id를 그대로 보낸다).
 *
 * 보내고 나면 무엇을 기다리는지 분명히 적는다 — "승인되면 로그인 링크를 받을 수 있다".
 * 여기서 계정이 생기는 게 아니라서, 바로 로그인해 보려다 실패하는 일을 막는다.
 */
import { useMemo, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';

type Company = { id: string; name: string; englishName: string | null };

export function RequestAccessForm({ companies }: { companies: Company[] }) {
  const t = useT();
  const locale = useLocale();
  /**
   * 화면에 쓸 회사명. EN 화면에 한국어 회사명이 그대로 나오면 대표가
   * 자기 회사를 못 찾는다(284/287곳에 englishName 이 있다).
   */
  const label = (c: Company) =>
    locale === 'en' ? (c.englishName?.trim() || c.name) : c.name;
  const [sent, setSent] = useState<null | 'ok' | 'staff' | 'has_account'>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ email: '', name: '', title: '', companyId: '', referrer: '' });

  // 411곳이라 그대로 렌더하면 고르기 어렵다 — 입력한 글자로 좁힌다.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return companies.slice(0, 50);
    // 한국어·영문 어느 쪽으로 쳐도 찾아진다 — '스카이랩스'와 'Sky Labs' 둘 다.
    return companies
      .filter(c =>
        c.name.toLowerCase().includes(needle) ||
        (c.englishName ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 50);
  }, [companies, q]);

  if (sent) {
    return (
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">{sent === 'ok' ? '📮' : '✅'}</div>
        <h1 className="text-2xl font-bold mb-3">
          {sent === 'ok' ? t('요청을 접수했습니다') : t('이미 로그인할 수 있습니다')}
        </h1>
        <p className="text-gray-600 leading-relaxed text-[14px]">
          {sent === 'ok'
            ? t('마케팅팀이 확인한 뒤 승인하면, 입력하신 주소로 안내 메일을 보내드립니다. 승인 전에는 로그인 링크를 받을 수 없습니다.')
            : t('로그인 화면에서 이 주소를 입력하면 링크를 받을 수 있습니다.')}
        </p>
        <a href="/login" className="inline-block mt-6 text-spark-purple font-semibold hover:underline">
          {t('로그인 화면으로')} →
        </a>
      </div>
    );
  }

  return (
    <form
      className="max-w-md w-full"
      onSubmit={async e => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
          const res = await fetch('/api/access-request', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(form),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(data?.error === 'unknown_company'
              ? t('회사를 목록에서 골라 주세요.')
              : t('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'));
            return;
          }
          setSent(data.staff || data.alreadyHasAccount ? 'staff' : 'ok');
        } catch {
          setError(t('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'));
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>
      <h1 className="text-2xl font-bold mb-2 text-center">{t('포트폴리오사 접근 요청')}</h1>
      <p className="text-sm text-gray-600 mb-6 text-center leading-relaxed">
        {t('스파크랩 포트폴리오사 대표·담당자용입니다. 마케팅팀 승인 후 로그인 링크를 받으실 수 있습니다.')}
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          {error}
        </div>
      )}

      <label className="block text-[13px] font-semibold mb-1">{t('회사')}</label>
      <input
        type="text"
        placeholder={t('회사명으로 검색')}
        value={q}
        onChange={e => setQ(e.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg mb-2 text-[14px] focus:outline-none focus:border-spark-purple"
      />
      <select
        required
        value={form.companyId}
        onChange={e => setForm({ ...form, companyId: e.target.value })}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg mb-4 text-[14px] bg-white focus:outline-none focus:border-spark-purple"
      >
        <option value="">{t('목록에서 선택')}</option>
        {filtered.map(c => (
          <option key={c.id} value={c.id}>{label(c)}</option>
        ))}
      </select>

      <label className="block text-[13px] font-semibold mb-1">{t('회사 메일 주소')}</label>
      <input
        type="email" required placeholder="name@company.com"
        value={form.email}
        onChange={e => setForm({ ...form, email: e.target.value })}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg mb-4 text-[14px] focus:outline-none focus:border-spark-purple"
      />

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-[13px] font-semibold mb-1">{t('이름')}</label>
          <input
            type="text" required value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-[14px] focus:outline-none focus:border-spark-purple"
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold mb-1">{t('직함')}</label>
          <input
            type="text" value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-[14px] focus:outline-none focus:border-spark-purple"
          />
        </div>
      </div>

      <label className="block text-[13px] font-semibold mb-1">{t('스파크랩 담당자 (선택)')}</label>
      <input
        type="text" value={form.referrer}
        onChange={e => setForm({ ...form, referrer: e.target.value })}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg mb-5 text-[14px] focus:outline-none focus:border-spark-purple"
      />

      <button
        type="submit" disabled={submitting}
        className="w-full py-3 bg-spark-purple text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? t('보내는 중...') : t('접근 요청 보내기')}
      </button>
    </form>
  );
}
