// 챗봇 요청/응답 타입 — 클라이언트 컴포넌트도 import 하므로
// 이 파일은 prisma 등 서버 전용 모듈을 절대 import 하지 않는다.

export type ChatPeriod = 'today' | 'week' | 'month' | 'quarter' | 'all';
export type ChatScope = 'portfolio' | 'competitor' | 'sparklabs' | 'industry' | 'inter';

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
  inter: '해외 트렌드',
};

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '스파크랩',
  portfolio_company: '포트폴리오사',
  competitor: '경쟁사(VC)',
  industry_trend: '업계동향',
  executive: '경영진',
  live: '🔍 실시간',
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
  /** EN 화면용 번역 제목·요약. 검색·군집화는 계속 원문(title)을 쓴다. */
  titleEn?: string | null;
  oneLinerEn?: string | null;
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
  /**
   * matchedKeyword가 무슨 종류의 값인지 — 'company'면 엮인 포트폴리오사 이름(들),
   * 'topic'이면 신약발굴·항암 같은 주제 태그. 해외 트렌드(inter_trends) 결과는 회사
   * 매칭이 없으면 topicSector로 대체하는데, 둘을 구분 없이 보여주면 "쿼드메디슨"이
   * 회사인지 주제인지 헷갈린다(2026-08-12 실사용 피드백). 국내 검색 결과는 항상 회사/
   * 키워드 매칭이라 'company'로 취급한다.
   */
  tagKind?: 'company' | 'topic';
  /** 기획기사 피칭 가능성 점수(0~100) — 피칭 소재 산점도용. pitch 조회에서만 채워진다. */
  pitchScore?: number | null;
  /** 노출 우선순위 점수 — 피칭 산점도의 다른 축. pitch 조회에서만 채워진다. */
  priorityScore?: number | null;
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
  /** 다이제스트 메일 레이아웃 HTML. 다이제스트를 보여달라는 질문에서만 채워지고,
   *  있으면 답변 위에 실제 메일과 같은 모양으로 그려진다(2026-08-21). */
  digestHtml?: string | null;
  result: ChatQueryResult | null;
  /** 방금 답변에 이어 물어볼 만한 질문 2~3개. 비개발자 사용자가 "이 챗봇으로 뭘 더
   *  물어볼 수 있는지" 스스로 떠올리기 어려워해서(2026-08-12), 모델이 맥락에 맞는
   *  다음 질문을 직접 뽑아 버튼으로 보여준다. */
  followUps?: string[] | null;
  /** HTML 리포트로 저장할 때 쓸 제목. 모델이 답변 내용을 요약해 지어준다.
   *  사용자가 친 질문("~싹다 찾아서 정리해줘봐")을 그대로 제목에 쓰면 보고서 표지로
   *  못 쓴다는 피드백(2026-08-19). 없으면 저장 쪽에서 데이터로 만들어 쓴다. */
  title?: string | null;
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
  /** 긍정/중립 톤 건수 — search_articles(DB 조회) 경로에서만 채워진다. 톤 도넛차트용. */
  positiveCount?: number;
  neutralCount?: number;
  /** 분류·키워드·매체 집계가 최신 1000건 표본 기준인지 */
  sampled?: boolean;
  /** 위험 플래그가 달린 기사 수 */
  riskCount: number;
  /** 월별 건수 (지표·추이 질문일 때만 채워진다) */
  monthly: { month: string; count: number }[] | null;
  /** monthly가 월 단위인지 일 단위인지 — 기간을 짧게(오늘·이번 주) 골랐으면 일 단위 막대그래프,
   *  그 외엔 6개월치 월 단위 선그래프로 그린다. */
  trendGranularity?: 'day' | 'month';
  /** 오탐(노이즈)으로 걸러진 기사가 많은 키워드 (키워드·노이즈 질문일 때만) */
  noisyKeywords: NoisyKeyword[] | null;
  articles: ChatArticle[];
  /** 결과 건수가 너무 적어 (< 8건) 실시간 검색을 제안할 때 true */
  needsLiveSearch?: boolean;
  /** 검색어가 감시 대상 이름과 정확히 일치했을 때의 그 대상 정보 — 흔한 단어라도 회사
   *  얘기로 우선 해석했다는 근거이자, 폐업(Written-off) 여부를 답변에 반영하는 데 쓴다. */
  matchedEntities?: { name: string; category: string; portfolioStatus: string | null }[];
};
