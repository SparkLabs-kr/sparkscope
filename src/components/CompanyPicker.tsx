'use client';
import { useT } from '@/lib/i18n/client';

// 회사별 기사 모아보기의 회사 선택 — 고르는 즉시 그 회사 화면으로 간다.
import { useRouter } from 'next/navigation';

export function CompanyPicker({ companies, selected, baseQuery }: {
  companies: { id: string; label: string }[];
  selected: string;
  baseQuery: Record<string, string>;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <label className="flex items-center gap-2">
      <span className="text-[13px] font-semibold text-spark-ink-soft whitespace-nowrap">🏢 {t('회사')}</span>
      <select
        id="company-picker"
        value={selected}
        onChange={e => {
          const p = new URLSearchParams({ ...baseQuery, company: e.target.value });
          router.push(`/dashboard/company?${p.toString()}`);
        }}
        className="min-w-[220px] rounded-lg border border-spark-border bg-spark-subtle px-3 py-1.5 text-sm focus:border-spark-purple focus:outline-none"
      >
        <option value="" disabled>{t('회사를 고르세요')}</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </label>
  );
}
