'use client';

// 대시보드 튜토리얼 — 상단 '튜토리얼 열기'를 누르면 패널을 하나씩 짚어가며 설명한다.
//
// 들어올 때마다 자동으로 뜨면 귀찮으니 버튼을 눌렀을 때만 시작한다(자동 실행 없음).
//
// 동작 방식: 각 패널에 심어둔 data-tour="<key>" 를 찾아 그 자리에 스포트라이트를 씌우고
// 바로 옆에 설명 말풍선을 띄운다. Intra는 섹션 탭(스파크랩/포트폴리오사/경쟁사/기사)에 따라
// 렌더되는 패널이 달라지므로, 지금 화면에 없는 단계는 자동으로 건너뛴다.
// (그래서 탭을 바꾸고 다시 열면 그 탭에 맞는 설명이 나온다)

import { Suspense, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';

export interface TourStep {
  /** 대상 요소의 data-tour 값 */
  key: string;
  title: string;
  /** **굵게** 표기 지원 */
  body: string;
}

// ── 스텝 정의 ────────────────────────────────────────────────────────────
// 화면에 실제로 있는 순서대로 나열한다(위 → 아래). 없는 건 알아서 건너뛴다.

const SCOPE_STEP: TourStep = {
  key: 'scope-switch',
  title: '먼저, 화면이 두 개예요',
  body: '**🏠 Intra**는 우리 이야기입니다 — 스파크랩·포트폴리오사·경쟁사가 국내 기사에 어떻게 나오는지 봅니다.\n**🔭 Inter**는 바깥 이야기 — 해외 AI·바이오 시장이 어디로 움직이는지 봅니다.\n\n지금 보시는 튜토리얼은 **현재 열려 있는 화면** 기준이에요.',
};

const HEADER_STEP: TourStep = {
  key: 'header-actions',
  title: '따로 모아두고 관리하기',
  body: '**⭐ 스크랩함** — 별표 친 기사를 한곳에 모아 봅니다.\n**⚙️ 키워드 관리** — 어떤 회사·인물을 감시할지 정합니다.\n**🔍 노이즈 제안** — 잘못 걸린 기사를 신고하면 여기 쌓입니다.',
};

export const INTRA_TOUR: TourStep[] = [
  SCOPE_STEP,
  {
    key: 'intra-tabs',
    title: '네 개의 섹션',
    body: '**🏢 스파크랩** — 우리 자사가 어디에, 어떤 논조로 실렸나\n**📊 포트폴리오사** — 투자사 노출량과 부정 이슈\n**🏁 업계 모니터링** — 다른 AC·VC는 뭘 하고 있나\n**📋 최근 수집 기사** — 수집된 기사 원문 목록\n\n탭을 바꾸면 아래 패널이 통째로 바뀝니다.',
  },
  {
    key: 'date-range',
    title: '언제부터 언제까지 볼지',
    body: '여기서 고른 기간이 **이 화면 모든 숫자의 기준**입니다.\n7일·1개월·3개월 버튼으로 빠르게, 날짜를 직접 찍어서 정밀하게 볼 수 있어요.',
  },
  {
    key: 'spike-banner',
    title: '이슈 급증 알림',
    body: '특정 포트폴리오사 기사가 최근 갑자기 늘면 여기에 배너로 뜹니다.\n위에서 고른 기간과 **상관없이 항상 "최근 3일"**을 봅니다 — 놓치면 안 되는 일이라서요.',
  },
  {
    key: 'kpi',
    title: '한눈에 보는 네 가지 숫자',
    body: '**총 수집 기사 · 스파크랩 직접 언급 · 포트폴리오사 노출 · 피칭 기회**\n\n각 카드 제목 옆 🔍에 마우스를 올리면 그 숫자를 정확히 어떻게 셌는지 나옵니다.',
  },
  {
    key: 'media-panel',
    title: '어느 매체가 우리를 써주나',
    body: '선택한 기간에 "스파크랩"을 다룬 매체 분포입니다.\n막대가 길수록 그 매체가 우리를 자주 다뤘다는 뜻이에요.',
  },
  {
    key: 'tone-panel',
    title: '우리 기사의 논조',
    body: '스파크랩 기사를 **긍정 · 중립 · 부정**으로 나눈 비율입니다.\n비율을 클릭하면 그 논조의 기사 목록이 바로 아래 펼쳐집니다.',
  },
  {
    key: 'fund-panel',
    title: '펀드 현황',
    body: '스파크랩이 운용 중인 펀드의 결성 규모·시기를 정리한 표입니다.\n경쟁사 비교에서 "우리 규모"의 기준선으로 쓰입니다.',
  },
  {
    key: 'crisis-panel',
    title: '실시간 위기 감지',
    body: '최근 3일간 부정 기사가 **2건 이상 몰린 포트폴리오사**를 자동으로 찾아냅니다.\n원인 문장은 AI가 실제 기사 제목을 읽고 요약한 것이고, 위기가 없으면 "정상"이라고 표시돼요.',
  },
  {
    key: 'pos-neg',
    title: '호재와 악재를 나란히',
    body: '왼쪽은 **좋은 소식**(투자 유치·수상·출시), 오른쪽은 **주의할 소식**입니다.\n둘을 나란히 둬서 이번 기간 분위기가 어느 쪽인지 바로 보이게 했습니다.',
  },
  {
    key: 'top15',
    title: '가장 많이 노출된 포트폴리오사',
    body: '기간 내 기사 수 상위 15개사입니다.\n회사 이름을 누르면 그 회사 최근 기사를 바로 볼 수 있고, 옆의 증감%는 **직전 같은 길이의 기간**과 비교한 값이에요.',
  },
  {
    key: 'pitch',
    title: '기획기사 피칭 기회',
    body: 'AI가 기사마다 "이 주제로 우리 포폴사를 엮어 기획기사를 제안하면 통할까"를 0~100점으로 매깁니다.\n**60점 이상**이 여기 뜨고, **75점 이상**은 위쪽 "피칭 기회" 숫자에 잡힙니다.',
  },
  {
    key: 'competitor-panel',
    title: '업계 모니터링',
    body: '주요 AC·VC 하우스별 노출량을 스파크랩과 나란히 비교합니다.\n카드를 열면 그 하우스의 최근 기사와 부정 이슈를 볼 수 있고, 맨 위 AI 총평이 전체 판을 한 줄로 정리해줍니다.',
  },
  {
    key: 'article-table',
    title: '수집된 기사 원문',
    body: '지금까지 본 숫자들의 **재료가 되는 기사 목록**입니다.\n검색·분류 필터·정렬로 좁혀 볼 수 있고, CSV로 내려받을 수도 있어요. 잘못 걸린 기사는 신고해서 다음 수집부터 빠지게 할 수 있습니다.',
  },
  HEADER_STEP,
];

export const INTER_TOUR: TourStep[] = [
  SCOPE_STEP,
  {
    key: 'inter-domain',
    title: '바이오냐, AI냐',
    body: '해외 트렌드는 두 도메인으로 나눠서 봅니다.\n**바이오**와 **AI**는 다루는 매체도, 주제 분류도 완전히 다르기 때문에 섞지 않았어요.',
  },
  {
    key: 'inter-filter',
    title: '기간과 국가를 고르고 "확인"',
    body: '기간·국가를 하나씩 고른 뒤 **확인**을 눌러야 조회됩니다 (클릭할 때마다 화면이 새로 뜨면 여러 개를 비교해볼 수 없어서요).\n\n국가는 매체 국적이 아니라 **기사 내용이 다루는 나라**입니다 — 미국 매체가 중국 기업을 다뤘으면 "중국"이에요.',
  },
  {
    key: 'inter-headline',
    title: '네 개의 요약 숫자',
    body: '**트렌드 기사 수** — 이 기간 총량과 직전 대비 증감\n**가장 급증한 조합** — 어디가 뜨거워졌나 (상위 3개)\n**연결된 포트폴리오사** — 이 흐름에 걸린 우리 회사\n**관련된 주제** — 우리와 겹치는 영역이 몇 갠지',
  },
  {
    key: 'inter-matrix',
    title: '주제 × 사건 유형 격자',
    body: '**가로줄**은 "무엇에 관한 기사인가"(항암·신약발굴…), **세로줄**은 "무슨 일이 일어났나"(투자·딜, 규제·승인…)입니다.\n\n두 축을 나눠놨기 때문에 "항암 분야에서 투자가 터졌다"가 칸 하나로 읽혀요. 색이 진할수록 기사가 많고, 빨간 테두리는 급증한 칸입니다. **칸을 누르면** 근거와 대표 기사가 열립니다.',
  },
  {
    key: 'inter-insight',
    title: '이 화면이 말하는 것',
    body: '왼쪽 격자의 숫자를 사람 말로 풀어놓은 자리입니다.\n어디로 돈이 몰리는지, 우리 포트폴리오는 어디에 걸쳐 있는지, 남들이 놓치기 쉬운 곳은 어딘지 — 전부 실제 집계값에서 뽑은 문장이라 지어낸 말이 없습니다.',
  },
  {
    key: 'inter-summary',
    title: 'AI 종합 요약',
    body: '트렌드 한 줄 · 스파크랩의 포지션 · 취해야 할 액션, 세 줄로 정리합니다.\n문장 아래 색깔 칩은 그 말을 뒷받침하는 **실제 숫자**예요.\n\n하루 한 번 수집 직후에 미리 계산해두기 때문에 표시된 시각 기준입니다.',
  },
  {
    key: 'inter-sectors',
    title: '주제별 상세',
    body: '주제 카드가 **급한 순서**(급증 → 기회 → 주요 흐름 → 관측 중)로 정렬돼 있습니다.\n각 카드 안에서 판정 근거, 기사·논문·오피니언 원문, 그리고 걸린 포트폴리오사를 볼 수 있어요.',
  },
  HEADER_STEP,
];

// ── 투어 엔진 ────────────────────────────────────────────────────────────

const PAD = 8;        // 스포트라이트가 대상보다 얼마나 넉넉하게 뚫릴지
const GAP = 14;       // 말풍선과 대상 사이 간격
const CARD_W = 360;   // 말풍선 너비
const MARGIN = 16;    // 화면 가장자리 최소 여백
const MIN_CARD = 200; // 이만큼도 자리가 안 나면 대상 옆이 아니라 화면 구석에 붙인다

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
}

/** **굵게** 마크다운과 줄바꿈을 살려서 렌더 */
function renderBody(text: string) {
  return text.split('\n').map((line, li) => (
    <span key={li} className="block min-h-[0.4em]">
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, pi) => {
        const m = part.match(/^\*\*([^*]+)\*\*$/);
        return m ? (
          <b key={pi} className="font-bold text-spark-ink">{m[1]}</b>
        ) : (
          <span key={pi}>{part}</span>
        );
      })}
    </span>
  ));
}

function TourOverlay({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = steps[i];

  // 대상 위치 측정 — 부드러운 스크롤이 끝날 때까지 몇 프레임 따라간다.
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step.key);
    if (!el) {
      setRect(null);
      return;
    }

    const measure = () => {
      const cur = findTarget(step.key);
      if (!cur) return;
      const r = cur.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    // 1) 스크롤 전에 곧바로 한 번 재둔다. 이게 있어야 rAF가 안 도는 상황
    //    (백그라운드 탭 등 브라우저가 프레임을 안 그릴 때)에도 스포트라이트가 반드시 뜬다.
    measure();

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });

    // 2) 부드러운 스크롤이 멎을 때까지 따라간다. rAF는 프레임을 그릴 때만 돌므로
    //    타이머로도 몇 번 더 짚어준다(둘 중 하나만 살아 있어도 위치가 맞는다).
    let raf = 0;
    const started = Date.now();
    const track = () => {
      measure();
      if (Date.now() - started < 700) raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    const timers = [60, 180, 360, 600, 800].map(ms => window.setTimeout(measure, ms));

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  const next = useCallback(() => {
    setI(p => (p + 1 < steps.length ? p + 1 : p));
    if (i + 1 >= steps.length) onClose();
  }, [i, steps.length, onClose]);
  const prev = useCallback(() => setI(p => Math.max(0, p - 1)), []);

  // 키보드 — Esc 닫기, →/Enter 다음, ← 이전
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  // 이 컴포넌트는 상단 nav 안에서 렌더되는데, nav에 backdrop-blur가 걸려 있어서
  // 그대로 두면 position:fixed가 뷰포트가 아니라 nav(높이 56px)를 기준으로 잡힌다.
  // (backdrop-filter는 fixed 자손의 컨테이닝 블록이 된다) → body로 포털해서 뺀다.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  if (!step || !host) return null;

  // 말풍선 위치 — 위/아래 중 더 넓은 쪽에 붙인다.
  // 위에 붙일 땐 top 대신 bottom을 쓴다: 말풍선 높이를 몰라도 대상 바로 위에 정확히 맞물린다
  // (높이를 상수로 어림잡으면 대상을 덮어버린다).
  // innerHeight/Width가 0으로 잡히는 환경(렌더링 안 하는 숨은 탭 등)에서도 계산이 깨지지 않게 하한을 둔다.
  const vh = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 0) || 800);
  const vw = Math.max(320, (typeof window !== 'undefined' ? window.innerWidth : 0) || 1200);
  const width = Math.min(CARD_W, vw - MARGIN * 2);
  let cardStyle: React.CSSProperties;
  if (!rect) {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width };
  } else {
    const spaceBelow = vh - (rect.top + rect.height) - PAD - GAP;
    const spaceAbove = rect.top - PAD - GAP;
    const left = Math.min(Math.max(MARGIN, rect.left), vw - width - MARGIN);
    // 어느 쪽에 붙이든 카드는 항상 화면 안에 있어야 한다. 대상이 화면 밖에 있거나
    // (스크롤이 아직 안 끝난 순간) 화면을 꽉 채울 때도 카드가 잘리지 않도록 값을 가둔다.
    const limit = (v: number) => Math.min(Math.max(MARGIN, v), Math.max(MARGIN, vh - MARGIN - MIN_CARD));
    if (Math.max(spaceAbove, spaceBelow) < MIN_CARD) {
      // 대상이 화면을 거의 다 채워 위아래 어디에도 자리가 없으면(긴 목록 패널 등)
      // 카드를 오른쪽 아래에 붙인다 — 대상을 조금 가리더라도 화면 밖으로 나가지 않게.
      cardStyle = { bottom: MARGIN, right: MARGIN, width, maxHeight: vh - MARGIN * 2 };
    } else if (spaceBelow >= spaceAbove) {
      const top = limit(rect.top + rect.height + PAD + GAP);
      cardStyle = { top, left, width, maxHeight: vh - MARGIN - top };
    } else {
      const bottom = limit(vh - (rect.top - PAD - GAP));
      cardStyle = { bottom, left, width, maxHeight: vh - MARGIN - bottom };
    }
  }

  const last = i === steps.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="대시보드 튜토리얼">
      {/* 클릭 차단 — 투어 중에는 화면을 건드리지 않게 */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* 스포트라이트 — 대상만 남기고 나머지를 어둡게 */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-white/70 transition-all duration-200 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(15,23,42,0.6)',
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-slate-900/60" />
      )}

      {/* 설명 말풍선 */}
      <div
        className="absolute flex flex-col overflow-hidden rounded-2xl border border-spark-border bg-white p-4 shadow-2xl"
        style={cardStyle}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-full bg-spark-purple px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
            {i + 1} / {steps.length}
          </span>
          <button
            onClick={onClose}
            className="ml-auto -mr-1 rounded-md px-1.5 py-0.5 text-[16px] leading-none text-spark-muted hover:bg-spark-subtle hover:text-spark-ink"
            aria-label="튜토리얼 닫기"
          >
            ×
          </button>
        </div>

        <h2 className="mb-1.5 text-[15px] font-extrabold leading-snug text-spark-ink">{step.title}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto text-[13px] leading-relaxed text-spark-ink-soft">
          {renderBody(step.body)}
        </div>

        {/* 진행 점 + 버튼 */}
        <div className="mt-3.5 flex shrink-0 items-center gap-2 border-t border-spark-cream pt-3">
          <div className="flex flex-wrap gap-1">
            {steps.map((s, si) => (
              <button
                key={s.key}
                onClick={() => setI(si)}
                aria-label={`${si + 1}단계로 이동`}
                className={`h-1.5 rounded-full transition-all ${
                  si === i ? 'w-4 bg-spark-purple' : 'w-1.5 bg-spark-border hover:bg-spark-muted'
                }`}
              />
            ))}
          </div>
          <div className="ml-auto flex shrink-0 gap-1.5">
            {i > 0 && (
              <button
                onClick={prev}
                className="rounded-lg border border-spark-border px-3 py-1.5 text-[13px] font-semibold text-spark-ink-soft hover:bg-spark-subtle"
              >
                이전
              </button>
            )}
            <button
              onClick={last ? onClose : next}
              className="rounded-lg bg-spark-purple px-4 py-1.5 text-[13px] font-bold text-white hover:brightness-110"
            >
              {last ? '끝내기' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}

// ── 헤더 버튼 ────────────────────────────────────────────────────────────

function TutorialButtonInner() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  // 열 때마다 1단계부터 다시 시작하도록 오버레이를 새로 마운트시키는 키
  const [runId, setRunId] = useState(0);
  const [waiting, setWaiting] = useState(false);

  // 대시보드 메인에서만 의미가 있다(하위 페이지엔 설명할 패널이 없음).
  // ⚠️ 이 컴포넌트는 대시보드 공용 nav에 얹혀 있어 /dashboard ↔ /dashboard/* 사이 클라이언트
  // 라우팅에도 인스턴스가 유지된다 — 훅 선언 이후에만 return해야 훅 개수가 렌더마다 같아진다
  // (여기 있던 return이 useState(waiting)보다 앞에 있어서 React error #300이 났었음, 2026-08-10).
  if (pathname !== '/dashboard') return null;

  const scope = sp.get('scope') === 'inter' ? 'inter' : 'intra';

  async function start() {
    const all = scope === 'inter' ? INTER_TOUR : INTRA_TOUR;

    // Inter 패널은 데이터를 클라이언트에서 받아온다("불러오는 중..."). 그 사이에 열면
    // 본문 패널이 아직 없어서 설명이 통째로 빠지므로, 잠깐(최대 4초) 기다렸다 시작한다.
    if (scope === 'inter' && !findTarget('inter-headline')) {
      setWaiting(true);
      for (let t = 0; t < 20 && !findTarget('inter-headline'); t++) {
        await new Promise(r => setTimeout(r, 200));
      }
      setWaiting(false);
    }

    // 지금 화면에 실제로 있는 단계만 남긴다 — Intra는 탭에 따라 패널이 달라진다.
    const visible = all.filter(s => findTarget(s.key));
    setSteps(visible.length > 0 ? visible : all.slice(0, 1));
    setRunId(n => n + 1);
  }

  return (
    <>
      <button
        onClick={start}
        disabled={waiting}
        className="rounded-md border border-spark-border bg-white px-2.5 py-1 text-[11px] font-bold text-spark-ink-soft transition-colors hover:border-spark-purple/50 hover:text-spark-purple disabled:opacity-60"
      >
        {waiting ? '🎓 준비 중…' : '🎓 튜토리얼 열기'}
      </button>
      {steps && <TourOverlay key={runId} steps={steps} onClose={() => setSteps(null)} />}
    </>
  );
}

export function DashboardTutorial() {
  // useSearchParams는 Suspense 경계가 필요하다(Next.js app router).
  return (
    <Suspense fallback={null}>
      <TutorialButtonInner />
    </Suspense>
  );
}
