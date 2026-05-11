// SparkScope 공통 타입

export type Category =
  | 'sparklabs_self'
  | 'sparklabs_executive'
  | 'portfolio_company'
  | 'industry_trend'
  | 'competitor';

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
    industry: number;
    portfolioTrend?: string;
    industryTrend?: string;
  };
  top3: AnalyzedArticle[];
  sparklabsArticles: AnalyzedArticle[];
  portfolioArticles: AnalyzedArticle[];
  industryArticles: AnalyzedArticle[];
  insightTitle?: string;
  insightText?: string;
  insightActionUrl?: string;
}
