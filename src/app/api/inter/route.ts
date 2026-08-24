import { NextRequest, NextResponse } from 'next/server';
import {
  buildMatrix,
  buildOverview,
  getDomainStats,
  getSectorData,
  loadInterData,
  getDomainSummary,
  type InterCountry,
  type InterDomain,
} from '@/lib/inter-sample-data';
import { getLocale } from '@/lib/i18n/server';
import { ensureInsightEn, ensureInterReasonEn } from '@/lib/sparkscope/translate-content';
import { nearestSummaryPeriodKey } from '@/lib/sparkscope/inter-summary-periods';

export const runtime = 'nodejs';
// DB(Supabase)와 같은 리전에서 돌게 — 대시보드(page.tsx)와 동일한 이유.
export const preferredRegion = 'icn1';

const COUNTRIES: InterCountry[] = ['us', 'cn', 'jp', 'sa', 'other', 'all'];

function isValidYmd(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// 프리셋(period) 하위호환 — from/to가 없을 때만 쓴다.
// '3y'는 2026-08-07에 제거(백필을 1년치까지만 하기로 결정). 옛 링크로 period=3y가 들어와도
// 아래 `?? PERIOD_DAYS['3m']` 폴백에 걸려 기본 3개월로 조회된다.
const PERIOD_DAYS: Record<string, number> = { '7d': 7, '1m': 30, '3m': 90, '1y': 365 };

export async function GET(req: NextRequest) {
  const locale = getLocale();
  const sp = req.nextUrl.searchParams;
  const domain: InterDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';
  const countryParam = sp.get('country') as InterCountry | null;
  const country: InterCountry = countryParam && COUNTRIES.includes(countryParam) ? countryParam : 'all';

  const fromParam = sp.get('from');
  const toParam = sp.get('to');
  let since: Date;
  let until: Date;
  if (isValidYmd(fromParam) && isValidYmd(toParam)) {
    const [a, b] = fromParam <= toParam ? [fromParam, toParam] : [toParam, fromParam];
    since = new Date(`${a}T00:00:00`);
    until = new Date(`${b}T23:59:59`);
  } else {
    const days = PERIOD_DAYS[sp.get('period') ?? '3m'] ?? PERIOD_DAYS['3m'];
    until = new Date();
    since = new Date(until.getTime() - days * 86400000);
  }

  const [data, summary] = await Promise.all([
    loadInterData(domain, since, until, country, locale),
    getDomainSummary(domain, since, until, locale),
  ]);

  // EN 화면이면 AI가 쓴 한국어 문장을 영어로 채운다. 번역은 여기(서버 라우트)에서만 한다 —
  // lib/inter-sample-data.ts는 InterPanel(클라이언트)도 import하므로 그쪽에 두면
  // OpenAI SDK가 클라이언트 번들로 딸려 들어간다.
  if (locale === 'en') {
    await Promise.all([
      // 기사별 판정·매칭 사유 (각 테이블 reasonEn에 캐시)
      ensureInterReasonEn(data.verdicts, data.matches),
      // 도메인 요약 3문장 (DashboardInsight JSON의 summaryEn에 캐시)
      (async () => {
        if (summary.source !== 'ai') return;
        // 이미 영어판 캐시가 잡혀 넘어왔으면 다시 번역하지 않는다(영어를 또 번역하면 캐시가 오염된다).
        if (!/[가-힣]/.test(summary.trend + summary.position + summary.action)) return;
        const [trend, position, action] = await ensureInsightEn(
          'inter_summary',
          `${domain}_${nearestSummaryPeriodKey(since, until)}`,
          { trend: summary.trend, position: summary.position, action: summary.action },
          'summary',
          [summary.trend, summary.position, summary.action],
        );
        summary.trend = trend;
        summary.position = position;
        summary.action = action;
      })(),
    ]);
  }

  const stats = getDomainStats(data);
  const sectors = getSectorData(domain, data);
  const overview = buildOverview(domain, data, sectors);
  const matrix = buildMatrix(domain, data);

  return NextResponse.json({ summary, overview, stats, sectors, matrix });
}
