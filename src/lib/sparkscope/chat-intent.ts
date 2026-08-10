// 질문 이해(intent parsing) — 규칙 기반 키워드 추출로는 못 잡는 것들을 LLM으로 구조화한다.
//
// 규칙 기반의 한계: "PDF로 리포트 만들어줘"는 검색어가 아니라 '요청'인데
// 단어만 뽑으면 'PDF'로 기사를 검색해버린다. 여기서 의도·기간·범위·산출물을 함께 뽑아
// 검색이 필요한 질문만 DB로 넘긴다.
//
// LLM 호출이 실패하거나 키가 없으면 규칙 기반으로 조용히 되돌아간다(작동은 계속된다).
import OpenAI from 'openai';
import { extractTerms } from './chat-query';
import type { ChatPeriod, ChatScope } from './chat-types';

const MODEL = 'gpt-5.4-mini';

export type ChatIntent = {
  /** search=기사 찾기, stats=수치·추이, risk=위기·부정, inter=해외 트렌드,
   *  report=요약·리포트 작성, manage=키워드·노이즈 설정, smalltalk=잡담·사용법 */
  kind: 'search' | 'stats' | 'risk' | 'inter' | 'report' | 'manage' | 'smalltalk';
  /** DB에서 제목·키워드로 찾을 검색어 (없으면 전체 조회) */
  terms: string[];
  /** 질문에 기간 표현이 있으면 그걸로 덮어쓴다 ("지난주" → week) */
  period: ChatPeriod | null;
  /** 질문에 범위 표현이 있으면 덮어쓴다 ("포폴사만" → portfolio) */
  scopes: ChatScope[];
  /** 기사 조회가 필요한 질문인가 */
  needsArticles: boolean;
  /** 아직 지원하지 않는 산출물 요청(PDF·PPT 파일 생성, 메일 발송 등) */
  unsupported: string | null;
  /** 사용자에게 먼저 건넬 한 줄 (지원 안 되는 요청일 때 특히) */
  note: string | null;
};

const SYSTEM = `너는 스파크랩(초기투자 VC)의 뉴스 모니터링 시스템 "스파크스코프"의 질문 분석기다.
사용자 질문을 읽고 JSON만 출력한다. 설명·마크다운 금지.

시스템이 가진 데이터: 국내 뉴스 기사 DB(제목·매체·발행일·분류·톤·매칭 키워드).
분류는 스파크랩 자사, 포트폴리오사, 경쟁 VC, 업계동향이다.

필드:
- kind: search | stats | risk | inter | report | manage | smalltalk
  search=특정 기사 찾기, stats=건수·순위·추이 같은 수치, risk=부정/위기/리스크,
  inter=해외·글로벌 트렌드, report=요약·정리·보고서 작성, manage=키워드/노이즈 설정 관련,
  smalltalk=인사·사용법 질문
- terms: DB 제목 검색에 쓸 핵심어 배열(최대 5개). 회사명·기술·이벤트 같은 명사만.
  "PDF", "리포트", "정리해줘", "알려줘" 같은 요청·형식 단어는 절대 넣지 마라.
  검색어가 필요 없으면 빈 배열.
- period: today | week | month | quarter | all | null  (질문에 기간 표현이 있을 때만, 없으면 null)
- scopes: portfolio | competitor | sparklabs | inter 중 질문이 명시한 것만. 없으면 빈 배열.
- needsArticles: 기사 조회가 필요하면 true (인사·사용법 질문이면 false)
- unsupported: 아직 못 하는 요청이면 그 내용을 한글로. 못 하는 것 = 파일 생성(PDF/PPT/엑셀 다운로드),
  메일 발송, 키워드 DB 수정, 외부 웹 검색. 아니면 null
- note: 사용자에게 먼저 알려줄 한 문장(없으면 null)

예)
"PDF로 리포트 만들어줘" →
{"kind":"report","terms":[],"period":null,"scopes":[],"needsArticles":true,"unsupported":"PDF 파일 생성","note":"PDF 파일로 만들어 드리는 건 아직 안 되고, 리포트 내용을 화면에 정리해 드릴게요."}
"지난주 포폴사 투자유치 기사" →
{"kind":"search","terms":["투자유치"],"period":"week","scopes":["portfolio"],"needsArticles":true,"unsupported":null,"note":null}`;

// LLM이 가끔 흘리는 일반명사 — 제목 검색에 넣으면 결과만 좁아진다.
const GENERIC = new Set([
  '소식', '내용', '현황', '동향', '정보', '자료', '리포트', '보고서', '요약', '정리',
  '기사', '뉴스', '보도', '기간', '최근', '트렌드', '이슈', '상황', '결과',
]);

const PERIODS = ['today', 'week', 'month', 'quarter', 'all'];
const SCOPES = ['portfolio', 'competitor', 'sparklabs', 'inter'];

/** LLM 실패·키 없음일 때 쓰는 기존 규칙 기반 경로 */
function fallback(question: string): ChatIntent {
  return {
    kind: 'search',
    terms: extractTerms(question),
    period: null,
    scopes: [],
    needsArticles: true,
    unsupported: null,
    note: null,
  };
}

export async function parseIntent(question: string): Promise<ChatIntent> {
  if (!process.env.OPENAI_API_KEY) return fallback(question);
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: question },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? '';
    const p = JSON.parse(raw);
    return {
      kind: ['search', 'stats', 'risk', 'inter', 'report', 'manage', 'smalltalk'].includes(p.kind)
        ? p.kind
        : 'search',
      terms: Array.isArray(p.terms)
        ? p.terms
            .filter((t: any) => typeof t === 'string' && t.trim().length >= 2 && !GENERIC.has(t.trim()))
            .map((t: string) => t.trim())
            .slice(0, 5)
        : [],
      period: PERIODS.includes(p.period) ? p.period : null,
      scopes: Array.isArray(p.scopes) ? p.scopes.filter((s: any) => SCOPES.includes(s)) : [],
      needsArticles: p.needsArticles !== false,
      unsupported: typeof p.unsupported === 'string' && p.unsupported ? p.unsupported : null,
      note: typeof p.note === 'string' && p.note ? p.note : null,
    };
  } catch (e) {
    console.error('[chat-intent] 실패 — 규칙 기반으로 대체', e);
    return fallback(question);
  }
}
