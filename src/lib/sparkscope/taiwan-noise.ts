/**
 * 대만 기사 분류 — 증권 공시·시세 자동생성물을 "보도"와 구분한다.
 *
 * 대만 포트폴리오사 중 상장·흥櫃 기업(永悅健康 7835, 稜研科技 7812)은 월 영업수익·분기 재무제표가
 * CMoney·富聯網 등에서 자동 생성돼 하루에도 여러 건씩 쏟아진다. 30일 트라이얼에서 유효 기사 43건 중
 * 20건이 이런 수치 공시였다(永悅健康 17 · 稜研科技 3). 그대로 두면 대시보드가 공시로 뒤덮인다.
 *
 * 다만 버리지 않고 분류만 한다 — 상장 일정·재무 상태는 투자팀에 여전히 필요한 정보다.
 * isBlockedNoise()로 차단하면 되돌릴 수 없지만, 분류해두면 탭·필터로 나눠 볼 수 있다.
 *
 * 상장·투자 이벤트는 공시 형식이라도 보도로 남긴다 — 트라이얼에서 稜研科技의
 * "9月1日召開創新板上市前業績發表會"(상장 전 실적발표회)가 공시로 잘못 분류돼 확인된 규칙이다.
 */

// 공시 형식이어도 VC에게는 뉴스인 이벤트 — 아래 수치 규칙보다 우선한다.
const EVENT_PATTERNS = [
  '上市前業績發表會', '創新板', '上市櫃', '掛牌', '輔導契約',
  'IPO', '募資', '增資', '併購', '投資',
];

// 자동 생성 시세·공시 전문 매체 (부분일치)
const DISCLOSURE_SOURCES = [
  'CMoney', 'TradingView', 'Investing.com', 'Simply Wall St', 'BigGo',
];

// 순수 수치 공시·시세 제목
const DISCLOSURE_PATTERNS = [
  '營收公告', '財報公告', '盤中速報', '收入明細', '股東人數',
  '市值與資本額', '每股營運現金流', 'watchlist', '股市爆料同學會',
  'EPS', '淨損', '季增',
];

export type TaiwanArticleKind = 'news' | 'disclosure';

/**
 * 대만 기사를 보도/공시로 분류한다. 한국 기사에는 쓰지 않는다(카테고리로 분기할 것).
 * 30일 트라이얼 43건 기준: 보도 23건 · 공시 20건.
 */
export function classifyTaiwanArticle(a: {
  title?: string | null;
  source?: string | null;
}): TaiwanArticleKind {
  const title = a.title ?? '';
  const source = a.source ?? '';

  // 1) 상장·투자 이벤트는 공시 형식이어도 보도
  if (EVENT_PATTERNS.some(p => title.includes(p))) return 'news';

  // 2) 시세·공시 전문 매체
  if (DISCLOSURE_SOURCES.some(s => source.toLowerCase().includes(s.toLowerCase()))) return 'disclosure';

  // 3) 수치 공시 제목
  if (DISCLOSURE_PATTERNS.some(p => title.includes(p))) return 'disclosure';

  // 4) "年增216.04%"처럼 증감률이 제목에 박힌 자동 생성물
  if (/年增\d/.test(title)) return 'disclosure';

  return 'news';
}

export function isTaiwanDisclosure(a: { title?: string | null; source?: string | null }): boolean {
  return classifyTaiwanArticle(a) === 'disclosure';
}
