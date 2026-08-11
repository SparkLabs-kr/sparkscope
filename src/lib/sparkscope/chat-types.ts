// 챗봇 요청/응답 타입 — 클라이언트 컴포넌트도 import 하므로
// 이 파일은 prisma 등 서버 전용 모듈을 절대 import 하지 않는다.

export type ChatPeriod = 'today' | 'week' | 'month' | 'quarter' | 'all';
export type ChatScope = 'portfolio' | 'competitor' | 'sparklabs' | 'industry';

export const PERIOD_LABEL: Record<ChatPeriod, string> = {
  today: '오늘',
  week: '이번 주',
  month: '최근 1개월',
  quarter: '최근 3개월',
  all: '전체 기간',
};

export const SCOPE_LABEL: Record<ChatScope, string> = {
  portfolio: '포트폴리오사',
  competitor: '경쟁사(VC)',
  sparklabs: '스파크랩',
  industry: '업계동향',
};

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '스파크랩',
  portfolio_company: '포트폴리오사',
  competitor: '경쟁사(VC)',
  industry_trend: '업계동향',
  executive: '경영진',
  live: '실시간 검색',
};

export function categoryLabel(c: string) {
  return CATEGORY_LABEL[c] ?? c;
}

/** 오탐이 많은 수집 키워드 — 건수만이 아니라 왜 오탐인지 판단할 재료까지 담는다 */
export type NoisyKeyword = {
  name: string;
  noise: number;
  kept: number;
  /** 감시대상 수집 상태. ACTIVE만 설정을 고쳐서 효과를 볼 수 있다 */
  status?: string;
  /** 실제 오탐 기사 제목 예시 — 이게 없으면 무엇 때문에 오탐인지 추측하게 된다 */
  samples?: string[];
  /** 현재 문맥어·제외어 설정 */
  current?: { contextWords: string | null; excludeWords: string | null } | null;
};

export type ChatArticle = {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: string;
  category: string;
  matchedKeyword: string;
  tone: string | null;
  riskFlag: string | null;
  /** 수집 때 뽑아둔 AI 한 줄 요약 (약 90%의 기사에 있다) */
  oneLiner?: string | null;
  importance?: string | null;
};

/** 결과가 어떤 조회에서 나왔는지 — HTML 저장이 이걸 보고 표시 방식을 고른다(2026-08-11). */
export type ResultKind = 'search' | 'trend' | 'noise' | 'inter' | 'pitch' | 'live' | null;

/** /api/chat 응답 */
export type ChatResponse = {
  intent: string;
  note: string | null;
  unsupported: string | null;
  summary?: string | null;
  appliedPeriod?: ChatPeriod;
  appliedScopes?: ChatScope[];
  resultKind?: ResultKind;
  result: ChatQueryResult | null;
};

export type ChatQueryResult = {
  terms: string[];
  periodLabel: string;
  total: number;
  /** 같은 길이의 직전 기간 건수. 기간이 '전체'면 null */
  prevTotal: number | null;
  /** 직전 기간 대비 증감률(%). 직전이 0건이거나 비교 불가면 null */
  deltaPct: number | null;
  /** 증감률을 못 내는 이유 (직전 기간에 해당 카테고리 미수집). 없으면 null */
  deltaUnavailableReason?: string | null;
  /** 증감률은 냈지만 신뢰도가 낮을 때의 경고 (직전 기간이 백필 구간). 없으면 null */
  deltaCaution?: string | null;
  byCategory: { category: string; count: number }[];
  topSources: { name: string; count: number }[];
  topCompanies: { name: string; count: number }[];
  negativeCount: number;
  /** 분류·키워드·매체 집계가 최신 1000건 표본 기준인지 */
  sampled?: boolean;
  /** 위험 플래그가 달린 기사 수 */
  riskCount: number;
  /** 월별 건수 (지표·추이 질문일 때만 채워진다) */
  monthly: { month: string; count: number }[] | null;
  /** 오탐(노이즈)으로 걸러진 기사가 많은 키워드 (키워드·노이즈 질문일 때만) */
  noisyKeywords: NoisyKeyword[] | null;
  articles: ChatArticle[];
};
