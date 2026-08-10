'use client';

// SparkScope 챗봇 첫 화면(초안). 아직 실제 응답 백엔드/DB는 붙어 있지 않고,
// 입력 → 답변 방식 → 검색 범위 → 파일 첨부 → 전송까지의 UI 흐름만 구현되어 있다.
//
// 화면의 세 줄은 서로 다른 축을 담당한다. (겹치지 않게 의도적으로 분리)
//   1) 답변 방식(MODES)  = 어떻게 답할지   — 깊이·형식 옵션
//   2) 검색 범위(SCOPES) = 어디서 찾을지   — 데이터 소스
//   3) 카테고리(TASKS)   = 무엇을 할지     — 대시보드 기능별 업무 시나리오
import { useRef, useState } from 'react';

/** 1) 답변 방식 — 질문을 어떤 깊이·형식으로 처리할지 */
const MODES = [
  {
    id: 'deep',
    label: '심층 분석',
    hint: '여러 기사를 교차로 읽고 원인·맥락까지 정리 (느리지만 자세함)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="2.4" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'sources',
    label: '근거 기사 첨부',
    hint: '답변에 쓰인 원문 기사 링크를 함께 보여줌',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <path d="M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 10-3.7-3.7l-.9.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 103.7 3.7l.9-.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'table',
    label: '표로 정리',
    hint: '회사·건수·매체·날짜를 표 형태로 정리해서 답변 (보고서에 붙여넣기 좋게)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.2 6.4h11.6M6.6 6.4V13" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
] as const;

/** 1-b) 기간 — 토글이 아니라 하나만 고르는 선택형. 대시보드 기본값과 동일하게 최근 3개월. */
const PERIODS = [
  { id: 'today', label: '오늘' },
  { id: 'week', label: '이번 주' },
  { id: 'month', label: '최근 1개월' },
  { id: 'quarter', label: '최근 3개월' },
  { id: 'all', label: '전체 기간' },
] as const;

/** 2) 검색 범위 — 스파크스코프가 다루는 데이터 축 (Intra 3 + Inter 1) */
const SCOPES = [
  { id: 'portfolio', label: '포트폴리오사' },
  { id: 'competitor', label: '경쟁사(VC)' },
  { id: 'sparklabs', label: '스파크랩' },
  { id: 'inter', label: '해외 트렌드' },
] as const;

/** 3) 카테고리 — 대시보드/인터/인트라 기능별 업무 시나리오 */
const TASKS = [
  {
    id: 'find',
    label: '기사 찾기',
    desc: '검색 · 필터 · 최근 수집',
    heading: '기사 검색 · 조회',
    icon: <IconSearch />,
    suggestions: [
      '이번 주 포트폴리오사 투자유치 기사 모아줘',
      '오늘 새로 수집된 기사 중 스파크랩 언급된 것',
      '지난달 시리즈A 관련 기사만 최신순으로',
      '이 회사 이름으로 최근 3개월 기사 전부 찾아줘',
      '내가 스크랩·북마크해둔 기사 다시 보여줘',
    ],
  },
  {
    id: 'metric',
    label: '지표·추이',
    desc: '건수 · 증감 · 매체 분포',
    heading: '수치와 추이',
    icon: <IconChart />,
    suggestions: [
      '이번 주 보도량 TOP 10 포폴사 알려줘',
      '지난 분기 대비 포폴사 기사량 얼마나 늘었어?',
      '우리 기사를 가장 많이 써준 매체 순위',
      '경쟁 VC별 노출량 비교해줘',
      '최근 6개월 월별 기사 추이 정리해줘',
    ],
  },
  {
    id: 'risk',
    label: '위기·이슈',
    desc: '부정 톤 · 급증 · 리스크',
    heading: '위기 감지와 원인 분석',
    icon: <IconAlert />,
    suggestions: [
      '지금 리스크 시그널이 잡힌 포폴사 있어?',
      '최근 7일 부정 톤 기사만 모아줘',
      '이 회사 기사가 갑자기 늘어난 이유가 뭐야?',
      '같은 사안을 다룬 매체별 논조 차이 비교해줘',
      '어제 대비 오늘 새로 뜬 부정 기사',
    ],
  },
  {
    id: 'inter',
    label: '해외 트렌드',
    desc: 'Inter · 섹터 · 국가',
    heading: '해외 시장(Inter) 분석',
    icon: <IconGlobe />,
    suggestions: [
      '최근 뜨는 해외 AI 섹터가 뭐야?',
      '바이오 섹터 중 급증한 주제 알려줘',
      '미국·유럽 기사에서 자주 나오는 키워드는?',
      '이 해외 트렌드와 겹치는 우리 포폴사가 있어?',
      '이번 주 인터 브리핑 요약해줘',
    ],
  },
  {
    id: 'report',
    label: '리포트·메일',
    desc: '다이제스트 · 보고용 요약',
    heading: '리포트 작성',
    icon: <IconPen />,
    suggestions: [
      '이번 주 다이제스트 초안 만들어줘',
      '이 기사 3줄 요약하고 시사점 뽑아줘',
      '경영진 보고용으로 한 문단 정리해줘',
      '포폴사별 이번 달 하이라이트 표로 정리',
      '이 이슈 타임라인 순서대로 정리해줘',
    ],
  },
  {
    id: 'manage',
    label: '키워드·노이즈',
    desc: '수집 설정 · 오탐 정리',
    heading: '모니터링 설정 관리',
    icon: <IconSliders />,
    suggestions: [
      '이 회사 키워드에 문맥어 뭘 넣으면 좋을까?',
      '요즘 오탐이 많은 키워드 찾아줘',
      '이 기사 노이즈로 신고하고 싶어',
      '수집은 되는데 한 건도 안 걸리는 키워드 있어?',
      '동명이인 때문에 잘못 잡히는 기사 정리해줘',
    ],
  },
] as const;

/** 첨부 가능한 파일 — 사내에서 쓰는 문서·미디어 전반 */
const ACCEPT = [
  // 문서
  '.pdf', '.doc', '.docx', '.hwp', '.hwpx', '.txt', '.rtf', '.md',
  // 스프레드시트 / 프레젠테이션
  '.xls', '.xlsx', '.csv', '.tsv', '.ppt', '.pptx', '.key', '.numbers', '.pages',
  // 이미지
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.svg',
  // 오디오 / 비디오
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.mp4', '.mov', '.avi', '.mkv', '.webm',
  // 기타
  '.zip', '.json', '.xml', '.eml', '.msg',
].join(',');

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fileKind(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return '🎧';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return '🖼️';
  if (['xls', 'xlsx', 'csv', 'tsv', 'numbers'].includes(ext)) return '📊';
  if (['ppt', 'pptx', 'key'].includes(ext)) return '📽️';
  if (ext === 'pdf') return '📕';
  return '📄';
}

export function ChatWelcome({ userEmail }: { userEmail?: string }) {
  const [input, setInput] = useState('');
  const [activeModes, setActiveModes] = useState<string[]>(['sources']);
  const [period, setPeriod] = useState<string>('quarter');
  const [activeScopes, setActiveScopes] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    setFiles((prev) => [...prev, ...Array.from(incoming)]);
  };

  const pick = (text: string) => {
    setInput(text);
    setOpenTask(null);
    inputRef.current?.focus();
  };

  const send = () => {
    if (!input.trim() && files.length === 0) return;
    // TODO: /api/chat 연결 전까지는 콘솔 확인용
    console.log('[SparkScope chat]', {
      question: input,
      modes: activeModes,
      period,
      scopes: activeScopes,
      files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    });
    setInput('');
    setFiles([]);
  };

  const task = TASKS.find((t) => t.id === openTask);
  const canSend = input.trim().length > 0 || files.length > 0;

  return (
    <div className="min-h-screen bg-spark-cream flex flex-col items-center justify-center px-6 py-14">
      <div className="w-full max-w-3xl flex flex-col items-center animate-rise">
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
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`w-full bg-spark-surface border rounded-2xl shadow-card overflow-hidden transition ${
            dragging ? 'border-spark-purple ring-2 ring-spark-purple/20' : 'border-spark-border'
          }`}
        >
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

          {/* 첨부된 파일 */}
          {files.length > 0 && (
            <div className="px-4 pb-2 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg bg-spark-subtle border border-spark-border text-[12px] text-spark-ink-soft"
                >
                  <span aria-hidden>{fileKind(f.name)}</span>
                  <span className="max-w-[180px] truncate font-medium">{f.name}</span>
                  <span className="text-spark-muted">{fmtSize(f.size)}</span>
                  <button
                    type="button"
                    aria-label={`${f.name} 첨부 취소`}
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="w-4 h-4 grid place-items-center rounded text-spark-muted hover:text-spark-ink hover:bg-spark-border/60"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 답변 방식 + 전송 */}
          <div className="px-4 pb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-semibold text-spark-muted mr-0.5">답변 방식</span>

              {/* 기간 — 하나만 고르는 선택형 */}
              <label
                title="검색할 기간"
                className="relative flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-[13px] font-semibold bg-spark-light-purple text-spark-purple cursor-pointer"
              >
                <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                  <rect x="2.2" y="3.2" width="11.6" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2.2 6.4h11.6M5.6 1.8v2.6M10.4 1.8v2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>{PERIODS.find((p) => p.id === period)?.label}</span>
                <span aria-hidden className="text-[10px] leading-none">▾</span>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  aria-label="검색 기간"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                >
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

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
              disabled={!canSend}
              aria-label="보내기"
              className={`w-9 h-9 shrink-0 grid place-items-center rounded-full transition ${
                canSend
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
            <span className="text-[12px] font-semibold text-spark-muted mr-0.5">검색 범위</span>
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
              {activeScopes.length === 0 ? '선택하지 않을시 전체에서 찾아요' : `${activeScopes.length}개 범위 선택됨`}
            </span>
          </div>

          {/* 파일 첨부 */}
          <div className="px-4 py-2.5 border-t border-spark-border flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-spark-ink-soft hover:text-spark-purple transition"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              파일 첨부
            </button>
            <span className="text-[11px] text-spark-muted">
              PDF · 워드 · 한글 · 엑셀 · PPT · 이미지 · 음성(mp3) · 영상(mp4) — 끌어다 놓아도 돼요
            </span>
          </div>
        </div>

        {/* 카테고리 */}
        <div className="w-full mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {TASKS.map((t) => {
            const on = openTask === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpenTask(on ? null : t.id)}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl border text-left transition ${
                  on
                    ? 'bg-spark-light-purple border-spark-purple/30 shadow-card'
                    : 'bg-spark-surface border-spark-border hover:border-spark-border-strong'
                }`}
              >
                <span className={`shrink-0 ${on ? 'text-spark-purple' : 'text-spark-muted'}`}>{t.icon}</span>
                <span className="min-w-0">
                  <span className={`block text-[13px] font-bold ${on ? 'text-spark-purple' : 'text-spark-ink'}`}>
                    {t.label}
                  </span>
                  <span className="block text-[11px] text-spark-muted truncate">{t.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 예시 질문 */}
        {task && (
          <div className="w-full mt-3 bg-spark-surface border border-spark-border rounded-2xl shadow-card overflow-hidden animate-rise">
            <div className="px-4 py-2.5 border-b border-spark-border text-[13px] font-semibold text-spark-ink-soft">
              {task.heading}
            </div>
            <ul className="divide-y divide-spark-border">
              {task.suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    className="w-full text-left px-4 py-3 hover:bg-spark-subtle transition flex items-center gap-3"
                  >
                    <span className="text-spark-purple shrink-0">{task.icon}</span>
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
        <circle cx="44" cy="44" r="20" fill="none" stroke="#fff" strokeWidth="5" strokeOpacity="0.95" />
        <path d="M59 59L74 74" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
        <path d="M46 33l-9 14h8l-3 10 10-14h-8l2-10z" fill="#fff" />
      </svg>
      <span className="text-[13px] font-extrabold tracking-[0.14em] text-spark-purple">SPARKSCOPE</span>
    </div>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
      <circle cx="9" cy="9" r="5.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M13.2 13.2L17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
      <path d="M3 14.5L7.5 9l3.5 3 6-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 5.5h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
      <path d="M10 2.8l7.4 13.4H2.6L10 2.8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
      <circle cx="10" cy="10" r="7.3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2.7 10h14.6M10 2.7c1.9 2 2.9 4.6 2.9 7.3s-1 5.3-2.9 7.3c-1.9-2-2.9-4.6-2.9-7.3S8.1 4.7 10 2.7z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function IconPen() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
      <path d="M13.2 3.4l3.4 3.4L7.2 16.2 3 17l.8-4.2 9.4-9.4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function IconSliders() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
      <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="6" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="13" cy="14" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
