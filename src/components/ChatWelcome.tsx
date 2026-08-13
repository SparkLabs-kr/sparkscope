'use client';

// SparkScope 챗봇 첫 화면(초안). 아직 실제 응답 백엔드/DB는 붙어 있지 않고,
// 입력 → 답변 방식 → 검색 범위 → 파일 첨부 → 전송까지의 UI 흐름만 구현되어 있다.
//
// 화면의 세 줄은 서로 다른 축을 담당한다. (겹치지 않게 의도적으로 분리)
//   1) 답변 방식(MODES)  = 어떻게 답할지   — 깊이·형식 옵션
//   2) 검색 범위(SCOPES) = 어디서 찾을지   — 데이터 소스
//   3) 카테고리(TASKS)   = 무엇을 할지     — 대시보드 기능별 업무 시나리오
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { exportAnswerToHtml } from '@/lib/chat-export';
import { AnswerText } from './AnswerText';
// 서버 전용 모듈(prisma)이 클라이언트 번들에 딸려오지 않도록 타입 전용 파일에서 가져온다.
import {
  categoryLabel,
  PERIOD_LABEL,
  SCOPE_LABEL,
  type ChatArticle,
  type ChatQueryResult,
  type ChatResponse,
  type ResultKind,
} from '@/lib/sparkscope/chat-types';

// 음성 입력(마이크) — 브라우저 Web Speech API. leeryeong 브랜치에서 먼저 만든 걸 이식(2026-08-11).
// 표준 TS DOM 타입에 없어서 최소한만 직접 선언한다.
interface SpeechRecognitionAlternative { transcript: string }
interface SpeechRecognitionResult { [index: number]: SpeechRecognitionAlternative; length: number }
interface SpeechRecognitionResultList { [index: number]: SpeechRecognitionResult; length: number }
interface SpeechRecognitionEvent extends Event { results: SpeechRecognitionResultList }
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

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

/** 2) 검색 범위 — 스파크스코프가 다루는 데이터 축 (Intra 4 + Inter 1) */
const SCOPES = [
  { id: 'portfolio', label: '포트폴리오사' },
  { id: 'competitor', label: '경쟁사(VC)' },
  { id: 'sparklabs', label: '스파크랩' },
  { id: 'industry', label: '업계동향' },
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
    label: '대시보드 모니터링',
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

const STORE_KEY = 'sparkscope-chat-history';

type Convo = { id: string; title: string; updatedAt: number; messages: Msg[] };

type Msg =
  | { role: 'user'; text: string; period: string; scopes: string[]; files: string[] }
  | { role: 'assistant'; res: ChatResponse; period: string; scopes: string[]; modes: string[] }
  | { role: 'error'; text: string };

/** 예전 버전이 저장해 둔 대화를 지금 형식으로 맞춘다.
 *  (assistant 메시지가 {result}만 갖고 있던 시절이 있어서, 그대로 열면 화면이 깨졌다) */
function migrateConvos(raw: any): Convo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
    .map((c) => ({
      id: c.id,
      title: typeof c.title === 'string' ? c.title : '대화',
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
      messages: c.messages.flatMap((m: any): Msg[] => {
        if (!m || typeof m !== 'object') return [];
        if (m.role === 'user') {
          return [
            {
              role: 'user',
              text: String(m.text ?? ''),
              period: m.period ?? 'quarter',
              scopes: Array.isArray(m.scopes) ? m.scopes : [],
              files: Array.isArray(m.files) ? m.files : [],
            },
          ];
        }
        if (m.role === 'error') return [{ role: 'error', text: String(m.text ?? '오류') }];
        if (m.role === 'assistant') {
          // 구버전: { result }  →  신버전: { res: { result, ... } }
          const res: ChatResponse = m.res ?? {
            intent: 'search',
            note: null,
            unsupported: null,
            summary: null,
            result: m.result ?? null,
          };
          return [
            {
              role: 'assistant',
              res,
              period: m.period ?? 'quarter',
              scopes: Array.isArray(m.scopes) ? m.scopes : [],
              modes: Array.isArray(m.modes) ? m.modes : [],
            },
          ];
        }
        return [];
      }),
    }));
}

export function ChatWelcome({ userEmail }: { userEmail?: string }) {
  const [input, setInput] = useState('');
  const [activeModes, setActiveModes] = useState<string[]>(['sources']);
  const [period, setPeriod] = useState<string>('quarter');
  const [activeScopes, setActiveScopes] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  /** 조회 진행 상황 — 서버가 도구를 부를 때마다 흘려보내는 것을 쌓아 보여준다 */
  const [progress, setProgress] = useState<{ label: string; detail?: string; done: boolean }[]>([]);
  const [composing, setComposing] = useState(false); // 한글 IME 조합 중 여부
  const [messages, setMessages] = useState<Msg[]>([]);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 답변이 오거나 로딩이 시작돼도 화면을 자동으로 안 움직인다 — 어디를 보고 있었든 그대로
  // 두고, 대신 "답변 보기" 버튼을 띄워서 원할 때 직접 맨 아래로 내려가게 한다(2026-08-13
  // 피드백 — 자동 스크롤이 "튕기는 느낌"이라 아예 없앴다).
  const [showJumpToAnswer, setShowJumpToAnswer] = useState(false);
  const prevLoadingRef = useRef(false);
  // "혹시 이것도 찾으신가요?" 칩이나 "실시간 검색할까요?" 버튼처럼, 사용자가 답변 안의
  // 버튼을 직접 눌러서 새 조회를 시킨 경우엔 그 결과가 어디 있는지 안 보이면 알아보기
  // 힘들다 — 이때만 예외적으로 결과가 오면 자동으로 맨 아래까지 스크롤한다(2026-08-13).
  const scrollToResultRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // 대화 기록은 로컬(브라우저)에만 저장한다. 서버 테이블은 아직 없다.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setConvos(migrateConvos(JSON.parse(raw)));
    } catch {
      /* 저장본이 깨졌으면 무시하고 새로 시작 */
    }
  }, []);

  // 메시지가 바뀔 때마다 현재 대화를 저장(첫 질문이 제목이 된다)
  useEffect(() => {
    if (messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === 'user');
    const title = firstUser && firstUser.role === 'user' ? firstUser.text : '새 대화';
    setConvos((prev) => {
      const id = convoId ?? String(Date.now());
      if (!convoId) setConvoId(id);
      const rest = prev.filter((c) => c.id !== id);
      const next = [{ id, title, updatedAt: Date.now(), messages }, ...rest].slice(0, 50);
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* 용량 초과 등은 무시 */
      }
      return next;
    });
  }, [messages, convoId]);

  // 답변이 오든 로딩이 시작되든 화면을 절대 자동으로 옮기지 않는다 — 보고 있던 위치 그대로
  // 둔다. 대신 답변이 다 오면 "답변 보기" 버튼만 띄우고, 누르면 그때 맨 아래로 내린다
  // (2026-08-13 — 자동 스크롤이 "튕기는 느낌"이라는 피드백으로 아예 없앴다).
  // prevLoadingRef로 "방금 로딩이 끝난 시점"만 잡아낸다 — 안 그러면 옛 대화를 열 때도
  // messages가 바뀌어서 버튼이 잘못 뜬다.
  useEffect(() => {
    if (loading) {
      setShowJumpToAnswer(false);
    } else if (prevLoadingRef.current) {
      if (scrollToResultRef.current) {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        scrollToResultRef.current = false;
      } else {
        setShowJumpToAnswer(true);
      }
    }
    prevLoadingRef.current = loading;
  }, [messages, loading]);

  // "답변 보기" 클릭 시 맨 아래로 이동 — behavior:'smooth'는 scrollTo·scrollIntoView 둘 다
  // 이 페이지의 중첩 스크롤 구조에서 조용히 안 먹는 게 실제로 확인돼서(애니메이션 없이 그냥
  // 무시됨), scrollTop을 직접 대입한다.
  const jumpToAnswer = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowJumpToAnswer(false);
  };

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];

  // "해외 트렌드"는 국내 4개 범위와 완전히 다른 데이터(inter_trends)라 같이 고르면 의미가
  // 없다 — 국내 범위처럼 겹쳐 고를 수 있는 게 아니라 서로 배타적으로 다룬다(2026-08-13).
  const toggleScope = (id: string) => {
    setActiveScopes((prev) => {
      if (id === 'inter') return prev.includes('inter') ? [] : ['inter'];
      return toggle(prev.filter((s) => s !== 'inter'), id);
    });
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    setFiles((prev) => [...prev, ...Array.from(incoming)]);
  };

  const pick = (text: string) => {
    setInput(text);
    setOpenTask(null);
    inputRef.current?.focus();
  };

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      alert('이 브라우저는 음성 입력을 지원하지 않아요.');
      return;
    }
    const recognition = new Ctor();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (ev: SpeechRecognitionEvent) => {
      let text = '';
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0]?.transcript ?? '';
      setInput(text);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const send = async (opts?: { live?: boolean; keyword?: string; question?: string; scrollToResult?: boolean }) => {
    const question = opts?.live ? '' : (opts?.question ?? input.trim());
    if (!question && !opts?.live) return;
    scrollToResultRef.current = !!opts?.scrollToResult;
    // 파일 첨부는 아직 서버로 보내지 않는다(스토리지 연결 전).
    const attached = files.map((f) => f.name);
    // live 검색일 때는 사용자 메시지를 추가하지 않는다 (이미 이전 결과가 있는 상태)
    if (!opts?.live) {
      setMessages((prev) => [...prev, { role: 'user', text: question, period, scopes: activeScopes, files: attached }]);
    }
    setInput('');
    setFiles([]);
    setOpenTask(null);
    setLoading(true);
    // 이전 대화를 함께 보낸다 — "그중 부정적인 것만" 같은 후속 질문을 이해하려면 필요하다.
    // 답변은 요약 문장만 넘긴다(기사 목록까지 보내면 토큰만 커진다).
    const history = messages
      .map((m) =>
        m.role === 'user'
          ? { role: 'user' as const, text: m.text }
          : m.role === 'assistant' && m.res.summary
            ? { role: 'assistant' as const, text: m.res.summary }
            : null
      )
      .filter(Boolean)
      .slice(-6);
    setProgress([]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          period,
          scopes: activeScopes,
          modes: activeModes,
          history,
          ...(opts?.live && { live: true, keyword: opts.keyword || '' }),
        }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error ?? '조회에 실패했어요.');
      }

      // NDJSON 스트림을 한 줄씩 읽는다. 마지막 done 이벤트가 실제 답변이고,
      // 그 전에 오는 progress 이벤트로 "지금 뭐 하는 중"을 보여준다.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let done: any = null;

      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buf += decoder.decode(value, { stream: true });
        // 마지막 조각은 아직 줄이 안 끝났을 수 있으니 buf에 남겨둔다.
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue; // 깨진 줄은 건너뛴다
          }
          if (ev.type === 'progress') {
            setProgress((prev) => {
              // 같은 작업의 시작/완료는 한 줄로 합쳐서 보여준다.
              const next = prev.slice();
              if (ev.phase === 'tool_done' && next.length && next[next.length - 1].label === ev.label) {
                next[next.length - 1] = { label: ev.label, detail: ev.detail, done: true };
                return next;
              }
              return [...next, { label: ev.label, detail: ev.detail, done: ev.phase !== 'tool_start' }];
            });
          } else if (ev.type === 'done') {
            done = ev;
          } else if (ev.type === 'error') {
            throw new Error(ev.error ?? '조회에 실패했어요.');
          }
        }
      }
      if (!done) throw new Error('응답이 중간에 끊겼어요. 다시 시도해 주세요.');

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          res: done,
          period,
          scopes: done.appliedScopes ?? activeScopes,
          modes: activeModes,
        },
      ]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: 'error', text: e?.message ?? '조회에 실패했어요.' }]);
    } finally {
      setLoading(false);
      setProgress([]);
    }
  };

  const openConvo = (c: Convo) => {
    setConvoId(c.id);
    setMessages(c.messages);
    setOpenTask(null);
  };

  const deleteConvo = (id: string) => {
    setConvos((prev) => {
      const next = prev.filter((c) => c.id !== id);
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });
    if (convoId === id) {
      setConvoId(null);
      setMessages([]);
    }
  };

  const reset = () => {
    setConvoId(null);
    setMessages([]);
    setInput('');
    setFiles([]);
    setOpenTask(null);
    inputRef.current?.focus();
  };

  const task = TASKS.find((t) => t.id === openTask);
  const canSend = input.trim().length > 0 && !loading;

  return (
    <div className="h-screen bg-spark-cream flex">
      {/* 대화 목록 사이드바 */}
      <aside
        className={`shrink-0 border-r border-spark-border bg-white/70 flex flex-col transition-all duration-200 ${
          sidebarOpen ? 'w-60' : 'w-0 overflow-hidden'
        }`}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={reset}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-spark-purple text-white text-[13px] font-semibold hover:opacity-90 transition"
          >
            + 새 대화
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <div className="px-2 py-1.5 text-[11px] font-bold text-spark-muted">대화 기록</div>
          {convos.length === 0 ? (
            <p className="px-2 text-[12px] text-spark-muted leading-relaxed">
              아직 없어요.
              <br />
              질문하면 여기에 쌓입니다.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {convos.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => openConvo(c)}
                    className={`w-full text-left pl-2.5 pr-7 py-2 rounded-lg text-[13px] truncate transition ${
                      c.id === convoId
                        ? 'bg-spark-light-purple text-spark-purple font-semibold'
                        : 'text-spark-ink-soft hover:bg-spark-subtle'
                    }`}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConvo(c.id)}
                    aria-label="대화 삭제"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded text-spark-muted opacity-0 group-hover:opacity-100 hover:bg-spark-border/60 hover:text-spark-ink transition"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* 본문 */}
      <div className="flex-1 min-w-0 flex flex-col">
      {/* 상단 바 */}
      <header className="shrink-0 border-b border-spark-border bg-white/80 backdrop-blur-md px-5 py-2.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="대화 목록 접기/펼치기"
          className="w-7 h-7 grid place-items-center rounded-lg text-spark-muted hover:text-spark-ink hover:bg-spark-subtle transition"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
            <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6.2 3v10" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button type="button" onClick={reset} className="flex items-center gap-2 group" title="새 대화 시작">
          <SparkScopeMark size="sm" />
          <span className="text-spark-ink font-extrabold tracking-tight text-[15px]">SparkScope</span>
        </button>
        <span className="hidden sm:inline text-[12px] text-spark-muted">챗봇</span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/dashboard"
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-semibold hover:bg-blue-700 transition"
          >
            대시보드로 이동
          </Link>
        </div>
      </header>

      {/* 대화 기록 */}
      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className={`max-w-3xl mx-auto px-6 py-8 ${messages.length === 0 ? 'h-full flex items-center justify-center' : ''}`}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center animate-rise">
              <SparkScopeMark />
              <div className="mt-4 mb-7 text-center">
                <h1 className="text-3xl sm:text-[34px] font-extrabold tracking-tight text-spark-ink mb-2">
                  어떤 기사를 찾고 계세요?
                </h1>
                <p className="text-spark-ink-soft text-[15px]">
                  스파크스코프가 모아둔 기사에서 찾아보고, 흐름까지 정리해드릴게요.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end animate-rise">
                    <div className="max-w-[85%]">
                      <div className="bg-spark-purple text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">
                        {m.text}
                      </div>
                      <div className="mt-1 flex flex-wrap justify-end items-center gap-1 text-[11px] text-spark-muted">
                        <span>{PERIOD_LABEL[m.period as keyof typeof PERIOD_LABEL] ?? m.period}</span>
                        {m.scopes.map((sc) => (
                          <span key={sc}>· {SCOPE_LABEL[sc as keyof typeof SCOPE_LABEL] ?? sc}</span>
                        ))}
                        {m.files.map((f) => (
                          <span key={f}>· 📎 {f}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : m.role === 'error' ? (
                  <div key={i} className="flex gap-2.5 animate-rise">
                    <SparkScopeMark size="xs" />
                    <div className="flex-1 bg-red-50 border border-red-200 rounded-2xl rounded-tl-md px-4 py-3 text-[14px] text-red-700">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2.5 animate-rise">
                    <SparkScopeMark size="xs" />
                    <div className="flex-1 min-w-0">
                      <ChatAnswer
                        res={m.res}
                        scopes={m.scopes ?? []}
                        modes={m.modes ?? []}
                        period={m.period ?? 'quarter'}
                        question={lastQuestionBefore(messages, i)}
                        loading={loading}
                        onSendLiveSearch={(keyword) => send({ live: true, keyword, scrollToResult: true })}
                        onFollowUp={(q) => send({ question: q })}
                        onSuggestedKeyword={(kw) => send({ question: kw, scrollToResult: true })}
                      />
                    </div>
                  </div>
                )
              )}

              {loading && (
                <div className="flex gap-2.5 items-start animate-rise">
                  <SparkScopeMark size="xs" />
                  <div className="bg-spark-surface border border-spark-border rounded-2xl rounded-tl-md px-4 py-3 text-[13px] min-w-[240px]">
                    {progress.length === 0 ? (
                      <div className="flex items-center gap-2 text-spark-ink-soft">
                        <span className="w-2.5 h-2.5 rounded-full bg-spark-purple animate-pulse" />
                        질문 이해하는 중…
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {progress.map((p, i) => {
                          const last = i === progress.length - 1;
                          return (
                            <li key={i} className="flex items-start gap-2">
                              {p.done ? (
                                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-spark-purple">
                                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : (
                                <span className="w-2.5 h-2.5 mt-1 shrink-0 rounded-full bg-spark-purple animate-pulse" />
                              )}
                              <span className={last && !p.done ? 'text-spark-ink' : 'text-spark-muted'}>
                                {p.label}
                                {/* detail은 "search(투자유치|시리즈A) → 169건" 같은 실제 조회 결과 */}
                                {p.detail && (
                                  <span className="block text-[11px] text-spark-muted/80 mt-0.5 break-all">{p.detail}</span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 답변이 오면 화면을 자동으로 움직이지 않는 대신, 원하면 바로 내려가서 볼 수 있게
          띄우는 버튼(2026-08-13). */}
      {showJumpToAnswer && (
        <button
          type="button"
          onClick={jumpToAnswer}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-spark-purple text-white text-[12px] font-semibold shadow-pop hover:opacity-90 transition animate-rise"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
            <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          답변 보기
        </button>
      )}
      </div>

      {/* 입력 도크 */}
      <div className="shrink-0 border-t border-spark-border bg-spark-cream/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-6 py-4">
          {/* 예시 질문 — 카테고리를 누르면 입력창 위로 뜬다 */}
          {task && (
            <div className="mb-2 bg-spark-surface border border-spark-border rounded-2xl shadow-pop overflow-hidden animate-rise">
              <div className="px-4 py-2 border-b border-spark-border flex items-center gap-2">
                <span className="text-spark-purple">{task.icon}</span>
                <span className="text-[13px] font-semibold text-spark-ink-soft">{task.heading}</span>
                <button
                  type="button"
                  onClick={() => setOpenTask(null)}
                  aria-label="닫기"
                  className="ml-auto w-5 h-5 grid place-items-center rounded text-spark-muted hover:text-spark-ink hover:bg-spark-subtle"
                >
                  ×
                </button>
              </div>
              <ul className="divide-y divide-spark-border max-h-64 overflow-y-auto">
                {task.suggestions.map((sug) => (
                  <li key={sug}>
                    <button
                      type="button"
                      onClick={() => pick(sug)}
                      className="w-full text-left px-4 py-2.5 hover:bg-spark-subtle transition text-[14px] text-spark-ink-soft"
                    >
                      {sug}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onKeyDown={(e) => {
                  // 한글 조합 중의 Enter는 글자를 확정하는 키다. 여기서 보내면 입력이 잘린다.
                  if (composing) return;
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
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-label={listening ? '음성 입력 중지' : '음성으로 질문 입력'}
                  title="음성으로 질문 입력"
                  className={`w-9 h-9 shrink-0 grid place-items-center rounded-full border transition ${
                    listening
                      ? 'bg-red-50 text-red-600 border-red-200 animate-pulse'
                      : 'bg-spark-subtle text-spark-muted border-spark-border hover:text-spark-ink-soft'
                  }`}
                >
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                    <rect x="6" y="1.5" width="4" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.8 14.5h4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => send()}
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
                    onClick={() => toggleScope(s.id)}
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
          {/* 카테고리 — 대화 중에도 계속 보인다 */}
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {TASKS.map((t) => {
              const on = openTask === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setOpenTask(on ? null : t.id)}
                  title={t.desc}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[12px] font-semibold transition ${
                    on
                      ? 'bg-spark-light-purple border-spark-purple/30 text-spark-purple'
                      : 'bg-spark-surface border-spark-border text-spark-ink-soft hover:border-spark-border-strong'
                  }`}
                >
                  <span className={on ? 'text-spark-purple' : 'text-spark-muted'}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="mt-2 text-[11px] text-spark-muted text-center">
            답변은 수집된 기사 기반 초안입니다 · 외부 공유 금지{userEmail ? ` · ${userEmail}` : ''}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/** 답변 한 덩어리 — 안내 문구 + (심층 분석 켰을 때) 요약 + 조회 결과 */
function ChatAnswer({
  res,
  scopes,
  modes,
  period,
  question,
  loading,
  onSendLiveSearch,
  onFollowUp,
  onSuggestedKeyword,
}: {
  res: ChatResponse;
  scopes: string[];
  modes: string[];
  period: string;
  question: string;
  loading?: boolean;
  onSendLiveSearch?: (keyword: string) => void;
  onFollowUp?: (question: string) => void;
  onSuggestedKeyword?: (keyword: string) => void;
}) {
  if (!res) return null;
  return (
    <div className="w-full space-y-2.5">
      {/* 아직 못 하는 요청 안내 */}
      {res.unsupported && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 text-[13px] text-amber-800">
          <span className="font-semibold">아직 안 되는 기능: {res.unsupported}</span>
          {res.note && <span className="block mt-0.5">{res.note}</span>}
        </div>
      )}
      {!res.unsupported && res.note && (
        <div className="bg-spark-surface border border-spark-border rounded-2xl px-4 py-2.5 text-[14px] text-spark-ink-soft">
          {res.note}
        </div>
      )}

      {/* 심층 분석 요약 */}
      {res.summary && (
        <div className="bg-spark-light-purple/60 border border-spark-purple/20 rounded-2xl px-4 py-3">
          <div className="text-[11px] font-bold text-spark-purple mb-1">🤖 심층 분석</div>
          <AnswerText text={res.summary} />
        </div>
      )}

      {res.result && (
        <ChatResult
          result={res.result}
          scopes={scopes}
          asTable={modes.includes('table')}
          resultKind={res.resultKind}
          loading={loading}
          onLiveSearch={onSendLiveSearch}
          onSuggestedKeyword={onSuggestedKeyword}
          followUps={res.followUps}
          onFollowUp={onFollowUp}
        />
      )}

      {(res.summary || res.result) && (
        <button
          type="button"
          onClick={() => exportAnswerToHtml({ question, res, period, scopes })}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-spark-border bg-white text-[12px] font-semibold text-spark-ink-soft hover:text-spark-purple hover:border-spark-purple/30 transition"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
            <path d="M8 2v7M8 9L5 6M8 9l3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.5 11v2.5h11V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          HTML로 저장
        </button>
      )}
    </div>
  );
}

/** 이 답변이 어떤 질문에 대한 것인지 — 바로 앞의 사용자 메시지 */
function lastQuestionBefore(messages: Msg[], index: number): string {
  for (let i = index - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.text;
  }
  return 'SparkScope 리포트';
}

/** 조회 결과 — DB 집계 + 기사 목록 */
/**
 * 근거 기사를 매체명이 아니라 주제 태그(matchedKeyword — 회사명 또는 해외 트렌드의
 * topicSector)로 묶는다. 예전엔 그냥 최신순으로 쭉 나열만 해서, 특히 해외 트렌드처럼
 * 여러 주제가 섞인 결과는 "신약발굴 12건, 항암 8건..."처럼 한눈에 안 들어왔다(2026-08-11
 * 실사용 피드백). 묶어도 의미가 없는 경우(태그가 하나뿐이거나, 다들 태그가 제각각이라
 * 묶음 하나에 기사 1건씩만 있는 경우)엔 null을 돌려줘서 호출부가 기존 평범한 목록으로
 * 그대로 보여주게 한다.
 */
/**
 * 근거 기사를 두 갈래로 나눈다.
 * - 주제 태그(topic, 예: 신약발굴·항암): 여러 기사가 같은 값을 공유하는 경우가 많아
 *   그룹으로 묶는 게 유용하다. 그대로 접었다 펼 수 있는 섹션으로 보여준다.
 * - 회사 태그(company): 해외 트렌드는 엮인 포폴사 조합을 콤마로 이어붙이는데("스카이랩스,
 *   엘리스헬스케어" vs "스카이랩스, 엘리스헬스케어, 크레파스솔루션"), 조합이 기사마다 거의
 *   다 달라서 그룹으로 묶으면 1건짜리 그룹이 잔뜩 생겨 오히려 안 읽힌다(2026-08-12 실사용
 *   피드백). 그룹으로 묶지 않고 그냥 목록으로 보여주되, 기사마다 관련 회사를 칩(배지)으로
 *   붙여서 "이 기사가 어느 회사와 관련 있는지"만 바로 보이게 한다.
 */
function organizeArticles(articles: ChatQueryResult['articles']): {
  topics: { tag: string; items: ChatQueryResult['articles'] }[];
  companies: { tag: string; items: ChatQueryResult['articles'] }[];
  companyArticles: ChatQueryResult['articles'];
} {
  const topicGroups = new Map<string, ChatQueryResult['articles']>();
  const companyGroups = new Map<string, ChatQueryResult['articles']>();
  const companyTagged: ChatQueryResult['articles'] = [];
  for (const a of articles) {
    if (a.tagKind === 'topic') {
      const tag = a.matchedKeyword || '기타';
      if (!topicGroups.has(tag)) topicGroups.set(tag, []);
      topicGroups.get(tag)!.push(a);
    } else {
      companyTagged.push(a);
      // matchedKeyword는 "루센트블록" 하나일 수도, "차차, 원티드랩"처럼 여러 개일 수도 있다.
      // 예전엔 이 문자열 전체(조합)를 그룹 키로 써서 회사 조합이 겹치는 경우가 드물어
      // 대부분 1건짜리 그룹으로 쪼개졌다(2026-08-12 실사용 피드백으로 한 번 되돌림). 회사
      // 이름 하나하나를 키로 쓰면 조합이 아니라 실제 회사 단위로 묶여서, 기사가 회사를
      // 여러 개 언급해도 각 회사 그룹에 다 들어간다(중복 노출은 허용 — 주제 태그 그룹과 같은 방식).
      const names = (a.matchedKeyword || '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        if (!companyGroups.has(name)) companyGroups.set(name, []);
        companyGroups.get(name)!.push(a);
      }
    }
  }
  const topics = [...topicGroups.entries()]
    .map(([tag, items]) => ({ tag, items }))
    .filter((g) => g.items.length > 1) // 1건짜리 주제 그룹도 묶는 의미가 없으니 목록으로 내림
    .sort((a, b) => b.items.length - a.items.length);
  const companies = [...companyGroups.entries()]
    .map(([tag, items]) => ({ tag, items }))
    .filter((g) => g.items.length > 1) // 그 회사 기사가 1건뿐이면 묶을 의미가 없으니 목록으로 내림
    .sort((a, b) => b.items.length - a.items.length);

  const groupedTopicIds = new Set(topics.flatMap((g) => g.items.map((a) => a.id)));
  const groupedCompanyIds = new Set(companies.flatMap((g) => g.items.map((a) => a.id)));

  return {
    topics,
    companies,
    companyArticles: [
      ...companyTagged.filter((a) => !groupedCompanyIds.has(a.id)),
      ...articles.filter((a) => a.tagKind === 'topic' && !groupedTopicIds.has(a.id)),
    ],
  };
}

// riskFlag는 DB엔 litigation/crisis/controversy 코드값으로만 있고 화면엔 그냥 "⚠"
// 아이콘만 떠서 무슨 뜻인지 알 수가 없었다(2026-08-12 피드백) — 뭘 의미하는지 바로 읽히게
// 배지에 한글 라벨을 붙이고, 마우스를 올리면 더 풀어서 설명한다.
const RISK_FLAG_LABEL: Record<string, string> = {
  litigation: '소송·규제',
  crisis: '사고·재무',
  controversy: '논란·평판',
};
const RISK_FLAG_EXPLAIN: Record<string, string> = {
  litigation: '소송·수사·규제 이슈로 AI가 위험 신호를 표시한 기사예요',
  crisis: '사고·재무 관련 이슈로 AI가 위험 신호를 표시한 기사예요',
  controversy: '논란·평판 이슈로 AI가 위험 신호를 표시한 기사예요',
};

/** 근거 기사 목록의 행 하나. showCompanyTags=true면 관련 회사를 칩(배지)으로 따로 붙인다. */
function ArticleRow({ a, fmtDate, showCompanyTags }: { a: ChatQueryResult['articles'][number]; fmtDate: (iso: string) => string; showCompanyTags?: boolean }) {
  // 주제 태그(tagKind==='topic')는 회사명이 아니다 — "🏢 관련 포트폴리오사: 스타트업"처럼
  // 잘못 붙는 걸 막는다. 그룹으로 안 묶여 "그 외 매칭된 기사" 목록에 떨어져도 마찬가지로 막는다
  // (2026-08-12 피드백 — 피칭 결과의 업계동향 기사에서 실제로 발생).
  const companyTags =
    showCompanyTags && a.tagKind !== 'topic' && a.matchedKeyword
      ? a.matchedKeyword.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const isLive = a.category === 'live';
  return (
    <li>
      <a href={a.link} target="_blank" rel="noreferrer" className={`block px-4 py-3 transition ${isLive ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-spark-subtle'}`}>
        <div className="flex items-start gap-2">
          <span className="text-[14px] text-spark-ink leading-snug">{a.title}</span>
          {a.tone === 'NEGATIVE' && (
            <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-bold">부정</span>
          )}
          {a.riskFlag && (
            <span
              className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold"
              title={RISK_FLAG_EXPLAIN[a.riskFlag] ?? '위험 신호로 표시된 기사예요'}
            >
              ⚠ {RISK_FLAG_LABEL[a.riskFlag] ?? '위험'}
            </span>
          )}
        </div>
        <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-[11px] ${isLive ? 'font-semibold text-blue-700' : 'text-spark-muted'}`}>
          <span>{a.source}</span>
          <span>·</span>
          <span>{fmtDate(a.pubDate)}</span>
          <span>·</span>
          <span>{categoryLabel(a.category)}</span>
        </div>
        {a.oneLiner && (
          <div className="mt-2 px-2.5 py-1.5 bg-blue-50 border-l-2 border-blue-400 rounded">
            <p className="text-[12px] text-blue-900 leading-relaxed">💡 {a.oneLiner}</p>
          </div>
        )}
        {companyTags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-spark-muted">🏢 관련 포트폴리오사</span>
            {companyTags.map((c) => (
              <span key={c} className="px-1.5 py-0.5 rounded-md bg-spark-light-purple text-spark-purple text-[10px] font-semibold">
                {c}
              </span>
            ))}
          </div>
        )}
      </a>
    </li>
  );
}

function ChatResult({
  result,
  scopes,
  asTable,
  resultKind,
  loading,
  onLiveSearch,
  onSuggestedKeyword,
  followUps,
  onFollowUp,
}: {
  result: ChatQueryResult;
  scopes: string[];
  asTable?: boolean;
  resultKind?: ResultKind;
  loading?: boolean;
  onLiveSearch?: (keyword: string) => void;
  onSuggestedKeyword?: (keyword: string) => void;
  followUps?: string[] | null;
  onFollowUp?: (question: string) => void;
}) {
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const organized = asTable ? null : organizeArticles(result.articles);

  // 유사 키워드 추천 — 현재 검색어와 다르면서 자주 나온 키워드들
  const keywordFreq = new Map<string, number>();
  result.articles.forEach(a => {
    if (a.matchedKeyword) {
      a.matchedKeyword.split(',').forEach(k => {
        const keyword = k.trim();
        if (keyword && !result.terms.includes(keyword)) {
          keywordFreq.set(keyword, (keywordFreq.get(keyword) || 0) + 1);
        }
      });
    }
  });
  const suggestedKeywords = Array.from(keywordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);

  return (
    <div className="w-full space-y-2.5">
      {(result.terms.length > 0 || scopes.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-spark-muted">
          {scopes.map((sc) => (
            <span key={sc} className="px-2 py-0.5 rounded-md bg-spark-light-purple text-spark-purple font-semibold">
              {SCOPE_LABEL[sc as keyof typeof SCOPE_LABEL] ?? sc}
            </span>
          ))}
          {result.terms.length > 0 && <span>검색어: {result.terms.join(' · ')}</span>}
        </div>
      )}

      {/* 집계 */}
      <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
          <span className="text-2xl font-extrabold text-spark-ink">{result.total.toLocaleString()}건</span>
          <span className="text-[13px] text-spark-muted">{result.periodLabel} 기준</span>
          {typeof result.prevTotal === 'number' && (
            <span
              className="px-1.5 py-0.5 rounded-md text-[12px] font-semibold bg-spark-subtle text-spark-ink-soft"
              title={result.deltaCaution ?? '같은 길이의 직전 기간 건수'}
            >
              직전 기간 {result.prevTotal.toLocaleString()}건{result.deltaCaution ? ' ⚠' : ''}
            </span>
          )}
          {result.negativeCount > 0 && (
            <span className="ml-auto text-[12px] font-semibold text-red-600">
              부정 톤 {result.negativeCount}건
            </span>
          )}
        </div>

        {(result.deltaCaution || result.deltaUnavailableReason) && (
          <p className="-mt-1 mb-2 text-[11px] text-spark-muted">
            ⚠ {result.deltaCaution ?? result.deltaUnavailableReason}
          </p>
        )}

        {result.total === 0 ? (
          <p className="text-[14px] text-spark-ink-soft">
            조건에 맞는 기사가 없어요. 기간을 넓히거나 검색어를 줄여보세요.
          </p>
        ) : (
          <div className="grid sm:grid-cols-3 gap-3 text-[13px]">
            <StatList
              title="분류"
              items={result.byCategory.map((c) => ({ name: categoryLabel(c.category), count: c.count }))}
            />
            <StatList title="많이 나온 회사·키워드" items={result.topCompanies} />
            <StatList title="매체" items={result.topSources} />
          </div>
        )}
      </div>

      {/* 다음 질문 제안 — 유사 키워드(자주 나온 회사·키워드, 클라이언트에서 집계)와
          후속 질문(방금 답변 맥락에서 모델이 뽑은 질문)을 한 상자에 같이 보여준다.
          예전엔 두 상자가 따로 떠서 "다음에 뭘 물어볼지 제안"하는 비슷한 목적의 상자가
          답변 하나에 중복으로 보였다(2026-08-13 피드백). 키워드를 누르면 바로 실시간
          검색이 아니라 먼저 우리 DB로 검색해서 보여준다 — 결과가 적으면 그 밑에 뜨는
          "실시간 검색할까요?"를 따로 눌러야 실시간 검색으로 넘어간다(2026-08-13 피드백 —
          실시간부터 바로 가면 DB에 있는 결과를 건너뛰게 된다). */}
      {(suggestedKeywords.length > 0 || (!loading && followUps && followUps.length > 0)) && (
        <div className="p-4 bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300 rounded-2xl">
          <p className="text-[13px] text-purple-900 font-bold mb-3">🔗 이것도 물어보시겠어요?</p>
          <div className="flex flex-wrap gap-2">
            {suggestedKeywords.map(kw => (
              <button
                key={`kw-${kw}`}
                onClick={() => onSuggestedKeyword?.(kw)}
                className="px-3 py-2 bg-white hover:bg-purple-50 border border-purple-300 text-purple-900 text-[12px] font-semibold rounded-lg transition shadow-sm hover:shadow-md"
              >
                {kw}
              </button>
            ))}
            {!loading && followUps?.map(q => (
              <button
                key={`fu-${q}`}
                onClick={() => onFollowUp?.(q)}
                className="px-3 py-2 bg-white hover:bg-purple-50 border border-purple-300 text-purple-900 text-[12px] font-medium rounded-lg transition shadow-sm hover:shadow-md"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 실시간 검색 제안 — 결과가 8건 미만이면 구글뉴스·네이버뉴스에서 추가 검색할 수 있다 */}
      {result.needsLiveSearch && !loading && onLiveSearch && (
        <div className="flex flex-col gap-2 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <p className="text-[13px] text-amber-900">
            검색 결과가 많지 않네요. 우리 DB에 아직 수집되지 않은 최신 기사를 실시간으로 찾아볼까요?
          </p>
          <button
            type="button"
            onClick={() => onLiveSearch(result.terms?.[0] || '')}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition text-[13px]"
          >
            🔍 실시간 검색 ({result.terms?.[0]})
          </button>
        </div>
      )}

      {/* 지표·추이 질문은 숫자 목록보다 달마다 막대가 나란히 놓인 그래프가 흐름이 한눈에
          들어온다 — 예전엔 이 데이터(monthly)가 HTML로 저장할 때만 그래프로 보였고 채팅
          화면에는 아예 안 나왔다(2026-08-12). */}
      {resultKind === 'trend' && result.monthly && result.monthly.length > 0 && (
        <TrendChart items={result.monthly} granularity={result.trendGranularity ?? 'month'} />
      )}

      {/* 키워드·노이즈 질문은 "왜 오탐인지" 판단할 근거(오탐 예시·현재 설정)까지 표로 한눈에
          봐야 바로 조치할 수 있다 — 이것도 예전엔 HTML 저장 때만 표로 보였다(2026-08-12). */}
      {resultKind === 'noise' && result.noisyKeywords && result.noisyKeywords.length > 0 && (
        <NoiseKeywordTable rows={result.noisyKeywords} />
      )}

      {/* "요즘 여론 어때?" 같은 톤 질문은 부정 건수 하나보다 긍정/중립/부정 비율이 한눈에
          보이는 도넛차트가 더 직관적이다(2026-08-12). trend·noise는 이미 전용 그래프가
          있으니 일반 검색(search) 결과에서만 보여준다. */}
      {resultKind === 'search' &&
        (result.positiveCount ?? 0) + (result.neutralCount ?? 0) + result.negativeCount > 0 && (
          <ToneDonutChart
            positive={result.positiveCount ?? 0}
            neutral={result.neutralCount ?? 0}
            negative={result.negativeCount}
          />
        )}

      {/* "요즘 어떤 기사가 많아?"처럼 분류 구성을 묻는 질문은 숫자 나열보다 비율이 한눈에
          보이는 도넛차트가 더 직관적이다(2026-08-12). 분류가 2개 이상 섞여 있을 때만 의미가
          있다 — 검색 범위를 하나로 좁혔으면(예: 포트폴리오사만) 어차피 100%라 그릴 필요 없다. */}
      {resultKind === 'search' && result.byCategory.filter((c) => c.count > 0).length > 1 && (
        <CategoryDonutChart items={result.byCategory} />
      )}

      {/* "어디서 많이 나왔어?" 같은 회사·매체 비교는 목록보다 막대 길이로 바로 비교되는 게
          낫다(2026-08-12). 3곳 미만이면 굳이 그래프까지 필요 없어 텍스트 목록으로 충분하다. */}
      {resultKind === 'search' && result.topCompanies.length >= 3 && (
        <CompanyBarChart title="많이 나온 회사·키워드" items={result.topCompanies} />
      )}

      {/* 피칭 소재는 산점도로 시도했다가 사용자 피드백으로 뺐다(2026-08-12) — 이미 70점
          이상만 걸러진 상위권이라 세로축이 좁은 구간에 다 몰려서 못 읽었다. 순위가 궁금한
          데이터엔 관계보다 "1등부터 몇 등까지" 막대그래프가 바로 읽힌다. */}
      {resultKind === 'pitch' && result.articles.some((a) => a.pitchScore != null) && (
        <PitchScoreBarChart articles={result.articles} />
      )}

      {/* 기사 목록 */}
      {result.articles.length > 0 && (
        <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-spark-border text-[13px] font-semibold text-spark-ink-soft">
            근거 기사 {result.articles.length}건 {result.total > result.articles.length && `(전체 ${result.total}건 중)`}
          </div>
          {asTable ? (
            // '표로 정리' — 보고서에 그대로 붙여넣기 좋은 형태
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="bg-spark-subtle text-spark-muted text-[11px]">
                    <th className="text-left font-semibold px-3 py-2">회사·키워드</th>
                    <th className="text-left font-semibold px-3 py-2">제목</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">매체</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">날짜</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">톤</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-spark-border">
                  {result.articles.map((a) => (
                    <tr key={a.id} className="hover:bg-spark-subtle transition align-top">
                      <td className="px-3 py-2 whitespace-nowrap font-semibold text-spark-purple">
                        {a.matchedKeyword || '-'}
                      </td>
                      <td className="px-3 py-2">
                        <a href={a.link} target="_blank" rel="noreferrer" className="text-spark-ink hover:underline">
                          {a.title}
                        </a>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-spark-ink-soft">{a.source}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-spark-muted">{fmtDate(a.pubDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {a.tone === 'NEGATIVE' ? (
                          <span className="text-red-600 font-semibold">부정</span>
                        ) : a.tone === 'POSITIVE' ? (
                          <span className="text-blue-600 font-semibold">긍정</span>
                        ) : (
                          <span className="text-spark-muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : organized ? (
            <div className="divide-y divide-spark-border">
              {/* 같은 포트폴리오사 기사끼리 묶는다 — 예전엔 회사 "조합"(예: "차차, 원티드랩")을
                  통째로 그룹 키로 써서 조합이 겹치는 경우가 드물어 1건짜리 그룹만 잔뜩 생겼다
                  (2026-08-12 이전 피드백으로 한 번 되돌림). 지금은 회사 이름 하나하나를 키로
                  묶어서 실제 회사 단위 클러스터링이 되고, 기사가 회사를 여러 개 언급하면 각
                  회사 그룹에 중복으로 들어간다(주제 태그 그룹과 같은 방식, 2026-08-12). */}
              {organized.companies.map((g) => (
                <details key={g.tag} open={organized.companies.length <= 4} className="group">
                  <summary className="list-none flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer hover:bg-spark-subtle transition select-none">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-spark-purple">
                      <span>🏢</span>
                      {g.tag}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-spark-muted">
                      {g.items.length}건
                      <span className="transition-transform group-open:rotate-180">▾</span>
                    </span>
                  </summary>
                  <ul className="divide-y divide-spark-border border-t border-spark-border">
                    {g.items.map((a) => (
                      <ArticleRow key={a.id} a={a} fmtDate={fmtDate} showCompanyTags />
                    ))}
                  </ul>
                </details>
              ))}
              {/* 위 회사 그룹에 안 묶인 기사(그 회사 기사가 1건뿐이거나 회사 태그가 아예 없는 경우) —
                  묶어도 의미 없는 1건짜리 그룹을 강제로 만들지 않고 그냥 목록으로 보여준다. */}
              {organized.companyArticles.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[11px] font-semibold text-spark-muted bg-spark-subtle/60">
                    🏢 그 외 매칭된 기사 {organized.companyArticles.length}건
                  </div>
                  <ul className="divide-y divide-spark-border">
                    {organized.companyArticles.map((a) => (
                      <ArticleRow key={a.id} a={a} fmtDate={fmtDate} showCompanyTags />
                    ))}
                  </ul>
                </div>
              )}
              {/* 주제 태그(신약발굴·항암 등)는 여러 기사가 값을 공유해서 묶는 게 유용하다 — 접었다 펼 수 있게. */}
              {organized.topics.map((g) => (
                <details key={g.tag} open={organized.topics.length <= 4} className="group">
                  <summary className="list-none flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer hover:bg-spark-subtle transition select-none">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-spark-purple">
                      <span>📌</span>
                      <span className="text-[10px] font-normal text-spark-muted">주제</span>
                      {g.tag}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-spark-muted">
                      {g.items.length}건
                      <span className="transition-transform group-open:rotate-180">▾</span>
                    </span>
                  </summary>
                  <ul className="divide-y divide-spark-border border-t border-spark-border">
                    {g.items.map((a) => (
                      <ArticleRow key={a.id} a={a} fmtDate={fmtDate} />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-spark-border">
              {result.articles.map((a) => (
                <ArticleRow key={a.id} a={a} fmtDate={fmtDate} showCompanyTags />
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] text-spark-muted">수집된 기사 DB 조회 결과입니다</p>
    </div>
  );
}

/**
 * 추이 차트 — granularity에 따라 그리는 방식을 바꾼다(2026-08-12).
 * - 'month'(기간을 월/분기/전체로 골랐을 때, 최근 6개월치): 몇 안 되는 점이 어느 방향으로
 *   움직이는지가 중요하므로 선그래프.
 * - 'day'(기간을 오늘·이번 주로 골랐을 때, 최근 14일치): 날짜라는 범주별 비교라 막대그래프가
 *   하루하루 건수를 비교하기 쉽다. (연속값 구간을 나눈 히스토그램과는 다름 — 여기선 안 씀.)
 */
function TrendChart({ items, granularity }: { items: { month: string; count: number }[]; granularity: 'day' | 'month' }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  const W = 640;
  const H = 180;
  const padL = 8;
  const padB = 26;
  const padT = 22;
  const chartW = W - padL * 2;
  const chartH = H - padT - padB;
  const n = items.length;
  const gap = chartW / n;
  const title = granularity === 'day' ? '일별 추이 (최근 14일)' : '월별 추이 (최근 6개월)';
  const label = (raw: string) => {
    if (granularity === 'day') {
      const [m, d] = raw.split('-');
      return m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : raw;
    }
    const [, m] = raw.split('-');
    return m ? `${parseInt(m, 10)}월` : raw;
  };

  if (granularity === 'day') {
    const barW = Math.min(28, gap * 0.6);
    return (
      <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card p-4">
        <div className="text-[13px] font-semibold text-spark-ink-soft mb-2">{title}</div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}>
          <line x1={padL} y1={padT + chartH} x2={W - padL} y2={padT + chartH} stroke="#E7E3DB" strokeWidth={1} />
          {items.map((it, i) => {
            const h = Math.round((it.count / max) * chartH);
            const x = padL + gap * i + (gap - barW) / 2;
            const y = padT + (chartH - h);
            return (
              <g key={it.month}>
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx={2} fill="#5046E5" opacity={it.count > 0 ? 0.82 : 0.18} />
                {it.count > 0 && (
                  <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#514E5C">
                    {it.count.toLocaleString()}
                  </text>
                )}
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="#8B8894">
                  {label(it.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // 선그래프
  const points = items.map((it, i) => {
    const x = padL + gap * i + gap / 2;
    const y = padT + (chartH - Math.round((it.count / max) * chartH));
    return { x, y, it };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;

  return (
    <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card p-4">
      <div className="text-[13px] font-semibold text-spark-ink-soft mb-2">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}>
        <line x1={padL} y1={padT + chartH} x2={W - padL} y2={padT + chartH} stroke="#E7E3DB" strokeWidth={1} />
        <path d={areaPath} fill="#5046E5" opacity={0.08} stroke="none" />
        <path d={linePath} fill="none" stroke="#5046E5" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => (
          <g key={p.it.month}>
            <circle cx={p.x} cy={p.y} r={4} fill="#5046E5" />
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#514E5C">
              {p.it.count.toLocaleString()}
            </text>
            <text x={p.x} y={H - 8} textAnchor="middle" fontSize={11} fill="#8B8894">
              {label(p.it.month)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** 긍정/중립/부정 톤 비율 도넛차트 — TrendChart와 같은 SVG 인라인 패턴. */
function ToneDonutChart({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total = positive + neutral + negative;
  if (total === 0) return null;
  const R = 54;
  const C = 2 * Math.PI * R;
  const SEGMENTS = [
    { label: '긍정', value: positive, color: '#16A34A' },
    { label: '중립', value: neutral, color: '#8B8894' },
    { label: '부정', value: negative, color: '#DC2626' },
  ];
  let cursor = 0;
  const arcs = SEGMENTS.filter((s) => s.value > 0).map((s) => {
    const dash = (s.value / total) * C;
    const arc = { ...s, dash, offset: -cursor };
    cursor += dash;
    return arc;
  });

  return (
    <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card p-4">
      <div className="text-[13px] font-semibold text-spark-ink-soft mb-2">톤 분포</div>
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label="긍정·중립·부정 톤 비율">
          <g transform="translate(70,70) rotate(-90)">
            <circle r={R} cx={0} cy={0} fill="none" stroke="#EDEAE2" strokeWidth={20} />
            {arcs.map((a) => (
              <circle
                key={a.label}
                r={R}
                cx={0}
                cy={0}
                fill="none"
                stroke={a.color}
                strokeWidth={20}
                strokeDasharray={`${a.dash} ${C - a.dash}`}
                strokeDashoffset={a.offset}
              />
            ))}
          </g>
          <text x={70} y={66} textAnchor="middle" fontSize={20} fontWeight={800} fill="#2A2830">
            {total.toLocaleString()}
          </text>
          <text x={70} y={84} textAnchor="middle" fontSize={11} fill="#8B8894">
            건
          </text>
        </svg>
        <div className="flex flex-col gap-1.5 text-[12px]">
          {SEGMENTS.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-spark-ink-soft font-medium">{s.label}</span>
              <span className="text-spark-muted">
                {s.value.toLocaleString()}건 ({Math.round((s.value / total) * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 회사·매체 등 상위 N개 비교용 가로 막대그래프 — StatList의 미니바보다 축·수치가 또렷한
 *  전용 그래프 카드가 필요할 때(항목이 3개 이상) 쓴다. */
function CompanyBarChart({ title, items }: { title: string; items: { name: string; count: number }[] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card p-4">
      <div className="text-[13px] font-semibold text-spark-ink-soft mb-3">{title}</div>
      <div className="space-y-2.5">
        {items.map((i) => (
          <div key={i.name} className="flex items-center gap-2.5 text-[12px]">
            <span className="w-24 shrink-0 truncate text-spark-ink-soft" title={i.name}>
              {i.name}
            </span>
            <div className="flex-1 h-4 rounded-md bg-spark-subtle overflow-hidden">
              <div
                className="h-full rounded-md bg-spark-purple flex items-center justify-end px-1.5"
                style={{ width: `${Math.max((i.count / max) * 100, 8)}%` }}
              >
                <span className="text-[10px] font-bold text-white">{i.count}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 피칭 점수 순위 막대그래프 — 산점도는 이미 70점 이상만 걸러진 데이터라 세로축이
 *  좁은 구간에 몰려 못 읽힌다는 피드백으로 교체했다(2026-08-12). "1등부터 몇 등까지"가
 *  궁금한 데이터라 절대 점수(0~100점 기준)를 막대 길이로 바로 비교되게 한다. */
function PitchScoreBarChart({ articles }: { articles: ChatQueryResult['articles'] }) {
  const points = articles
    .filter((a): a is ChatArticle & { pitchScore: number } => typeof a.pitchScore === 'number')
    .slice(0, 10);
  if (points.length === 0) return null;

  return (
    <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card p-4">
      <div className="text-[13px] font-semibold text-spark-ink-soft mb-3">피칭 점수 순위</div>
      <div className="space-y-2.5">
        {points.map((p) => (
          <div key={p.id} className="flex items-center gap-2.5 text-[12px]">
            <span className="w-40 shrink-0 truncate text-spark-ink-soft" title={p.title}>
              {p.matchedKeyword ? `[${p.matchedKeyword}] ` : ''}
              {p.title}
            </span>
            <div className="flex-1 h-4 rounded-md bg-spark-subtle overflow-hidden">
              <div
                className="h-full rounded-md bg-spark-purple flex items-center justify-end px-1.5"
                style={{ width: `${Math.max(Math.min(p.pitchScore, 100), 6)}%` }}
              >
                <span className="text-[10px] font-bold text-white">{p.pitchScore}점</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 오탐 많은 키워드 표 — HTML 저장(chat-export.ts)의 noiseTable()과 같은 정보를 채팅 화면에도 보여준다. */
function NoiseKeywordTable({ rows }: { rows: NonNullable<ChatQueryResult['noisyKeywords']> }) {
  return (
    <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-spark-border text-[13px] font-semibold text-spark-ink-soft">
        오탐 많은 키워드 {rows.length}개
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="bg-spark-subtle text-spark-muted text-[11px]">
              <th className="text-left font-semibold px-3 py-2">키워드</th>
              <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">상태</th>
              <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">오탐</th>
              <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">정상</th>
              <th className="text-left font-semibold px-3 py-2">현재 설정</th>
              <th className="text-left font-semibold px-3 py-2">오탐 예시</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-spark-border">
            {rows.map((r) => (
              <tr key={r.name} className="align-top hover:bg-spark-subtle transition">
                <td className="px-3 py-2 font-semibold text-spark-purple whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.status === 'ACTIVE' ? (
                    <span className="px-1.5 py-0.5 rounded-md bg-spark-subtle text-spark-muted text-[11px] font-semibold">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 text-[11px] font-semibold">
                      {r.status ?? 'UNKNOWN'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-bold text-spark-ink whitespace-nowrap">{r.noise.toLocaleString()}건</td>
                <td className="px-3 py-2 text-spark-muted whitespace-nowrap">{r.kept.toLocaleString()}건</td>
                <td className="px-3 py-2 text-spark-muted text-[12px]">
                  {r.current?.contextWords && <div>문맥어: {r.current.contextWords}</div>}
                  {r.current?.excludeWords && <div>제외어: {r.current.excludeWords}</div>}
                  {!r.current?.contextWords && !r.current?.excludeWords && '없음'}
                </td>
                <td className="px-3 py-2 text-spark-muted text-[12px]">
                  {(r.samples ?? []).slice(0, 3).map((s, i) => (
                    <div key={i}>{s}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatList({ title, items }: { title: string; items: { name: string; count: number }[] }) {
  if (!items.length) return null;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="bg-spark-subtle border border-spark-border rounded-xl px-3 py-2.5">
      <div className="text-[11px] font-semibold text-spark-muted mb-1.5">{title}</div>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.name}>
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="truncate text-spark-ink-soft">{i.name}</span>
              <span className="shrink-0 font-bold text-spark-ink">{i.count}</span>
            </div>
            <div className="h-1 rounded-full bg-spark-border/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-spark-purple/50"
                style={{ width: `${Math.max((i.count / max) * 100, 4)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 카테고리(스파크랩·포폴사·경쟁사·업계동향) 비율 도넛차트 — ToneDonutChart와 같은 SVG 패턴.
 * "요즘 어떤 기사가 많아?" 같은 질문은 숫자 목록보다 비율이 한눈에 보이는 게 낫다(2026-08-12). */
const CATEGORY_COLOR: Record<string, string> = {
  sparklabs_self: '#5046E5',
  portfolio_company: '#16A34A',
  competitor: '#F59E0B',
  industry_trend: '#3B82F6',
  executive: '#EC4899',
  live: '#8B8894',
};
const CATEGORY_COLOR_FALLBACK = '#8B8894';

function CategoryDonutChart({ items }: { items: { category: string; count: number }[] }) {
  const total = items.reduce((sum, i) => sum + i.count, 0);
  if (total === 0) return null;
  const R = 54;
  const C = 2 * Math.PI * R;
  const segments = items
    .filter((i) => i.count > 0)
    .map((i) => ({ label: categoryLabel(i.category), value: i.count, color: CATEGORY_COLOR[i.category] ?? CATEGORY_COLOR_FALLBACK }));
  let cursor = 0;
  const arcs = segments.map((s) => {
    const dash = (s.value / total) * C;
    const arc = { ...s, dash, offset: -cursor };
    cursor += dash;
    return arc;
  });

  return (
    <div className="bg-spark-surface border border-spark-border rounded-2xl shadow-card p-4">
      <div className="text-[13px] font-semibold text-spark-ink-soft mb-2">분류 비율</div>
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label="분류별 기사 비율">
          <g transform="translate(70,70) rotate(-90)">
            <circle r={R} cx={0} cy={0} fill="none" stroke="#EDEAE2" strokeWidth={20} />
            {arcs.map((a) => (
              <circle
                key={a.label}
                r={R}
                cx={0}
                cy={0}
                fill="none"
                stroke={a.color}
                strokeWidth={20}
                strokeDasharray={`${a.dash} ${C - a.dash}`}
                strokeDashoffset={a.offset}
              />
            ))}
          </g>
          <text x={70} y={66} textAnchor="middle" fontSize={20} fontWeight={800} fill="#2A2830">
            {total.toLocaleString()}
          </text>
          <text x={70} y={84} textAnchor="middle" fontSize={11} fill="#8B8894">
            건
          </text>
        </svg>
        <div className="flex flex-col gap-1.5 text-[12px]">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-spark-ink-soft font-medium">{s.label}</span>
              <span className="text-spark-muted">
                {s.value.toLocaleString()}건 ({Math.round((s.value / total) * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** SparkScope 로고 마크 — 대시보드 상단 로고(보라 사각형 + S)의 큰 버전 */
function SparkScopeMark({ size = 'lg' }: { size?: 'lg' | 'sm' | 'xs' }) {
  const box = size === 'lg' ? 'w-20 h-20' : size === 'sm' ? 'w-7 h-7' : 'w-8 h-8 shrink-0';
  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 96 96" className={box} aria-label="SparkScope">
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
      {size === 'lg' && (
        <span className="text-[13px] font-extrabold tracking-[0.14em] text-spark-purple">SPARKSCOPE</span>
      )}
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
