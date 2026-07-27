'use client';
// 매체별 노출 분포 — 막대 옆에 그 매체가 우리 기사를 어떤 톤으로 써왔는지 한 줄로 보여준다.
// (같은 사건이어도 매체마다 긍정/중립/부정 판정이 갈리는 경우가 많아, 숫자로 바로 확인 가능하게 함)
import { useState } from 'react';

interface SourceTones { POSITIVE: number; NEUTRAL: number; NEGATIVE: number }
interface SourceRow { source: string; count: number; tones?: SourceTones }

// 긍정은 초록, 중립은 (기본 회색보다) 살짝 짙은 회색으로 구분. 부정은 기존 톤 유지.
function ToneLine({ tones }: { tones?: SourceTones }) {
  if (!tones) return null;
  const parts: { text: string; cls: string }[] = [];
  if (tones.POSITIVE) parts.push({ text: `긍정 ${tones.POSITIVE}`, cls: 'text-emerald-600' });
  if (tones.NEUTRAL) parts.push({ text: `중립 ${tones.NEUTRAL}`, cls: 'text-gray-500' });
  if (tones.NEGATIVE) parts.push({ text: `부정 ${tones.NEGATIVE}`, cls: 'text-spark-muted' });
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return <span className="shrink-0 text-[11px] whitespace-nowrap"><span className="text-spark-muted">전부 </span><span className={parts[0].cls}>{parts[0].text}</span></span>;
  }
  return (
    <span className="shrink-0 text-[11px] whitespace-nowrap">
      {parts.map((p, i) => (
        <span key={p.text}>
          {i > 0 && <span className="text-spark-muted"> · </span>}
          <span className={p.cls}>{p.text}</span>
        </span>
      ))}
    </span>
  );
}

export function MediaPanel({ data, defaultCount = 5 }: { data: SourceRow[]; defaultCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? data : data.slice(0, defaultCount);
  const max = Math.max(...data.map(d => d.count), 1);

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">선택 기간 내 매체 노출 데이터가 없습니다.</p>;
  }

  // 긍정 기사를 가장 많이 쓴 매체(동률이면 모두) — 이름을 볼드로 강조.
  const maxPositive = Math.max(...data.map(d => d.tones?.POSITIVE ?? 0));

  return (
    <div>
      <div className="space-y-1">
        {shown.map(d => {
          const isTopPositive = maxPositive > 0 && (d.tones?.POSITIVE ?? 0) === maxPositive;
          return (
            <div key={d.source} className="flex items-center gap-2">
              <span className={`w-24 shrink-0 text-xs text-right truncate ${isTopPositive ? 'font-bold text-spark-ink' : 'text-spark-ink-soft'}`} title={d.source}>{d.source}</span>
              <span className="flex-1 h-2.5 rounded bg-spark-subtle overflow-hidden">
                <span className="block h-full rounded bg-spark-purple/80" style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }} />
              </span>
              <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-spark-ink text-right">{d.count}</span>
              <ToneLine tones={d.tones} />
            </div>
          );
        })}
      </div>
      {data.length > defaultCount && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-2 w-full rounded-lg border border-gray-200 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-50"
        >
          {expanded ? '접기' : `더보기 (전체 ${data.length}개 매체)`}
        </button>
      )}
    </div>
  );
}
