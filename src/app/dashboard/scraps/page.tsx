// 스크랩함 — 본부가 큐레이션한 기사 모아보기 (다이제스트 TOP3 우선 반영 대상)
//
// 화면을 반으로 나눠 Intra(국내 생태계 기사)와 Inter(해외 트렌드 기사)를 나란히 보여준다.
// 두 스크랩은 저장 위치가 다르다 — Intra는 Article.isScrapped, Inter는 InterNewsVerdict.isScrapped.
import Link from 'next/link';
import { getLocale, getT } from '@/lib/i18n/server';
import { ensureArticleEnDeep } from '@/lib/sparkscope/translate-content';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { ArticlesTable } from '@/components/ArticlesTable';
import { InterScrapStar } from '@/components/InterScrapStar';
import { canScrap as canScrapEmail } from '@/lib/scrap';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'icn1';

const DOMAIN_LABEL: Record<string, string> = { bio: '바이오', ai: 'AI' };

function fmtDate(d: Date) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default async function ScrapsPage() {
  const t = getT();
  const isEn = getLocale() === 'en';
  // 스크랩함은 본부 큐레이션 결과 — 내부 계정만 들어올 수 있다.
  const admin = await requireAdmin('scraps');
  const canScrap = canScrapEmail(admin.email);

  const [articles, interScraps] = await Promise.all([
    prisma.article.findMany({
      where: { isScrapped: true },
      orderBy: { scrappedAt: 'desc' },
      take: 200,
    }),
    prisma.interNewsVerdict.findMany({
      where: { isScrapped: true },
      orderBy: { scrappedAt: 'desc' },
      take: 200,
      select: {
        id: true, domain: true, sector: true, titleKo: true, country: true, isScrapped: true, scrappedAt: true,
        news: { select: { title: true, url: true, source: true, publishedAt: true } },
        matches: { select: { companyName: true } },
      },
    }),
  ]);
  if (isEn) await ensureArticleEnDeep([articles]);

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold">⭐ {t('스크랩함')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('본부가 스크랩한 기사 {total}건 (국내 {intra} · 해외 {inter}). 별표를 다시 누르면 해제됩니다.', { total: articles.length + interScraps.length, intra: articles.length, inter: interScraps.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/digest/review" className="rounded-lg bg-spark-purple px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 whitespace-nowrap">📤 {t('다이제스트 검수·발송')}</Link>
          <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← {t('대시보드')}</Link>
        </div>
      </div>

      {/* 스크랩 → 다이제스트 반영 로직 설명 (사용자 질문에 대한 답) */}
      <div className="mb-6 rounded-xl border border-spark-light-purple bg-spark-light-purple/30 p-4 text-sm text-gray-700 leading-relaxed">
        <div className="font-bold text-spark-purple mb-1">{t('스크랩이 다이제스트에 반영되는 방식')}</div>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>TOP 3</b>: {t('스크랩한 기사가 최우선으로 올라가고, 스크랩이 여러 개면 그중 우선순위 점수(중요도·최신성·매체)가 높은 순으로 3개가 선정됩니다. (최신순·스크랩시간순 아님)')}</li>
          <li><b>{t('나머지 스크랩 기사')}</b>: {t('TOP 3에 못 든 스크랩 기사는 각 카테고리 섹션(스파크랩/포트폴리오/AC·VC/스타트업계)과 이 스크랩함에서 계속 확인할 수 있습니다.')}</li>
          <li><b>{t('발송 전 검수')}</b>: {t('위 ‘다이제스트 검수·발송’에서 TOP 3 순서·포함 여부, 편집자 한 줄, 카테고리 요약을 직접 조정한 뒤 발송합니다.')}</li>
          <li><b>{t('해외(Inter) 스크랩')}</b>: {t('오른쪽 목록은 해외 트렌드 탭에서 스크랩한 기사입니다. 아직 다이제스트 본문에는 자동 포함되지 않고, 참고용으로 모아둡니다.')}</li>
        </ul>
      </div>

      {/* 화면 반 분할 — 왼쪽 Intra(국내) / 오른쪽 Inter(해외) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Intra */}
        <section className="bg-white rounded-xl border border-gray-200">
          <header className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
            <span className="rounded-md bg-spark-light-purple px-2 py-0.5 text-[11px] font-bold text-spark-purple">🏠 Intra</span>
            <span className="text-sm font-bold text-spark-ink">{t('국내 생태계')}</span>
            <span className="ml-auto text-xs tabular-nums text-gray-400">{t('{n}건', { n: articles.length })}</span>
          </header>
          <div className="overflow-x-auto p-4">
            <ArticlesTable
              articles={articles as any}
              canScrap={canScrap}
              showCategoryColumn={false}
              emptyText={t('아직 스크랩한 국내 기사가 없습니다. 대시보드 기사 목록에서 ☆를 눌러 스크랩하세요.')}
            />
          </div>
        </section>

        {/* Inter */}
        <section className="bg-white rounded-xl border border-gray-200">
          <header className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">🔭 Inter</span>
            <span className="text-sm font-bold text-spark-ink">{t('해외 트렌드')}</span>
            <span className="ml-auto text-xs tabular-nums text-gray-400">{t('{n}건', { n: interScraps.length })}</span>
          </header>
          <div className="p-4">
            {interScraps.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                {t('아직 스크랩한 해외 기사가 없습니다. 대시보드')} <b>🔭 Inter</b> {t('탭의 분야를 펼쳐 ☆를 눌러 스크랩하세요.')}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {interScraps.map(v => (
                  <li key={v.id} className="flex items-start gap-2.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        {v.domain && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${v.domain === 'bio' ? 'bg-cyan-50 text-cyan-700' : 'bg-violet-50 text-violet-700'}`}>
                            {t(DOMAIN_LABEL[v.domain] ?? v.domain)}
                          </span>
                        )}
                        {v.sector && <span className="rounded bg-spark-cream px-1.5 py-0.5 text-[10px] font-semibold text-spark-ink-soft">{v.sector}</span>}
                        {v.matches.length > 0 && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            📎 {v.matches[0].companyName}
                            {v.matches.length > 1 ? ` ${t('외 {n}', { n: v.matches.length - 1 })}` : ''}
                          </span>
                        )}
                      </div>
                      <a href={v.news.url} target="_blank" rel="noopener noreferrer" className="block text-[13px] font-semibold leading-snug text-spark-ink hover:text-spark-purple">
                        {isEn ? v.news.title : (v.titleKo || v.news.title)}
                      </a>
                      {!isEn && v.titleKo && v.titleKo !== v.news.title && (
                        <div className="mt-0.5 text-[11px] leading-snug text-spark-muted">{v.news.title}</div>
                      )}
                      <div className="mt-0.5 text-[11px] text-gray-400">
                        {v.news.source} · {fmtDate(v.news.publishedAt)}
                        {v.scrappedAt && ` · ${t('스크랩')} ${fmtDate(v.scrappedAt)}`}
                      </div>
                    </div>
                    {canScrap && <InterScrapStar id={v.id} initial={v.isScrapped} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
