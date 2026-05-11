'use client';
import { Line } from 'react-chartjs-2';
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const COLORS = ['#5046E5', '#16A34A', '#F59E0B', '#94A3B8', '#DC2626', '#7C3AED'];

export function TrendChart({ labels, datasets }: { labels: string[]; datasets: { label: string; data: number[] }[] }) {
  return (
    <div className="h-72">
      <Line
        data={{
          labels,
          datasets: datasets.map((ds, i) => ({
            ...ds,
            borderColor: COLORS[i % COLORS.length],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 2,
          })),
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 8, boxHeight: 8, padding: 10 } } },
          scales: {
            y: { beginAtZero: true, ticks: { font: { size: 11 }, stepSize: 1 } },
            x: { ticks: { font: { size: 10 }, maxTicksLimit: 10 } },
          },
        }}
      />
    </div>
  );
}
