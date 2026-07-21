'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 프리셋 시작일 계산 — 서버의 기본 기간(3개월 전)과 같은 '월 단위' 기준으로 맞춰야
// 첫 화면에서 '3개월'이 선택된 상태로 정확히 하이라이트된다.
const PRESETS = [
  { label: '7일', shift: (d: Date) => d.setDate(d.getDate() - 7) },
  { label: '1개월', shift: (d: Date) => d.setMonth(d.getMonth() - 1) },
  { label: '3개월', shift: (d: Date) => d.setMonth(d.getMonth() - 3) },
  { label: '1년', shift: (d: Date) => d.setFullYear(d.getFullYear() - 1) },
];

export function DateRangePicker({ from, to, min, max, company, tab }: { from: string; to: string; min: string; max: string; company?: string; tab?: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  // 프리셋(7일·1개월·3개월·1년)이나 조회로 기간이 바뀌면 입력칸도 실제 날짜로 갱신.
  useEffect(() => { setF(from); setT(to); }, [from, to]);

  const go = (nf: string, nt: string) => {
    const params = new URLSearchParams({ from: nf, to: nt });
    if (company) params.set('company', company); // 회사 필터가 걸려 있으면 기간을 바꿔도 유지
    if (tab) params.set('tab', tab); // 보고 있던 탭 유지
    router.push(`/dashboard?${params.toString()}`, { scroll: false }); // 현재 스크롤 위치 유지 (맨 위로 안 올라감)
  };

  // 프리셋 기준일은 서버가 내려준 max(=오늘, KST)를 쓴다. 브라우저 시간대와 어긋나 하이라이트가 빗나가는 걸 방지.
  const presetFrom = (shift: (d: Date) => void) => {
    const d = new Date(`${max}T00:00:00`);
    shift(d);
    return fmt(d);
  };

  const inputCls = 'rounded-lg border border-spark-border px-2 py-1 text-sm focus:border-spark-purple focus:outline-none';

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2">
      {/* 모바일: 세로 스택, 타블릿 이상: 가로 배치 */}
      <div className="flex w-full sm:w-auto items-center gap-1 sm:gap-2">
        <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">조회 기간</span>
        <input
          type="date" value={f} min={min} max={max}
          onChange={e => { setF(e.target.value); go(e.target.value, t); }}
          className={`${inputCls} flex-1 sm:flex-none text-xs sm:text-sm`}
        />
        <span className="text-gray-400">~</span>
        <input
          type="date" value={t} min={min} max={max}
          onChange={e => { setT(e.target.value); go(f, e.target.value); }}
          className={`${inputCls} flex-1 sm:flex-none text-xs sm:text-sm`}
        />
      </div>

      {/* 프리셋 버튼: 현재 조회 중인 기간과 일치하는 버튼만 보라색으로 하이라이트 */}
      <div className="flex gap-1 flex-wrap">
        {PRESETS.map(p => {
          const start = presetFrom(p.shift);
          const active = to === max && from === start;
          return (
            <button
              key={p.label}
              onClick={() => go(start, max)}
              aria-pressed={active}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-colors ${
                active
                  ? 'bg-spark-purple border-spark-purple text-white'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-spark-purple/40'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
