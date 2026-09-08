/**
 * 포트폴리오사 전용 화면 — 자기 회사 보도만 본다.
 *
 * 사내 대시보드(/dashboard)를 회사별로 필터링하지 않고 별도 화면을 두는 이유는
 * company-scope.ts 주석에 있다. 이 파일의 모든 조회는 getCompanyScope()가 준
 * where 를 통과해야 한다 — 여기에 조건 없는 article 조회를 추가하지 마라.
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
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAYS = 90;

export default async function PortfolioPage() {
  const user = await getSessionUser();
  if (!user) redirect(hasStaleSession() ? '/api/session-reset' : '/login?callbackUrl=%2Fportfolio');
  // 사내 계정은 전체 대시보드가 있다.
  if (user.role === 'ADMIN') redirect('/dashboard');
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
        pitchScore: true, priorityScore: true, titleEn: true, riskFlag: true,
      },
    }),
    prisma.article.count({ where: scope.where }),
    prisma.article.groupBy({
      by: ['tone'],
      where: windowWhere,
      _count: { _all: true },
    }),
  ]);

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
                riskFlag: a.riskFlag, titleEn: a.titleEn,
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
          articles={articles}
          showSearch
          emptyText={t('최근 90일 동안 수집된 보도가 없습니다.')}
          csvName={`sparkscope-${scope.companyName}`}
        />
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
