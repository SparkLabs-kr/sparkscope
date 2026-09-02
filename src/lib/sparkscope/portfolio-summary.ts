// 포트폴리오사 계정 전용 집계.
//
// 대시보드의 기존 집계(loadDashboardData)는 전부 전사 기준이다 — 노출 순위, 위기 감지,
// 매체 분포, 톤 분석이 모두 포트폴리오 전체를 대상으로 계산된다. 그래서 그 결과를
// 회사 단위로 "걸러서" 보여주려 하면, 거르는 곳을 한 군데라도 빠뜨리는 순간 남의 회사가
// 드러난다(실제로 급증 배너에서 그런 일이 있었다).
//
// 그래서 회사 단위 화면은 그 loader를 재사용하지 않고, 처음부터 회사로 좁힌 질의만
// 여기서 따로 한다. 구조적으로 다른 회사 데이터가 섞일 수 없다 —
// 모든 질의에 matchedKeyword = 그 회사가 들어간다.
import { prisma } from '@/lib/prisma';

export type PortfolioSummary = {
  /** 선택 기간 내 이 회사 기사 수 */
  total: number;
  /** 이 회사를 다룬 서로 다른 매체 수 */
  outletCount: number;
  tone: { positive: number; neutral: number; negative: number };
  /** 매체별 보도 건수 상위 */
  outlets: { source: string; count: number }[];
  /** 직전 동일 기간 대비 증감 (건수) */
  prevTotal: number;
};

export async function loadPortfolioSummary(
  company: string,
  since: Date,
  until: Date,
): Promise<PortfolioSummary> {
  // 이 회사로 좁힌 기본 조건. 아래 모든 질의가 이걸 깔고 간다.
  const mine = {
    pubDate: { gte: since, lte: until },
    isNoise: false,
    category: 'portfolio_company',
    matchedKeyword: company,
  };

  // 직전 동일 길이 기간 — "지난 기간보다 늘었나"를 보여주기 위해.
  const span = until.getTime() - since.getTime();
  const prevUntil = new Date(since.getTime() - 1);
  const prevSince = new Date(prevUntil.getTime() - span);

  const [total, prevTotal, toneGroups, sourceGroups] = await Promise.all([
    prisma.article.count({ where: mine }),
    prisma.article.count({ where: { ...mine, pubDate: { gte: prevSince, lte: prevUntil } } }),
    prisma.article.groupBy({ by: ['tone'], where: mine, _count: { _all: true } }),
    prisma.article.groupBy({
      by: ['source'],
      where: mine,
      _count: { _all: true },
      orderBy: { _count: { source: 'desc' } },
      take: 12,
    }),
  ]);

  const toneOf = (t: string) =>
    toneGroups.find(g => (g.tone ?? 'NEUTRAL') === t)?._count._all ?? 0;

  // 매체 수는 groupBy 결과가 상위 12개로 잘려 있으므로 따로 센다.
  const distinctOutlets = await prisma.article.findMany({
    where: mine,
    select: { source: true },
    distinct: ['source'],
  });

  return {
    total,
    prevTotal,
    outletCount: distinctOutlets.length,
    tone: {
      positive: toneOf('POSITIVE'),
      negative: toneOf('NEGATIVE'),
      neutral: total - toneOf('POSITIVE') - toneOf('NEGATIVE'),
    },
    outlets: sourceGroups.map(s => ({ source: s.source, count: s._count._all })),
  };
}

export type IndustryItem = {
  id: string;
  title: string;
  titleEn: string | null;
  source: string;
  link: string;
  pubDate: Date;
  topic: string;
};

/**
 * 포트폴리오사 계정에 열어주는 "공개 업계 동향".
 *
 * category='industry_trend' 만 본다. 이 분류의 감시대상은 업계 키워드다 —
 * 스타트업 · 벤처캐피탈 · 딥테크 · 부처명 같은 것들이고, 회사 이름이 아니다.
 * 확인한 것: 이 분류의 기사에 포트폴리오사 이름이 matchedKeyword로 들어간 경우가 없다.
 *
 * 왜 competitor 분류는 쓰지 않는가: 그쪽은 다른 AC·VC 하우스 이름과 AUM·펀드가 붙어
 * 있어서 내부 정보다. "업계 동향"과 "경쟁사 분석"을 같은 것으로 취급하면 안 된다.
 */
export async function loadIndustryTrends(
  since: Date,
  until: Date,
  take = 8,
): Promise<IndustryItem[]> {
  const rows = await prisma.article.findMany({
    where: {
      category: 'industry_trend',
      isNoise: false,
      pubDate: { gte: since, lte: until },
    },
    orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }],
    take,
    select: {
      id: true, title: true, titleEn: true, source: true,
      link: true, pubDate: true, matchedKeyword: true,
    },
  });
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    titleEn: r.titleEn,
    source: r.source,
    link: r.link,
    pubDate: r.pubDate,
    topic: r.matchedKeyword,
  }));
}
