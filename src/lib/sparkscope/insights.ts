/**
 * 대시보드 인사이트 계산 — 위기 감지 / 이슈 급증.
 * 본문 미저장 상태이므로 제목 + 톤(tone) 기반 휴리스틱. 데이터 보강 시 정확도 자동 상향.
 */

// 위기 감지용 부정 키워드 (data/뉴스 모니터링 DB - 부정_키워드.csv)
export const NEGATIVE_KEYWORDS = ['논란', '고소', '사기', '철회', '무산', '구속', '적자', '유출', '사고'];

export interface ArticleLite {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date;
  matchedKeyword: string;
  category: string;
  tone: string | null;
}

/** 부정 기사 여부 + (있으면) 매칭된 부정 키워드 */
export function negativeInfo(a: { title: string; tone: string | null }): { neg: boolean; keyword?: string } {
  const kw = NEGATIVE_KEYWORDS.find(k => a.title.includes(k));
  if (kw) return { neg: true, keyword: kw };
  if (a.tone === 'NEGATIVE') return { neg: true };
  return { neg: false };
}

export interface CrisisCard {
  company: string;
  negCount: number;
  reasonKeyword?: string;
  summary: string;
  article: { title: string; source: string; pubDate: Date; link: string };
}

/**
 * 위기 감지: 포트폴리오사별 부정 기사를 모아 두괄식 요약 + 대표 기사 1건.
 * threshold 이상 부정 기사가 있는 회사만 카드로.
 */
export function detectCrises(portfolioArticles: ArticleLite[], threshold = 2): CrisisCard[] {
  const byCompany = new Map<string, ArticleLite[]>();
  const kwByCompany = new Map<string, string>();

  for (const a of portfolioArticles) {
    const { neg, keyword } = negativeInfo(a);
    if (!neg) continue;
    const list = byCompany.get(a.matchedKeyword) ?? [];
    list.push(a);
    byCompany.set(a.matchedKeyword, list);
    if (keyword && !kwByCompany.has(a.matchedKeyword)) kwByCompany.set(a.matchedKeyword, keyword);
  }

  const cards: CrisisCard[] = [];
  for (const [company, list] of byCompany) {
    if (list.length < threshold) continue;
    const sorted = [...list].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    const rep = sorted[0];
    const kw = kwByCompany.get(company);
    const summary = kw
      ? `${company}는 최근 '${kw}' 관련 부정 논조 기사가 늘고 있습니다.`
      : `${company} 관련 부정 논조 기사가 ${list.length}건 감지됐습니다.`;
    cards.push({
      company,
      negCount: list.length,
      reasonKeyword: kw,
      summary,
      article: { title: rep.title, source: rep.source, pubDate: rep.pubDate, link: rep.link },
    });
  }
  return cards.sort((a, b) => b.negCount - a.negCount).slice(0, 5);
}

export interface SpikeCard {
  company: string;
  recentCount: number;
  baselineAvgPerWindow: number;
  negativeShare: number;
  message: string;
}

/**
 * 이슈 급증 감지.
 * - recent: 최근 창(예: 2일) 기사 (배너에 실제 노출되는 데이터)
 * - baselineRecords: 과거 baseline 구간 기사(백필 포함) — 평소 수준 계산용
 * 최소 절대 건수 조건으로 노이즈 방지. %가 아닌 자연어 메시지.
 */
export function detectSpikes(
  recent: ArticleLite[],
  baselineRecords: { matchedKeyword: string }[],
  recentWindowDays: number,
  baselineDays: number,
  opts: { minAbsolute?: number; ratio?: number } = {},
): SpikeCard[] {
  const minAbsolute = opts.minAbsolute ?? 3;
  const ratio = opts.ratio ?? 2;

  const recentByCompany = new Map<string, ArticleLite[]>();
  for (const a of recent) {
    const list = recentByCompany.get(a.matchedKeyword) ?? [];
    list.push(a);
    recentByCompany.set(a.matchedKeyword, list);
  }

  const baseCount = new Map<string, number>();
  for (const r of baselineRecords) baseCount.set(r.matchedKeyword, (baseCount.get(r.matchedKeyword) ?? 0) + 1);

  const windows = Math.max(1, baselineDays / Math.max(1, recentWindowDays));

  const cards: SpikeCard[] = [];
  for (const [company, list] of recentByCompany) {
    const recentCount = list.length;
    if (recentCount < minAbsolute) continue;
    const baselineAvg = (baseCount.get(company) ?? 0) / windows;
    if (recentCount < Math.max(minAbsolute, baselineAvg * ratio)) continue;

    const negShare = list.filter(a => negativeInfo(a).neg).length / recentCount;
    const message = negShare >= 0.5
      ? `${company}, 최근 부정 논조 기사가 눈에 띄게 늘었습니다.`
      : `${company}, 최근 언론 노출이 평소보다 크게 늘었습니다.`;
    cards.push({ company, recentCount, baselineAvgPerWindow: baselineAvg, negativeShare: negShare, message });
  }
  return cards.sort((a, b) => b.recentCount - a.recentCount).slice(0, 4);
}
