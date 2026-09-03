'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

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
  // '3년' 프리셋은 2026-08-07에 제거. 과거 기사 백필을 1년치까지만 하기로 정해서
  // 3년을 눌러도 앞 2년 구간은 거의 빈 화면이라 오히려 오해를 부른다.
];

// 색 계열 — Intra는 보라, Inter는 초록으로 계속 간다(2026-08-04 결정).
const ACCENT = {
  purple: {
    active: 'bg-spark-purple border-spark-purple text-white',
    idle: 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-spark-purple/40',
    focus: 'focus:border-spark-purple',
  },
  green: {
    active: 'bg-emerald-600 border-emerald-600 text-white',
    idle: 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-emerald-500/40',
    focus: 'focus:border-emerald-500',
  },
} as const;

// scope: Intra/Inter 스코프 유지용. Inter 탭에서도 이 컴포넌트를 그대로 써서
// 기간 선택 UI가 두 탭에서 완전히 동일하게 보이도록 한다(별도 구현 금지).
//
// onStage가 주어지면 "선택만 하고 조회는 나중에" 모드로 동작한다 — 클릭 즉시 URL을 바꾸지 않고
// 고른 기간만 위로 올려보낸다(Inter 탭은 기간·국가를 다 고른 뒤 '확인'을 눌러야 조회된다).
// 이때 하이라이트는 부모가 넘겨주는 from/to(=선택 중인 값) 기준으로 그려지므로 즉시 반응한다.
export function DateRangePicker({
  from, to, min, max, company, tab, scope, extraParams, accent = 'purple', onStage, hideLabel, trailing,
}: {
  from: string; to: string; min: string; max: string;
  company?: string; tab?: string; scope?: string; extraParams?: Record<string, string>;
  accent?: keyof typeof ACCENT;
  onStage?: (from: string, to: string) => void;
  /** 부모가 이미 "조회 기간" 라벨을 그리는 경우(Inter 조회 조건 카드) 중복 표시를 막는다. */
  hideLabel?: boolean;
  /** 프리셋 버튼 오른쪽에 덧붙일 것(예: 포트폴리오사 탭의 한국/대만 전환). */
  trailing?: React.ReactNode;
}) {
  const tr = useT();
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const cls = ACCENT[accent];

  // 프리셋(7일·1개월·3개월·1년)이나 조회로 기간이 바뀌면 입력칸도 실제 날짜로 갱신.
  useEffect(() => { setF(from); setT(to); }, [from, to]);

  const go = (nf: string, nt: string) => {
    // 선택만 올려보내는 모드 — 조회는 부모의 '확인' 버튼이 담당한다.
    if (onStage) {
      onStage(nf, nt);
      return;
    }
    const params = new URLSearchParams({ from: nf, to: nt });
    if (company) params.set('company', company); // 회사 필터가 걸려 있으면 기간을 바꿔도 유지
    if (tab) params.set('tab', tab); // 보고 있던 탭 유지
    if (scope) params.set('scope', scope); // Intra/Inter 스코프 유지
    if (extraParams) for (const [k, v] of Object.entries(extraParams)) params.set(k, v); // Inter의 domain/country 등
    router.push(`/dashboard?${params.toString()}`, { scroll: false }); // 현재 스크롤 위치 유지 (맨 위로 안 올라감)
  };

  // 프리셋 기준일은 서버가 내려준 max(=오늘, KST)를 쓴다. 브라우저 시간대와 어긋나 하이라이트가 빗나가는 걸 방지.
  // min(=서버가 clamp하는 최저 조회일)보다 이전으로 계산되면 서버도 min으로 clamp해서 내려주므로,
  // 여기서도 똑같이 min으로 clamp해야 "3년"처럼 min보다 오래된 프리셋의 하이라이트가 어긋나지 않는다.
  const presetFrom = (shift: (d: Date) => void) => {
    const d = new Date(`${max}T00:00:00`);
    shift(d);
    const computed = fmt(d);
    return computed < min ? min : computed;
  };

  const inputCls = `rounded-lg border border-spark-border px-2 py-1 text-sm ${cls.focus} focus:outline-none`;

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2">
      {/* 모바일: 세로 스택, 타블릿 이상: 가로 배치 */}
      <div className="flex w-full sm:w-auto items-center gap-1 sm:gap-2">
        {!hideLabel && <span className="text-[13px] font-semibold text-gray-500 whitespace-nowrap">{tr('조회 기간')}</span>}
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

      {/* 프리셋 버튼: 선택된 기간과 일치하는 버튼만 강조 (Intra 보라 / Inter 초록) */}
      <div className="flex gap-1 flex-wrap">
        {PRESETS.map(p => {
          const start = presetFrom(p.shift);
          const active = t === max && f === start;
          return (
            <button
              key={p.label}
              onClick={() => { setF(start); setT(max); go(start, max); }}
              aria-pressed={active}
              className={`rounded-lg px-3 py-1 text-[13px] font-semibold border transition-colors ${active ? cls.active : cls.idle}`}
            >
              {tr(p.label)}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}
