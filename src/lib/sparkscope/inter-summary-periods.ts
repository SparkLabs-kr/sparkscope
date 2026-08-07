/**
 * Inter 탭 AI 요약(inter-summary.ts)의 기간 프리셋 — OpenAI 클라이언트를 만드는
 * inter-summary.ts와 분리된 순수 함수 모듈이다. inter-sample-data.ts(대시보드 읽기 경로,
 * /api/inter가 매 요청 사용)가 이 상수만 필요할 때 inter-summary.ts를 통째로 import하면
 * 그 파일 최상단의 `new OpenAI(...)`가 같이 실행돼, OPENAI_API_KEY가 없을 때 읽기 전용
 * 대시보드 요청까지 전부 죽는 문제가 있었다. 그래서 이 상수·함수만 별도 파일로 뺀다.
 *
 * /api/inter/route.ts의 PERIOD_DAYS와 반드시 값을 맞춘다 — 화면에서 고른 기간과
 * AI 요약이 어긋나면("가장 많이 걸린 포트폴리오사"엔 있는데 AI 문장은 "매칭 없음") 안 된다.
 */
export const SUMMARY_PERIODS: { key: string; days: number; label: string }[] = [
  { key: '7d', days: 7, label: '최근 7일' },
  { key: '1m', days: 30, label: '최근 1개월' },
  { key: '3m', days: 90, label: '최근 3개월' },
  { key: '1y', days: 365, label: '최근 1년' },
  // '3y'는 2026-08-07에 제거 — 과거 기사 백필을 1년치까지만 하기로 해서 3년 요약은
  // 대부분 빈 구간을 요약하게 되고, 사전계산 LLM 비용만 나간다.
];

/** 임의의 (since, until) 구간을 가장 가까운 SUMMARY_PERIODS 키로 매핑. 사전계산된 값을 재사용하기 위함. */
export function nearestSummaryPeriodKey(since: Date, until: Date): string {
  const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400000));
  let best = SUMMARY_PERIODS[0];
  for (const p of SUMMARY_PERIODS) {
    if (Math.abs(p.days - days) < Math.abs(best.days - days)) best = p;
  }
  return best.key;
}
