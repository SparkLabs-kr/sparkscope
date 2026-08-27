// SparkScope 공통 타입

// 4개 카테고리 (화면 표시명):
//  sparklabs_self=스파크랩 뉴스(임원진 포함) / portfolio_company=포트폴리오사
//  competitor=AC·VC 업계 동향 / industry_trend=스타트업계 뉴스
export type Category =
  | 'sparklabs_self'
  | 'portfolio_company'
  | 'portfolio_company_tw'   // 대만 포트폴리오사 — 수집 소스가 달라 별도 카테고리로 둔다
  | 'competitor'
  | 'industry_trend';

export type Importance = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Tone = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'MIXED';

export interface RawArticle {
  title: string;
  link: string;
  source: string;
  pubDate: Date;
  matchedKeyword: string;
  category: Category;
  basePriority: number;
  companyDesc?: string; // MonitoringTarget.notes — Haiku 분류 시 회사 맥락 제공
  body?: string; // 스크래핑된 본문 (collector에서 이미 긁었으면 재사용, 없으면 analyzer가 필요 시 추가 스크래핑)
}

export interface AnalyzedArticle extends RawArticle {
  importance: Importance;
  tone: Tone;
  oneLiner: string;
  ourTake?: string;
  relatedCompanies: string[];
  pitchScore: number;
  pitchTopic?: string;
  riskFlag?: string;
  isNoise: boolean;
  noiseReason?: string;
  priorityScore: number;
  titleOnlyFallback?: boolean; // 심층분석 대상인데 본문 스크래핑 실패로 title만으로 판단됨 (UI 경고 표시용)
  otherOutlets?: number; // 다이제스트 클러스터링에서 같은 사건으로 묶인 다른 매체 보도 건수 (있으면 "외 N개 매체" 표시)
}

export interface DigestData {
  date: Date;
  dateLabel: string;
  generatedAt: string;
  editorIntro: string;
  weeklyFlow?: string;
  stats: {
    total: number;
    sparklabsSelf: number;
    portfolio: number;
    competitor: number;
    industry: number;
    portfolioTrend?: string;
    industryTrend?: string;
  };
  top3: AnalyzedArticle[];
  sparklabsArticles: AnalyzedArticle[];
  portfolioArticles: AnalyzedArticle[];
  competitorArticles: AnalyzedArticle[];
  industryArticles: AnalyzedArticle[];
  // 해외 트렌드(Inter) 블록 — 없으면 관련 섹션이 통째로 빠지고 메일은 예전과 동일하다.
  // 국내(Intra) 데이터와 출처가 완전히 분리돼 있어 buildDigestData가 아니라 호출부에서 채운다.
  inter?: import('./inter-digest').InterDigestBlock | null;
  // 검수 콘솔에서 편집자가 카테고리별로 붙이는 한 줄 요약 (있으면 섹션 상단에 렌더)
  categorySummaries?: {
    sparklabs_self?: string;
    portfolio_company?: string;
    competitor?: string;
    industry_trend?: string;
  };
}
