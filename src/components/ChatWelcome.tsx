'use client';

// SparkScope 챗봇 첫 화면(초안). 아직 실제 응답 백엔드는 붙어 있지 않고,
// 입력 → 모드/필터 선택 → 전송까지의 UI 흐름만 구현되어 있다.
import { useRef, useState } from 'react';

/** 입력창 아래 토글 — 질문을 "어떤 방식으로" 처리할지 */
const MODES = [
  {
    id: 'search',
    label: '기사 검색',
    hint: '수집된 기사 DB에서 바로 찾기',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'trend',
    label: '트렌드 분석',
    hint: '기간 비교·급증 감지·언론사 분포',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <path d="M2 11.5L6 7l3 2.5L14 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.5 4H14v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'briefing',
    label: '심층 브리핑',
    hint: '여러 기사를 읽고 원인·맥락까지 정리',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="2.4" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'risk',
    label: '위기 감지',
    hint: '부정 기사·리스크 시그널 우선 확인',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <path d="M8 2.2l6 10.6H2L8 2.2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="0.85" fill="currentColor" />
      </svg>
    ),
  },
] as const;

/** 검색 범위 — 스파크스코프가 다루는 3개 축 */
const SCOPES = [
  { id: 'portfolio', label: '포트폴리오사' },
  { id: 'competitor', label: '경쟁사(VC)' },
  { id: 'sparklabs', label: '스파크랩' },
] as const;

/** 하단 카테고리 버튼 + 각 카테고리의 예시 질문 */
const CATEGORIES = [
  {
    id: 'find',
    label: '기사 찾기',
    heading: '기사 검색 예시',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
        <circle cx="9" cy="9" r="5.6" stroke="currentColor" strokeWidth="1.7" />
        <path d="M13.2 13.2L17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
    suggestions: [
      '이번 주 포트폴리오사 투자유치 기사 모아줘',
      '오늘 스파크랩 언급된 기사 있어?',
      '지난달 시리즈A 관련 기사 중 조회수 높은 순으로',
      '노이즈로 걸러진 기사 중 다시 봐야 할 게 있을까?',
      '특정 포폴사 이름으로 최근 3개월 기사 찾아줘',
    ],
  },
  {
    id: 'trend',
    label: '동향 파악',
    heading: '트렌드 분석 예시',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
        <path d="M3 14.5L7.5 9l3.5 3 6-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 5.5h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    suggestions: [
      '이번 주 기사량이 급증한 회사는 어디야?',
      '경쟁 VC들이 최근 어떤 섹터에 많이 노출됐어?',
      '지난 분기 대비 포폴사 보도량 변화 정리해줘',
      '우리 기사를 가장 많이 써준 매체 TOP 10',
      '요즘 인터 관련 기사에서 자주 나오는 키워드는?',
    ],
  },
  {
    id: 'risk',
    label: '리스크 점검',
    heading: '위기·이슈 점검 예시',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
        <path d="M10 2.8l7.4 13.4H2.6L10 2.8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="10" cy="14" r="1" fill="currentColor" />
      </svg>
    ),
    suggestions: [
      '최근 7일 부정 톤 기사만 보여줘',
      '이 이슈가 왜 갑자기 늘었는지 설명해줘',
      '포폴사 중 지금 리스크 시그널이 있는 곳은?',
      '같은 사안을 다룬 매체별 논조 차이 비교해줘',
      '어제 대비 오늘 새로 뜬 부정 기사 있어?',
    ],
  },
  {
    id: 'write',
    label: '리포트 작성',
    heading: '리포트·정리 예시',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
        <path d="M13.2 3.4l3.4 3.4L7.2 16.2 3 17l.8-4.2 9.4-9.4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    ),
    suggestions: [
      '이번 주 다이제스트 초안 만들어줘',
      '이 기사 3줄 요약하고 시사점 뽑아줘',
      '경영진 보고용으로 한 문단 정리해줘',
      '포폴사별 이번 달 하이라이트 표로 정리',
      '이 이슈 타임라인 순서대로 정리해줘',
    ],
  },
] as const;

export function ChatWelcome({ userEmail }: { userEmail?: string }) {
  const [input, setInput] = useState('');
  const [activeModes, setActiveModes] = useState<string[]>(['search']);
  const [activeScopes, setActiveScopes] = useState<string[]>([]);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];

  const pick = (text: string) => {
    setInput(text);
    setOpenCategory(null);
    inputRef.current?.focus();
  };

  const send = () => {
    if (!input.trim()) return;
    // TODO: /api/chat 연결 전까지는 콘솔 확인용
    console.log('[SparkScope chat]', { question: input, modes: activeModes, scopes: activeScopes });
    setInput('');
  };

  const category = CATEGORIES.find((c) => c.id === openCategory);

  return (
    <div className="min-h-screen bg-spark-cream flex flex-col items-center justify-center px-6 py-14">
      <div className="w-full max-w-3xl flex flex-col items-center animate-rise">
        {/* 로고 */}
        <SparkScopeMark />
        <div className="mt-4 mb-8 text-center">
          <h1 className="text-3xl sm:text-[34px] font-extrabold tracking-tight text-spark-ink mb-2">
            어떤 기사를 찾고 계세요?
          </h1>
          <p className="text-spark-ink-soft text-[15px]">
            스파크스코프가 모아둔 기사에서 찾아보고, 흐름까지 정리해드릴게요.
          </p>
        </div>

        {/* 입력 카드 */}
        <div className="w-full bg-spark-surface border border-spark-border rounded-2xl shadow-card overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="무엇이든 물어보세요. 예) 이번 주 포폴사 투자유치 기사 정리해줘"
              className="w-full resize-none bg-transparent text-[15px] leading-6 text-spark-ink outline-none placeholder:text-spark-muted"
            />
          </div>

          {/* 모드 토글 */}
          <div className="px-4 pb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {MODES.map((m) => {
                const on = activeModes.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    title={m.hint}
                    onClick={() => setActiveModes((prev) => toggle(prev, m.id))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold transition ${
                      on
                        ? 'bg-spark-light-purple text-spark-purple'
                        : 'bg-spark-subtle text-spark-muted hover:text-spark-ink-soft border border-spark-border'
                    }`}
                  >
                    {m.icon}
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={send}
              disabled={!input.trim()}
              aria-label="보내기"
              className={`w-9 h-9 shrink-0 grid place-items-center rounded-full transition ${
                input.trim()
                  ? 'bg-spark-purple text-white hover:opacity-90'
                  : 'bg-spark-subtle text-spark-muted border border-spark-border cursor-not-allowed'
              }`}
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                <path d="M8 13V3.5M8 3.5L4 7.5M8 3.5l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* 검색 범위 */}
          <div className="px-4 py-2.5 border-t border-spark-border flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-spark-muted mr-0.5">범위</span>
            {SCOPES.map((s) => {
              const on = activeScopes.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveScopes((prev) => toggle(prev, s.id))}
                  className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition border ${
                    on
                      ? 'bg-spark-light-purple text-spark-purple border-spark-purple/30'
                      : 'bg-white text-spark-muted border-spark-border hover:text-spark-ink-soft'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
            <span className="ml-auto text-[11px] text-spark-muted">
              {activeScopes.length === 0 ? '선택 안 하면 전체에서 찾아요' : `${activeScopes.length}개 범위 선택됨`}
            </span>
          </div>
        </div>

        {/* 카테고리 */}
        <div className="w-full mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CATEGORIES.map((c) => {
            const on = openCategory === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpenCategory(on ? null : c.id)}
                className={`flex flex-col items-center justify-center gap-2 px-3 py-4 rounded-2xl border transition ${
                  on
                    ? 'bg-spark-light-purple border-spark-purple/30 shadow-card'
                    : 'bg-spark-surface border-spark-border hover:border-spark-border-strong'
                }`}
              >
                <span className={on ? 'text-spark-purple' : 'text-spark-muted'}>{c.icon}</span>
                <span className={`text-[13px] font-semibold ${on ? 'text-spark-purple' : 'text-spark-ink'}`}>
                  {c.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* 예시 질문 */}
        {category && (
          <div className="w-full mt-3 bg-spark-surface border border-spark-border rounded-2xl shadow-card overflow-hidden animate-rise">
            <div className="px-4 py-2.5 border-b border-spark-border text-[13px] font-semibold text-spark-ink-soft">
              {category.heading}
            </div>
            <ul className="divide-y divide-spark-border">
              {category.suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    className="w-full text-left px-4 py-3 hover:bg-spark-subtle transition flex items-center gap-3"
                  >
                    <span className="text-spark-purple shrink-0">{category.icon}</span>
                    <span className="text-[14px] text-spark-ink-soft">{s}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 text-[11px] text-spark-muted text-center">
          답변은 수집된 기사 기반 초안입니다 · 외부 공유 금지
          {userEmail ? ` · ${userEmail}` : ''}
        </div>
      </div>
    </div>
  );
}

/** SparkScope 로고 마크 — 대시보드 상단 로고(보라 사각형 + S)의 큰 버전 */
function SparkScopeMark() {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 96 96" className="w-20 h-20" aria-label="SparkScope">
        <defs>
          <linearGradient id="ss-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6E66EA" />
            <stop offset="100%" stopColor="#5046E5" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="88" height="88" rx="26" fill="url(#ss-grad)" />
        {/* 스코프(렌즈) + 스파크 */}
        <circle cx="44" cy="44" r="20" fill="none" stroke="#fff" strokeWidth="5" strokeOpacity="0.95" />
        <path d="M59 59L74 74" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
        <path d="M46 33l-9 14h8l-3 10 10-14h-8l2-10z" fill="#fff" />
      </svg>
      <span className="text-[13px] font-extrabold tracking-[0.14em] text-spark-purple">SPARKSCOPE</span>
    </div>
  );
}
