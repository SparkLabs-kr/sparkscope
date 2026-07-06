'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DateRangePicker({ from, to, min, max, company }: { from: string; to: string; min: string; max: string; company?: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  // 프리셋(7일·1개월·3개월·1년)이나 조회로 기간이 바뀌면 입력칸도 실제 날짜로 갱신.
  useEffect(() => { setF(from); setT(to); }, [from, to]);

  const go = (nf: string, nt: string) => {
    const params = new URLSearchParams({ from: nf, to: nt });
    if (company) params.set('company', company); // 회사 필터가 걸려 있으면 기간을 바꿔도 유지
    router.push(`/dashboard?${params.toString()}`, { scroll: false }); // 현재 스크롤 위치 유지 (맨 위로 안 올라감)
  };

  const preset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    go(fmt(start), fmt(end));
  };

  const inputCls = 'rounded-lg border border-spark-border px-2 py-1 text-sm focus:border-spark-purple focus:outline-none';
  const presetCls = 'rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={f} min={min} max={max} onChange={e => setF(e.target.value)} className={inputCls} />
      <span className="text-gray-400">~</span>
      <input type="date" value={t} min={min} max={max} onChange={e => setT(e.target.value)} className={inputCls} />
      <button onClick={() => go(f, t)} className="rounded-lg bg-spark-purple px-3 py-1 text-sm font-semibold text-white hover:opacity-90">조회</button>
      <div className="flex gap-1">
        <button onClick={() => preset(7)} className={presetCls}>7일</button>
        <button onClick={() => preset(30)} className={presetCls}>1개월</button>
        <button onClick={() => preset(90)} className={presetCls}>3개월</button>
        <button onClick={() => preset(365)} className={presetCls}>1년</button>
      </div>
    </div>
  );
}
