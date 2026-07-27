'use client';
// 매체별 노출 분포 — 막대 옆에 그 매체가 우리 기사를 어떤 톤으로 써왔는지 한 줄로 보여준다.
// (같은 사건이어도 매체마다 긍정/중립/부정 판정이 갈리는 경우가 많아, 숫자로 바로 확인 가능하게 함)
import { useState } from 'react';

interface SourceTones { POSITIVE: number; NEUTRAL: number; NEGATIVE: number }
interface SourceRow { source: string; count: number; tones?: SourceTones }

function toneLine(tones?: SourceTones): string {
  if (!tones) return '';
  const parts: string[] = [];
  if (tones.POSITIVE) parts.push(`긍정 ${tones.POSITIVE}`);
  if (tones.NEUTRAL) parts.push(`중립 ${tones.NEUTRAL}`);
  if (tones.NEGATIVE) parts.push(`부정 ${tones.NEGATIVE}`);
  if (parts.length === 0) return '';
  if (parts.length === 1) return `전부 ${parts[0]}`;
  return parts.join(' · ');
}

export function MediaPanel({ data, defaultCount = 12 }: { data: SourceRow[]; defaultCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? data : data.slice(0, defaultCount);
  const max = Math.max(...data.map(d => d.count), 1);

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">선택 기간 내 매체 노출 데이터가 없습니다.</p>;
  }

  return (
    <div>
      <div className="space-y-2">
        {shown.map(d => (
          <div key={d.source} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-spark-ink-soft text-right truncate" title={d.source}>{d.source}</span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <span className="h-4 rounded bg-spark-purple/80" style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }} />
                <span className="text-xs font-semibold tabular-nums text-spark-ink">{d.count}</span>
              </span>
              {toneLine(d.tones) && (
                <span className="block text-[11px] text-spark-muted mt-0.5 truncate">{toneLine(d.tones)}</span>
              )}
            </span>
          </div>
        ))}
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
