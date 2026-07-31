/**
 * 대시보드 인사이트 계산 — 위기 감지 / 이슈 급증.
 * 본문 미저장 상태이므로 제목 + 톤(tone) 기반 휴리스틱. 데이터 보강 시 정확도 자동 상향.
 */
import { NEGATIVE_KEYWORDS_DATA } from './keywords-data';

// data/negative-keywords.csv에서 키워드만 추출
export const NEGATIVE_KEYWORDS = NEGATIVE_KEYWORDS_DATA.map(k => k.keyword);

// 부정 키워드 오분류 방지: 센터/기관/정부기관 등은 보도자료/협력 뉴스이므로 제외
const INSTITUTION_KEYWORDS = ['센터', '기관', '부', '청', '위원회', '연구소', '교육청', '공사', '공단'];

// 경쟁사 집계에서 제외할 업계 키워드 (industry_trend category) — 대시보드 렌더링과
// 대시보드 인사이트 사전계산(dashboard-insights.ts) 양쪽이 같은 목록을 참조해야
// 두 경로의 집계 결과가 어긋나지 않는다.
export const INDUSTRY_TREND_KEYWORDS = [
  'AI 스타트업',
  'AI 에이전트',
  'AI 핀테크',
  'AI 헬스케어',
  '과학기술정보통신부',
  '기업주도 벤처캐피탈',
  '기후테크',
  '넥스트라이즈',
  '데모데이',
  '딥테크',
  '로보틱스',
  '모태펀드',
  '바이오테크',
  '벤처',
  '벤처 투자',
  '벤처캐피탈',
  '벤처캐피털',
  '부산',
  '산업통상자원부',
  '상장',
  '생성형 AI',
  '서울산업진흥원',
  '스케일업',
  '스타트업',
  '스타트업 IPO',
  '스타트업 M&A',
  '스타트업 글로벌 진출',
  '스타트업 시드 투자',
  '시리즈 A 투자',
  '시리즈 B 투자',
  '씨이에스',
  '아웃스탠딩',
  '액셀러레이터',
  '엑시트',
  '오픈이노베이션',
  '유니콘',
  '인수합병',
  '정부지원사업',
  '중소벤처기업부',
  '창업가',
  '창업진흥원',
  '창조경제혁신센터',
  '컴업',
  '케이글로벌',
  '케이스타트업',
  '코트라',
  '콘텐츠진흥원',
  '탄소중립',
  '투자유치',
  '트라이에브리씽',
  '팁스',
  '팁스(TIPS)',
  '펀드결성',
  '푸드테크',
  '한국벤처투자',
  '한국엔젤투자협회',
  '한국초기투자기관협회',
];

// 경쟁사 모니터링 카드: 고정 12개 (순서 고정, 기사 수와 무관) — 대시보드 렌더링과
// 사전계산(dashboard-insights.ts)이 같은 목록을 봐야 사전계산이 이 12개를 빠짐없이 커버한다.
export const PINNED_COMPETITORS: { keyword: string; displayName?: string }[] = [
  { keyword: '프라이머' },
  { keyword: '씨엔티테크' },
  { keyword: '블루포인트파트너스' },
  { keyword: '아산나눔재단' },
  { keyword: '와이앤아처' },
  { keyword: '캡스톤파트너스' },
  { keyword: '해시드' },
  { keyword: '디캠프' },
  { keyword: '알토스벤처스' },
  { keyword: '카카오벤처스' },
  { keyword: 'IMM인베스트먼트' },
  { keyword: '에이티넘인베스트먼트' },
];

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
  // 센터/기관 명칭이 있으면 부정으로 판정 안 함 (MOU/협력 등 긍정적 뉴스이기 때문)
  const hasInstitution = INSTITUTION_KEYWORDS.some(k => a.title.includes(k));
  if (hasInstitution) return { neg: false };

  const kw = NEGATIVE_KEYWORDS.find(k => a.title.includes(k));
  if (kw) return { neg: true, keyword: kw };
  if (a.tone === 'NEGATIVE') return { neg: true };
  return { neg: false };
}

export interface CrisisCard {
  company: string;
  negCount: number;
  reasonKeywords: string[];   // 매칭된 부정 키워드 목록 (AI 실패 시 fallback 원인)
  titles: string[];           // AI 원인요약 입력용 (대표 부정기사 제목들)
  cause?: string;             // AI가 요약한 원인 한 줄 (대시보드에서 주입)
  article: { title: string; source: string; pubDate: Date; link: string }; // 대표 부정기사 1건
}

/**
 * 위기 감지: 포트폴리오사별 부정 기사를 모아 대표 기사 1건 + 원인요약 재료 반환.
 * threshold 이상 부정 기사가 있는 회사만 카드로. (감지 시간 창은 호출부에서 결정 — 최근 3일)
 * AI 원인요약(cause)은 순수 함수로 계산 불가하므로 호출부(대시보드)에서 비동기 주입.
 */
export function detectCrises(portfolioArticles: ArticleLite[], threshold = 2): CrisisCard[] {
  const byCompany = new Map<string, ArticleLite[]>();

  for (const a of portfolioArticles) {
    // 센터/기관 명칭이 있는 기사는 MOU/협력 뉴스이므로 위기 감지에서 제외
    if (INSTITUTION_KEYWORDS.some(k => a.title.includes(k))) continue;
    if (!negativeInfo(a).neg) continue;
    const list = byCompany.get(a.matchedKeyword) ?? [];
    list.push(a);
    byCompany.set(a.matchedKeyword, list);
  }

  const cards: CrisisCard[] = [];
  for (const [company, list] of byCompany) {
    if (list.length < threshold) continue;
    const sorted = [...list].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    const rep = sorted[0];
    const reasonKeywords = Array.from(
      new Set(list.map(a => negativeInfo(a).keyword).filter((k): k is string => !!k)),
    );
    cards.push({
      company,
      negCount: list.length,
      reasonKeywords,
      titles: sorted.slice(0, 5).map(a => a.title),
      article: { title: rep.title, source: rep.source, pubDate: rep.pubDate, link: rep.link },
    });
  }
  return cards.sort((a, b) => b.negCount - a.negCount).slice(0, 5);
}

/** AI 원인요약 실패 시 fallback — 매칭된 부정 키워드로 간단 서술. */
export function crisisFallbackCause(reasonKeywords: string[]): string {
  if (reasonKeywords.length === 0) return '해당 원인은 부정 논조 보도가 짧은 기간에 집중된 데 따른 것으로 보입니다.';
  const kws = reasonKeywords.slice(0, 3).map(k => `'${k}'`).join(', ');
  return `해당 원인은 ${kws} 등 부정 이슈 관련 보도가 늘어난 데 따른 것으로 보입니다.`;
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
