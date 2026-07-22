// SparkScope 공통 타입

// 4개 카테고리 (화면 표시명):
//  sparklabs_self=스파크랩 뉴스(임원진 포함) / portfolio_company=포트폴리오사
//  competitor=AC·VC 업계 동향 / industry_trend=스타트업계 뉴스
export type Category =
  | 'sparklabs_self'
  | 'portfolio_company'
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
  insightTitle?: string;
  insightText?: string;
  insightActionUrl?: string;
  // 검수 콘솔에서 편집자가 카테고리별로 붙이는 한 줄 요약 (있으면 섹션 상단에 렌더)
  categorySummaries?: {
    sparklabs_self?: string;
    portfolio_company?: string;
    competitor?: string;
    industry_trend?: string;
  };
}
