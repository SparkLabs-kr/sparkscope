'use client';
import { useT } from '@/lib/i18n/client';

// 포트폴리오사 화면 미리보기 — 회사를 고르면 그 회사 계정으로 로그인한 화면으로 바뀐다.
// 실제 전환은 /api/preview-as 가 쿠키로 한다(이 컴포넌트는 고르기만 한다).
export function PreviewAsPicker({ companies, selected, label }: {
  companies: { id: string; label: string }[];
  selected?: string;
  label: string;
}) {
  const t = useT();
  return (
    <select
      id="preview-as-picker"
      aria-label={label}
      value={selected ?? ''}
      onChange={e => {
        if (!e.target.value) return;
        const next = window.location.pathname.startsWith('/dashboard/company') ? '/dashboard/company' : '/dashboard?tab=portfolio';
        window.location.href = `/api/preview-as?company=${encodeURIComponent(e.target.value)}&next=${encodeURIComponent(next)}`;
      }}
      className="max-w-[220px] rounded-md border border-spark-border bg-white px-2 py-1 text-[12px] font-semibold text-spark-ink-soft focus:border-spark-purple focus:outline-none"
    >
      <option value="" disabled>{label}</option>
      {companies.map(c => <option key={c.id} value={c.id}>{t(c.label)}</option>)}
    </select>
  );
}
