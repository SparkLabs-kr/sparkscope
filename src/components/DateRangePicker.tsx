'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DateRangePicker({ from, to, min, max }: { from: string; to: string; min: string; max: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const go = (nf: string, nt: string) => router.push(`/dashboard?from=${nf}&to=${nt}`);

  const preset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    go(fmt(start), fmt(end));
  };

  const inputCls = 'rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-spark-purple focus:outline-none';
  const presetCls = 'rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={f} min={min} max={max} onChange={e => setF(e.target.value)} className={inputCls} />
      <span className="text-gray-400">~</span>
      <input type="date" value={t} min={min} max={max} onChange={e => setT(e.target.value)} className={inputCls} />
      <button onClick={() => go(f, t)} className="rounded-lg bg-spark-purple px-3 py-1 text-sm font-semibold text-white hover:opacity-90">조회</button>
      <div className="flex gap-1">
        <button onClick={() => preset(7)} className={presetCls}>7일</button>
        <button onClick={() => preset(30)} className={presetCls}>30일</button>
        <button onClick={() => preset(90)} className={presetCls}>90일</button>
      </div>
    </div>
  );
}
