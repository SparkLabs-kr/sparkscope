/**
 * 우리 회사 기사만 모아보기 — 포트폴리오사 한 곳의 국내 보도(Intra)와 해외 트렌드 연결(Inter)을 한 화면에.
 *
 * 새로 계산하는 것은 없다. 국내 기사는 수집 단계의 Article.matchedKeyword(getCompanyScope),
 * 해외 기사는 크론이 이미 매칭해 둔 InterPortfolioMatch 를 회사 기준으로 다시 묶을 뿐이다.
 * Inter 탭의 주제 카드 안에 흩어져 있던 "이 회사 매칭·AI 매칭 사유·브리핑 생성"을 이 자리로 옮겼다
 * (2026-10-02 소윤 요청 — 포트폴리오사 화면의 Inter 탭은 기사만 보여 준다).
 *
 * 포트폴리오사 계정은 자기 회사로 고정된다(주소의 company 는 무시). 사내 계정은 회사를 고른다.
 * 기사 수·중요도·피칭·Exit/Live·논조는 보여 주지 않는다 — 포트폴리오사 화면 규칙과 같다.
 */
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/authz';
import { canScrap as canScrapEmail } from '@/lib/scrap';
import { getCompanyScope } from '@/lib/sparkscope/company-scope';
import { getSectorData, buildOverview, loadInterData, type InterDomain } from '@/lib/inter-sample-data';
import { ensureArticleEnDeep, ensureArticleKoDeep, ensureInterReasonEn, translateBatchMemo } from '@/lib/sparkscope/translate-content';
import { ArticleListView } from '@/components/ArticleListView';
import { CompanyInterSection, type CompanyInterGroup } from '@/components/CompanyInterSection';
import { CompanyPicker } from '@/components/CompanyPicker';
import { getT, getLocale } from '@/lib/i18n/server';
import { businessContext } from '@/lib/sparkscope/synergy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'icn1';

const RANGES = [
  { days: 30, label: '1개월' },
  { days: 90, label: '3개월' },
  { days: 180, label: '6개월' },
  { days: 365, label: '1년' },
] as const;
const DOMAINS: { id: InterDomain; label: string }[] = [
  { id: 'ai', label: 'AI' },
  { id: 'bio', label: '바이오' },
];

// 시너지 관계 배지 — 대시보드 SynergyBoard의 REL과 같은 색·이름.
const SYNERGY_REL: Record<string, { label: string; cls: string }> = {
  same: { label: '같은 업종', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  complement: { label: '보완', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  chain: { label: '밸류체인', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function CompanyNewsPage({ searchParams }: { searchParams: { company?: string; days?: string } }) {
  const tr = getT();
  const locale: 'ko' | 'en' = getLocale() === 'en' ? 'en' : 'ko';
  const user = await getSessionUser();
  // 미리보기(authz.ts PREVIEW_COOKIE) 중인 사내 계정도 PORTFOLIO 로 들어온다 — 실제 계정과 같은 화면.
  const isPortfolio = user?.role === 'PORTFOLIO';
  // 스크랩·브리핑은 사내 기능이다(브리핑은 포폴사 대표에게 나갈 문서라 스크랩 권한과 같은 조건).
  const canScrap = !isPortfolio && canScrapEmail(user?.email ?? null);
  const canBrief = canScrap;

  const days = RANGES.find(r => String(r.days) === searchParams.days)?.days ?? 90;
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);

  const companyId = isPortfolio ? user?.companyId ?? null : searchParams.company ?? null;
  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams({ days: String(days), ...(companyId && !isPortfolio ? { company: companyId } : {}), ...next });
    return `/dashboard/company?${p.toString()}`;
  };
  const backHref = isPortfolio ? '/dashboard?tab=portfolio' : '/dashboard';

  // 사내 계정의 회사 선택지 — 한국·대만·글로벌벤처스 포트폴리오 전부.
  const companies = isPortfolio
    ? []
    : await prisma.monitoringTarget.findMany({
        where: { category: { startsWith: 'portfolio_company' }, status: 'ACTIVE' },
        select: { id: true, name: true, category: true },
        orderBy: { name: 'asc' },
      });

  const scope = companyId ? await getCompanyScope(companyId) : null;
  const target = scope
    ? await prisma.monitoringTarget.findUnique({ where: { id: scope.companyId }, select: { name: true, englishName: true } })
    : null;

  let articles: any[] = [];
  let interGroups: CompanyInterGroup[] = [];
  let synergies: { id: string; partner: string; partnerCountry: 'kr' | 'tw'; partnerDesc: string; relation: string; rationale: string | null; collabFormat: string | null }[] = [];
  if (scope && target) {
    // ── 국내 보도(Intra) ── 내부 판단 컬럼(riskFlag·pitchScore·importance·tone)은 select 하지 않는다.
    const rows = await prisma.article.findMany({
      where: { ...scope.where, pubDate: { gte: since, lte: until } },
      orderBy: [{ pubDate: 'desc' }],
      take: 300,
      select: { id: true, title: true, titleEn: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true },
    });
    articles = rows.map(a => ({ ...a, importance: null, tone: null, pitchScore: null, priorityScore: 0 }));
    if (locale === 'en') await ensureArticleEnDeep([articles]);
    else await ensureArticleKoDeep([articles]);

    // ── 해외 트렌드(Inter) ── 도메인별로 섹터를 만든 뒤 이 회사 매칭만 꺼낸다.
    // 섹터·전체 맥락(overview)은 브리핑 생성에 그대로 들어가므로 Inter 탭과 같은 함수로 만든다.
    const names = new Set([target.name, target.englishName].filter(Boolean) as string[]);
    const periodLabel = `${ymd(since)} ~ ${ymd(until)}`;
    for (const d of DOMAINS) {
      const data = await loadInterData(d.id, since, until, 'all', locale);
      if (locale === 'en') {
        const mine = data.matches.filter(m => names.has(m.companyName));
        const ids = new Set(mine.map(m => m.verdictId));
        await ensureInterReasonEn(data.verdicts.filter(v => ids.has(v.id)), mine);
      }
      const sectors = getSectorData(d.id, data);
      const overview = buildOverview(d.id, data, sectors);
      for (const s of sectors) {
        const match = s.matches.find(m => names.has(m.co));
        if (!match) continue;
        interGroups.push({
          key: `${d.id}-${s.id}`,
          domainLabel: overview.domainLabel,
          periodLabel,
          sector: {
            icon: s.icon,
            name: s.name,
            badgeLabel: s.badge.label,
            badgeWhy: s.badge.why,
            count: s.metrics.count,
            deltaPct: s.metrics.deltaPct,
            share: s.metrics.share,
            sourceCount: s.metrics.sourceCount,
            paperCount: s.metrics.paperCount,
            matchCount: s.metrics.matchCount,
          },
          overview: {
            total: overview.total,
            deltaPct: overview.deltaPct,
            sourceCount: overview.sourceCount,
            matchCount: overview.matchCount,
            matchedCompanyCount: overview.matchedCompanyCount,
            topSectors: overview.topSectors.map(t => ({ name: t.name, count: t.count, deltaPct: t.deltaPct })),
          },
          match,
        });
      }
    }
    // ── 한국 × 대만 시너지 ── 이 회사가 낀 조합만. 대시보드 시너지 탭은 남의 회사 조합까지 보여서
    // 포트폴리오사 화면에서 뺐다. 상대가 Exit·중단이면 뺀다(시너지 탭 기본값과 같다).
    // 유사도 점수·피드백·초대 리스트는 사내 기획용이라 넣지 않는다.
    const pairs = await prisma.synergyPair.findMany({
      where: {
        relation: { in: ['same', 'complement', 'chain'] },
        OR: [{ krTargetId: scope.companyId }, { twTargetId: scope.companyId }],
      },
      orderBy: { similarity: 'desc' },
      take: 20,
    });
    const partnerIds = pairs.map(p => (p.krTargetId === scope.companyId ? p.twTargetId : p.krTargetId));
    const partners = new Map((await prisma.monitoringTarget.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, name: true, notes: true, status: true, portfolioStatus: true },
    })).map(t => [t.id, t]));
    for (const p of pairs) {
      const isKr = p.krTargetId === scope.companyId;
      const t = partners.get(isKr ? p.twTargetId : p.krTargetId);
      if (!t || t.status !== 'ACTIVE' || t.portfolioStatus === 'Exit' || t.portfolioStatus === 'Written-off') continue;
      synergies.push({
        id: p.id, partner: t.name, partnerCountry: isKr ? 'tw' : 'kr', partnerDesc: businessContext(t.notes),
        relation: p.relation, rationale: p.rationale, collabFormat: p.collabFormat,
      });
    }

    // 상대 회사 사업 설명은 감시 대상 notes 원문이라 대만·글로벌 회사는 영어다(예: EMQ).
    // 화면 언어에 맞춰 번역한다 — 저장할 컬럼이 없어 프로세스 메모 캐시(6시간)만 쓴다.
    const wantKo = locale === 'ko';
    const idx = synergies.map((x, i) => (x.partnerDesc && /[가-힣]/.test(x.partnerDesc) !== wantKo ? i : -1)).filter(i => i >= 0);
    if (idx.length > 0) {
      const out = await translateBatchMemo(idx.map(i => synergies[i].partnerDesc), wantKo ? 'ko' : 'en').catch(() => null);
      if (out) idx.forEach((i, k) => { synergies[i].partnerDesc = out[k] ?? synergies[i].partnerDesc; });
    }

    // 가장 최근 기사가 걸린 주제부터.
    interGroups.sort((a, b) => (b.match.articles[0]?.date ?? '').localeCompare(a.match.articles[0]?.date ?? ''));
  }

  const regionOf = (c: string) => (c.endsWith('_tw') ? '대만' : c.endsWith('_gv') ? '글로벌벤처스' : '한국');

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-5">
        <div>
          <Link href={backHref} className="text-[12px] font-semibold text-spark-muted hover:text-spark-purple">← {tr('대시보드로')}</Link>
          <div className="text-[12.5px] font-bold mb-1.5 mt-2 text-spark-purple">🏢 {tr('우리 회사 기사만 모아보기')}</div>
          <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-spark-ink leading-none">
            {scope ? scope.companyName : tr('우리 회사 기사만 모아보기')}
          </h1>
          <p className="text-[13px] text-spark-muted mt-2">{isPortfolio ? tr('국내 보도와 해외 트렌드 기사 중 우리 회사와 연결된 것만 모았습니다.') : tr('국내 보도와 해외 트렌드 기사 중 이 회사와 연결된 것만 모았습니다.')}</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-spark-border bg-white px-4 py-3">
        {!isPortfolio && (
          <CompanyPicker
            companies={companies.map(c => ({ id: c.id, label: `${c.name} · ${tr(regionOf(c.category))}` }))}
            selected={companyId ?? ''}
            baseQuery={{ days: String(days) }}
          />
        )}
        <div className="flex items-center gap-1.5 sm:ml-auto">
          <span className="text-[13px] font-semibold text-spark-ink-soft mr-1">{tr('조회 기간')}</span>
          {RANGES.map(r => (
            <Link
              key={r.days}
              href={qs({ days: String(r.days) })}
              aria-current={r.days === days ? 'page' : undefined}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                r.days === days ? 'bg-spark-purple border-spark-purple text-white' : 'bg-spark-subtle border-spark-border text-spark-ink-soft hover:border-spark-purple/40'
              }`}
            >
              {tr(r.label)}
            </Link>
          ))}
        </div>
      </div>

      {!scope ? (
        <div className="rounded-2xl border border-dashed border-spark-border bg-white px-6 py-16 text-center text-sm text-spark-muted">
          {isPortfolio ? tr('계정에 연결된 회사가 없습니다. 스파크랩 담당자에게 문의해 주세요.') : tr('위에서 회사를 고르면 그 회사 기사만 모아 보여 줍니다.')}
        </div>
      ) : (
        <div className="flex flex-col gap-6 mb-8">
          <section className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
            <div className="mb-4">
              <div className="font-bold">📰 {tr('국내 보도')}</div>
              <div className="text-xs text-spark-muted mt-0.5">{tr('수집 기사 DB에서 {company}(으)로 분류된 기사', { company: scope.companyName })}</div>
            </div>
            <ArticleListView
              articles={articles}
              showSearch={true}
              showPitchColumn={false}
              showInternal={false}
              hideCounts
              csvName={scope.companyName}
              emptyText={tr('이 기간 {company} 국내 기사가 없습니다.', { company: scope.companyName })}
            />
          </section>

          <section className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
            <div className="mb-4">
              <div className="font-bold">🌐 {tr('해외 트렌드 연결')}</div>
              <div className="text-xs text-spark-muted mt-0.5">{tr('해외 기사 중 AI가 {company}와 연결된다고 본 기사를 주제별로 묶었습니다', { company: scope.companyName })}</div>
            </div>
            <CompanyInterSection groups={interGroups} canScrap={canScrap} canBrief={canBrief} />
          </section>

          {synergies.length > 0 && (
            <section className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
              <div className="mb-4">
                <div className="font-bold">🤝 {tr('한국 × 대만 시너지')}</div>
                <div className="text-xs text-spark-muted mt-0.5">{tr('스파크랩 한국·대만 포트폴리오 중 {company}와 함께 해 볼 만한 회사', { company: scope.companyName })}</div>
              </div>
              <ul className="flex flex-col gap-3">
                {synergies.map(x => (
                  <li key={x.id} className="rounded-xl border border-spark-border px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px]" aria-hidden>{x.partnerCountry === 'tw' ? '🇹🇼' : '🇰🇷'}</span>
                      <span className="text-[16px] font-extrabold tracking-tight text-spark-ink">{x.partner}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[12px] font-bold ${SYNERGY_REL[x.relation]?.cls ?? ''}`}>{tr(SYNERGY_REL[x.relation]?.label ?? x.relation)}</span>
                    </div>
                    {x.partnerDesc && <p className="mt-1.5 text-[13.5px] leading-relaxed text-spark-ink-soft">{x.partnerDesc}</p>}
                    {(x.rationale || x.collabFormat) && (
                      <div className="mt-3 rounded-lg border-l-[3px] border-violet-500 bg-violet-50/60 px-4 py-3 text-[14.5px] leading-[1.75] text-spark-ink">
                        {x.rationale && <p><b className="text-violet-700">{tr('왜 함께인가')}</b> — {x.rationale}</p>}
                        {x.collabFormat && <p className={x.rationale ? 'mt-1.5' : ''}><b className="text-violet-700">{tr('이렇게 협업해 볼 수 있어요')}</b> — {x.collabFormat}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
