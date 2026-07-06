'use client';
// 포트폴리오사 선택 필터 — 고르면 해당 회사의 선택 기간 기사 전체를 보여준다.
// 기간(from/to)은 유지하고 company만 URL에 추가/제거한다.
import { useRouter } from 'next/navigation';

export function PortfolioFilter({ companies, selected, from, to }: {
  companies: { value: string; label: string }[];
  selected?: string;
  from: string;
  to: string;
}) {
  const router = useRouter();

  const go = (v: string) => {
    const params = new URLSearchParams({ from, to });
    if (v) params.set('company', v);
    router.push(`/dashboard?${params.toString()}`, { scroll: false }); // 현재 스크롤 위치 유지
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">🏢 포트폴리오사</label>
      <select
        value={selected ?? ''}
        onChange={e => go(e.target.value)}
        className="rounded-lg border border-spark-border px-2 py-1.5 text-sm max-w-[220px] focus:border-spark-purple focus:outline-none"
      >
        <option value="">전체 보기</option>
        {companies.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      {selected && (
        <button
          onClick={() => go('')}
          className="text-xs text-gray-400 hover:text-gray-700 whitespace-nowrap"
          aria-label="필터 해제"
        >
          ✕ 해제
        </button>
      )}
    </div>
  );
}
