/**
 * 포트폴리오사 전용 화면.
 *
 * 2026-09-22 결정으로 경계가 바뀌었다. 예전에는 "자기 회사 기사만" 보여 줬는데,
 * 그러면 대표는 자기가 이미 아는 것만 보게 되고 정작 가려야 할 우리 판단
 * (riskFlag·pitchScore)은 자기 회사 기사에 그대로 붙어 나가고 있었다.
 *
 * 이제 경계는 "어느 회사냐"가 아니라 **"기사냐, 우리 판단이냐"** 다.
 *   · 기사(제목·매체·링크·발행일) — 이미 인터넷에 공개된 것이라 가리지 않는다.
 *   · 우리 판단(ourTake·riskFlag·pitchScore·relatedCompanies) — 자기 회사 것도 포함해 전부 가린다.
 * 파트너사(블루사이트)에 DB 를 열 때 CLAUDE.md 가 쓰는 기준과 같은 목록이다.
 *
 * 화면은 두 층이다: 자기 회사 보도(통계·논조까지)와 업계 동향(제목만).
 * 자기 회사 조회는 여전히 getCompanyScope()가 준 where 를 통과해야 한다.
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/authz';
import { hasStaleSession } from '@/lib/session-cookie';
import { getCompanyScope } from '@/lib/sparkscope/company-scope';
import { prisma } from '@/lib/prisma';
import { ArticleListView } from '@/components/ArticleListView';
import { ToneBreakdown } from '@/components/ToneBreakdown';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { SignOutButton } from '@/components/SignOutButton';
import { getT, getLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAYS = 90;
/** 업계 동향은 더 짧게 — 흐름을 보는 자리지 기록을 뒤지는 자리가 아니다. */
const PEER_DAYS = 30;

function fmtDate(d: Date) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default async function PortfolioPage() {
  const user = await getSessionUser();
  if (!user) redirect(hasStaleSession() ? '/api/session-reset' : '/login?callbackUrl=%2Fportfolio');
  // 사내 계정(관리자·임직원)은 전체 대시보드가 있다.
  if (user.role !== 'PORTFOLIO') redirect('/dashboard');
  if (!user.companyId) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-xl font-bold mb-2">연결된 회사가 없습니다</h1>
        <p className="text-[13.5px] text-spark-muted">
          계정에 회사가 연결되지 않았습니다. 스파크랩 담당자에게 문의해 주세요.
        </p>
      </main>
    );
  }

  const scope = await getCompanyScope(user.companyId);
  if (!scope) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-xl font-bold mb-2">회사 정보를 찾을 수 없습니다</h1>
        <p className="text-[13.5px] text-spark-muted">스파크랩 담당자에게 문의해 주세요.</p>
      </main>
    );
  }

  const t = getT();
  const isEn = getLocale() === 'en';
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const windowWhere = { ...scope.where, pubDate: { gte: since } };

  const [articles, total, toneRows] = await Promise.all([
    prisma.article.findMany({
      where: windowWhere,
      orderBy: [{ pubDate: 'desc' }],
      take: 200,
      select: {
        id: true, title: true, link: true, source: true, pubDate: true,
        matchedKeyword: true, category: true, importance: true, tone: true,
        titleEn: true,
        // riskFlag·pitchScore·priorityScore 는 select 하지 않는다 — 우리 판단이고,
        // 서버 컴포넌트가 내려보내면 화면에 안 그려도 페이지 소스에 실려 나간다.
      },
    }),
    prisma.article.count({ where: scope.where }),
    prisma.article.groupBy({
      by: ['tone'],
      where: windowWhere,
      _count: { _all: true },
    }),
  ]);

  /**
   * 업계 동향 — 다른 포트폴리오사 보도.
   *
   * 제목·매체·발행일·링크만 읽는다. select 를 넓히지 마라. 여기서 한 컬럼만 더 넣어도
   * 그 순간 우리가 남의 회사를 어떻게 보는지가 대표에게 그대로 나간다.
   */
  const peerSince = new Date(Date.now() - PEER_DAYS * 24 * 60 * 60 * 1000);
  const peers = await prisma.article.findMany({
    where: {
      category: { startsWith: 'portfolio_company' },
      isNoise: false,
      pubDate: { gte: peerSince },
      // 자기 회사 기사는 위에 이미 있으므로 뺀다.
      NOT: { matchedKeyword: { in: scope.keywords } },
    },
    orderBy: [{ pubDate: 'desc' }],
    take: 40,
    select: { id: true, title: true, titleEn: true, link: true, source: true, pubDate: true },
  });

  const toneCount = (k: string) =>
    toneRows.find(r => (r.tone ?? 'NEUTRAL') === k)?._count._all ?? 0;

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <header className="flex flex-wrap items-center gap-3 mb-6">
        <div>
          <div className="text-[12px] font-semibold text-spark-purple mb-0.5">
            {t('SparkScope 포트폴리오')}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">{scope.companyName}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <SignOutButton />
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
        {[
          { label: t('최근 90일 보도'), value: articles.length },
          { label: t('전체 누적 보도'), value: total },
          { label: t('긍정'), value: toneCount('POSITIVE') },
          { label: t('부정'), value: toneCount('NEGATIVE') },
        ].map(k => (
          <div key={k.label} className="border border-spark-border rounded-xl px-4 py-3 bg-white">
            <div className="text-[11.5px] text-spark-muted mb-1">{k.label}</div>
            <div className="text-[21px] font-extrabold tabular-nums">{k.value}</div>
          </div>
        ))}
      </section>

      {articles.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[14px] font-bold mb-2">{t('논조')}</h2>
          <ToneBreakdown
            articles={articles
              .filter(a => a.tone)
              .map(a => ({
                id: a.id, title: a.title, link: a.link, source: a.source,
                pubDate: a.pubDate, tone: a.tone as string,
                titleEn: a.titleEn,
              }))}
          />
        </section>
      )}

      <section>
        <h2 className="text-[14px] font-bold mb-2">
          {t('보도 목록')}{' '}
          <span className="text-[12px] font-normal text-spark-muted">
            {t('최근 90일')}
          </span>
        </h2>
        <ArticleListView
          articles={articles.map(a => ({ ...a, pitchScore: null, priorityScore: 0 }))}
          showPitchColumn={false}
          showSearch
          emptyText={t('최근 90일 동안 수집된 보도가 없습니다.')}
          csvName={`sparkscope-${scope.companyName}`}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-[14px] font-bold mb-1">
          {t('업계 동향')}{' '}
          <span className="text-[12px] font-normal text-spark-muted">
            {t('다른 포트폴리오사 · 최근 30일')}
          </span>
        </h2>
        <p className="text-[12px] text-spark-muted mb-3">
          {t('스파크랩 포트폴리오사 보도입니다. 기사 원문으로 연결됩니다.')}
        </p>
        {peers.length === 0 ? (
          <p className="text-[13px] text-spark-muted border border-spark-border rounded-xl px-4 py-6 text-center bg-white">
            {t('최근 30일 동안 수집된 보도가 없습니다.')}
          </p>
        ) : (
          <ul className="border border-spark-border rounded-xl bg-white divide-y divide-spark-border overflow-hidden">
            {peers.map(a => (
              <li key={a.id}>
                <a
                  href={a.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-spark-subtle transition"
                >
                  <span className="text-[13.5px] font-medium flex-1 min-w-0">
                    {isEn && a.titleEn ? a.titleEn : a.title}
                  </span>
                  <span className="text-[11.5px] text-spark-muted whitespace-nowrap">{a.source}</span>
                  <span className="text-[11.5px] text-spark-muted tabular-nums whitespace-nowrap">
                    {fmtDate(a.pubDate)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-[12px] text-spark-muted">
        {t('문의')} ·{' '}
        <Link href="mailto:marketing@sparklabs.co.kr" className="text-spark-purple hover:underline">
          marketing@sparklabs.co.kr
        </Link>
      </p>
    </main>
  );
}
