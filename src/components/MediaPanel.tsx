'use client';
import { useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, Tooltip);

export function MediaPanel({ data, defaultCount = 12 }: { data: { source: string; count: number }[]; defaultCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? data : data.slice(0, defaultCount);
  const height = Math.max(220, shown.length * 26);

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">선택 기간 내 매체 노출 데이터가 없습니다.</p>;
  }

  return (
    <div>
      <div style={{ height }}>
        <Bar
          data={{
            labels: shown.map(d => d.source),
            datasets: [{ label: '노출 건수', data: shown.map(d => d.count), backgroundColor: '#6d54c4', borderRadius: 4 }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y' as const,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, ticks: { font: { size: 11 } } },
              y: { ticks: { font: { size: 11 } } },
            },
          }}
        />
      </div>
      {data.length > defaultCount && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-3 w-full rounded-lg border border-gray-200 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50"
        >
          {expanded ? '접기' : `더보기 (전체 ${data.length}개 매체)`}
        </button>
      )}
    </div>
  );
}
