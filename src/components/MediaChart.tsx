'use client';
import { Bar } from 'react-chartjs-2';
import { Chart, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, Tooltip);

export function MediaChart({ data }: { data: { source: string; count: number }[] }) {
  return (
    <div className="h-72">
      <Bar
        data={{
          labels: data.map(d => d.source),
          datasets: [{ label: '노출 건수', data: data.map(d => d.count), backgroundColor: '#5046E5', borderRadius: 4 }],
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
  );
}
