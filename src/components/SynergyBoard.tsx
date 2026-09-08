'use client';
import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/client';

/** SynergyPair를 화면용으로 추린 형태 — 서버에서 내려준다. */
export type SynergyRow = {
  id: string;
  krName: string;
  krDesc: string;
  krStatus: string | null;   // portfolioStatus (Live/Exit …) — Exit 배지용
  twName: string;
  twDesc: string;
  twStatus: string | null;
  sector: string | null;
  similarity: number;
  relation: 'same' | 'complement' | 'chain';
  rationale: string | null;
  collabFormat: string | null;
  feedback: string | null;
};

const REL = {
  same: { label: '같은 업종', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', hint: '같은 사업을 다른 시장에서 — 행사 패널·세션' },
  complement: { label: '보완', cls: 'bg-amber-50 text-amber-800 border-amber-200', hint: '한쪽이 없는 걸 다른 쪽이 가짐 — 공동 부스·파일럿' },
  chain: { label: '밸류체인', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', hint: '한쪽 산출물이 다른 쪽 입력 — 실제 사업 제휴' },
} as const;

export function SynergyBoard({ rows, hasExitRows }: { rows: SynergyRow[]; hasExitRows: boolean }) {
  const tr = useT();
  const [rel, setRel] = useState<'all' | keyof typeof REL>('all');
  const [sector, setSector] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [basket, setBasket] = useState<string[]>([]);

  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.sector ?? '미분류';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const shown = useMemo(
    () => rows.filter(r => (rel === 'all' || r.relation === rel) && (sector === 'all' || (r.sector ?? '미분류') === sector)),
    [rows, rel, sector],
  );

  // 섹터별로 묶어서 보여준다 — 행사 기획은 "주제" 단위로 생각하기 때문.
  const bands = useMemo(() => {
    const m = new Map<string, SynergyRow[]>();
    for (const r of shown) {
      const k = r.sector ?? '미분류';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()]
      .map(([s, list]) => [s, list.sort((a, b) => b.similarity - a.similarity)] as const)
      .sort((a, b) => b[1].length - a[1].length);
  }, [shown]);

  const relCount = (k: keyof typeof REL) => rows.filter(r => r.relation === k).length;

  const basketNames = useMemo(() => {
    const kr = new Set<string>(); const tw = new Set<string>();
    for (const id of basket) {
      const r = rows.find(x => x.id === id);
      if (r) { kr.add(r.krName); tw.add(r.twName); }
    }
    return { kr: [...kr], tw: [...tw] };
  }, [basket, rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-spark-border bg-spark-subtle px-6 py-14 text-center">
        <div className="text-sm font-bold text-spark-ink-soft">{tr('아직 계산된 시너지 조합이 없습니다.')}</div>
        <div className="mt-1.5 text-xs text-spark-muted">
          {tr('섹터 태깅 → 임베딩 → 후보 생성 배치가 돌면 여기에 표시됩니다.')}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 관계 유형 필터 — 같은 업종만 보면 사업적으로 값진 보완 관계를 놓친다 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-spark-muted">{tr('관계')}</span>
        <FilterChip active={rel === 'all'} onClick={() => { setRel('all'); setOpen(null); }}>
          {tr('전체')} <span className="tabular-nums opacity-70">{rows.length}</span>
        </FilterChip>
        {(Object.keys(REL) as (keyof typeof REL)[]).map(k => (
          <FilterChip key={k} active={rel === k} onClick={() => { setRel(k); setOpen(null); }} title={tr(REL[k].hint)}>
            {tr(REL[k].label)} <span className="tabular-nums opacity-70">{relCount(k)}</span>
          </FilterChip>
        ))}
      </div>

      {/* 섹터(주제) 필터 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-spark-muted">{tr('주제')}</span>
        <FilterChip active={sector === 'all'} onClick={() => { setSector('all'); setOpen(null); }}>{tr('전체')}</FilterChip>
        {sectors.map(([s, n]) => (
          <FilterChip key={s} active={sector === s} onClick={() => { setSector(s); setOpen(null); }}>
            {tr(s)} <span className="tabular-nums opacity-70">{n}</span>
          </FilterChip>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-spark-border bg-spark-subtle px-5 py-10 text-center text-sm text-spark-muted">
          {tr('이 조건에 맞는 조합이 없습니다.')}
        </div>
      ) : (
        bands.map(([s, list]) => (
          <div key={s} className="mb-3 overflow-hidden rounded-2xl border border-spark-border bg-white">
            <div className="flex items-center gap-2 border-b border-spark-border bg-spark-subtle px-4 py-2.5">
              <span className="text-[12.5px] font-extrabold">{tr(s)}</span>
              <span className="ml-auto font-mono text-[10.5px] font-bold text-spark-muted">
                {tr('{n}개 조합', { n: list.length })}
              </span>
            </div>
            {list.map(r => (
              <PairRow
                key={r.id} r={r}
                open={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                inBasket={basket.includes(r.id)}
                onBasket={() => setBasket(b => b.includes(r.id) ? b.filter(x => x !== r.id) : [...b, r.id])}
              />
            ))}
          </div>
        ))
      )}

      {basket.length > 0 && (
        <div className="mt-4 rounded-2xl border border-spark-purple bg-spark-light-purple/40 p-4">
          <div className="mb-2 text-[13.5px] font-extrabold">
            🧺 {tr('초대 리스트')} <span className="tabular-nums">({tr('{n}조합', { n: basket.length })})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {basketNames.kr.map(n => (
              <span key={`kr-${n}`} className="rounded-full border border-rose-300 bg-white px-2.5 py-0.5 text-[11px] font-bold text-rose-700">🇰🇷 {n}</span>
            ))}
            {basketNames.tw.map(n => (
              <span key={`tw-${n}`} className="rounded-full border border-emerald-300 bg-white px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">🇹🇼 {n}</span>
            ))}
          </div>
          <button
            onClick={() => downloadCsv(basket.map(id => rows.find(r => r.id === id)!).filter(Boolean))}
            className="mt-3 rounded-lg border border-spark-purple bg-white px-3 py-1.5 text-[12px] font-bold text-spark-purple hover:bg-spark-light-purple"
          >
            {tr('CSV로 내보내기')}
          </button>
        </div>
      )}

      {hasExitRows && (
        <p className="mt-4 text-[11px] text-spark-muted">
          {tr('Exit·중단 회사는 기본으로 제외됩니다. 위의 «Exit 포함»을 켜면 함께 봅니다 — Exit사는 연사·멘토로 부르기 좋습니다.')}
        </p>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick} aria-pressed={active} title={title}
      className={`rounded-full border px-3 py-1 text-[12px] font-bold transition-colors whitespace-nowrap ${
        active ? 'border-spark-ink bg-spark-ink text-spark-cream' : 'border-spark-border bg-spark-subtle text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple'
      }`}
    >
      {children}
    </button>
  );
}

function PairRow({ r, open, onToggle, inBasket, onBasket }: {
  r: SynergyRow; open: boolean; onToggle: () => void; inBasket: boolean; onBasket: () => void;
}) {
  const tr = useT();
  const rel = REL[r.relation];
  return (
    <div className={`border-t border-spark-border first:border-t-0 ${open ? 'bg-spark-light-purple/30' : ''}`}>
      <button onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-1 items-center gap-2 px-3 py-2.5 text-left hover:bg-spark-subtle sm:grid-cols-[1fr_auto_1fr]">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 text-[11px]">🇰🇷</span>
            <span className="truncate text-[13px] font-extrabold text-rose-700">{r.krName}</span>
            {r.krStatus && r.krStatus !== 'Live' && (
              <span className="shrink-0 rounded bg-spark-cream px-1 text-[9.5px] font-bold text-spark-muted">{r.krStatus}</span>
            )}
          </div>
          <div className="line-clamp-2 text-[11px] text-spark-muted">{r.krDesc}</div>
        </div>
        <div className="flex shrink-0 flex-row items-center gap-1.5 sm:flex-col">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${rel.cls}`}>{tr(rel.label)}</span>
          <span className="font-mono text-[10px] font-bold tabular-nums text-spark-muted">{r.similarity.toFixed(2)}</span>
        </div>
        <div className="min-w-0 sm:text-right">
          <div className="flex items-baseline gap-1.5 sm:justify-end">
            <span className="truncate text-[13px] font-extrabold text-emerald-700">{r.twName}</span>
            <span className="shrink-0 text-[11px]">🇹🇼</span>
          </div>
          <div className="line-clamp-2 text-[11px] text-spark-muted">{r.twDesc}</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-spark-border/60 bg-white/60 px-4 py-3">
          {r.rationale && (
            <p className="mb-1.5 text-[12.5px] leading-relaxed">
              <b className="font-extrabold">{tr('왜 이 둘인가')}</b> — {r.rationale}
            </p>
          )}
          {r.collabFormat && (
            <p className="mb-2 text-[12.5px] leading-relaxed">
              <b className="font-extrabold">{tr('협업 형식')}</b> — {r.collabFormat}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onBasket}
              className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
                inBasket ? 'border-spark-purple bg-spark-purple text-white' : 'border-spark-border bg-white text-spark-ink-soft hover:border-spark-purple hover:text-spark-purple'
              }`}
            >
              {inBasket ? tr('✓ 초대 리스트에 담김') : tr('+ 초대 리스트에 담기')}
            </button>
            <FeedbackButtons pairId={r.id} initial={r.feedback} />
          </div>
          <p className="mt-2 text-[10.5px] text-spark-muted">
            {tr('이 문장은 배치가 미리 계산해 저장한 값입니다 — 화면을 열 때 AI를 호출하지 않습니다.')}
          </p>
        </div>
      )}
    </div>
  );
}

function FeedbackButtons({ pairId, initial }: { pairId: string; initial: string | null }) {
  const tr = useT();
  const [state, setState] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);

  async function send(v: 'up' | 'down') {
    setBusy(true);
    const next = state === v ? null : v;
    try {
      const res = await fetch('/api/synergy/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairId, feedback: next }),
      });
      if (res.ok) setState(next);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button disabled={busy} onClick={() => send('up')}
        className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-bold disabled:opacity-50 ${
          state === 'up' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-spark-border bg-white text-spark-ink-soft hover:border-emerald-400'
        }`}>
        👍 {tr('좋은 추천')}
      </button>
      <button disabled={busy} onClick={() => send('down')}
        className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-bold disabled:opacity-50 ${
          state === 'down' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-spark-border bg-white text-spark-ink-soft hover:border-rose-400'
        }`}>
        👎 {tr('관계 없음')}
      </button>
    </>
  );
}

function downloadCsv(rows: SynergyRow[]) {
  const head = ['섹터', '관계', '유사도', '한국 회사', '한국 사업', '대만 회사', '대만 사업', '협업 형식', '근거'];
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map(r => [
    r.sector ?? '', REL[r.relation].label, r.similarity.toFixed(2),
    r.krName, r.krDesc, r.twName, r.twDesc, r.collabFormat ?? '', r.rationale ?? '',
  ].map(esc).join(','));
  // BOM — 엑셀이 UTF-8 한글을 깨뜨리지 않게 한다.
  const blob = new Blob(['﻿' + [head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `시너지_초대리스트_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
