// 챗봇 요청/응답 타입 — 클라이언트 컴포넌트도 import 하므로
// 이 파일은 prisma 등 서버 전용 모듈을 절대 import 하지 않는다.

export type ChatPeriod = 'today' | 'week' | 'month' | 'quarter' | 'all';
export type ChatScope = 'portfolio' | 'competitor' | 'sparklabs' | 'inter';

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
  inter: '해외 트렌드',
};

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '스파크랩',
  portfolio_company: '포트폴리오사',
  competitor: '경쟁사(VC)',
  industry_trend: '업계동향',
  executive: '경영진',
};

export function categoryLabel(c: string) {
  return CATEGORY_LABEL[c] ?? c;
}

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
};

/** /api/chat 응답 */
export type ChatResponse = {
  intent: string;
  note: string | null;
  unsupported: string | null;
  summary?: string | null;
  appliedPeriod?: ChatPeriod;
  appliedScopes?: ChatScope[];
  result: ChatQueryResult | null;
};

export type ChatQueryResult = {
  terms: string[];
  periodLabel: string;
  total: number;
  byCategory: { category: string; count: number }[];
  topSources: { name: string; count: number }[];
  topCompanies: { name: string; count: number }[];
  negativeCount: number;
  articles: ChatArticle[];
};
