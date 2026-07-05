// 스크랩함 — 본부가 큐레이션한 기사 모아보기 (다이제스트 TOP3 우선 반영 대상)
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ArticlesTable } from '@/components/ArticlesTable';
import { canScrap as canScrapEmail } from '@/lib/scrap';

export const dynamic = 'force-dynamic';

export default async function ScrapsPage() {
  const session = await getServerSession(authOptions);
  const canScrap = canScrapEmail(session?.user?.email ?? null);

  const articles = await prisma.article.findMany({
    where: { isScrapped: true },
    orderBy: { scrappedAt: 'desc' },
    take: 200,
  });

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold">⭐ 스크랩함</h1>
          <p className="text-sm text-gray-500 mt-1">본부가 스크랩한 기사 {articles.length}건. 별표를 다시 누르면 해제됩니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/digest/review" className="rounded-lg bg-spark-purple px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 whitespace-nowrap">📤 다이제스트 검수·발송</Link>
          <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← 대시보드</Link>
        </div>
      </div>

      {/* 스크랩 → 다이제스트 반영 로직 설명 (사용자 질문에 대한 답) */}
      <div className="mb-6 rounded-xl border border-spark-light-purple bg-spark-light-purple/30 p-4 text-sm text-gray-700 leading-relaxed">
        <div className="font-bold text-spark-purple mb-1">스크랩이 다이제스트에 반영되는 방식</div>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>TOP 3</b>: 스크랩한 기사가 <b>최우선</b>으로 올라가고, 스크랩이 여러 개면 그중 <b>우선순위 점수(중요도·최신성·매체)</b>가 높은 순으로 3개가 선정됩니다. (최신순·스크랩시간순 아님)</li>
          <li><b>나머지 스크랩 기사</b>: TOP 3에 못 든 스크랩 기사는 각 카테고리 섹션(스파크랩/포트폴리오/AC·VC/스타트업계)과 이 <b>스크랩함</b>에서 계속 확인할 수 있습니다.</li>
          <li><b>발송 전 검수</b>: 위 <b>‘다이제스트 검수·발송’</b>에서 TOP 3 순서·포함 여부, 편집자 한 줄, 카테고리 요약을 직접 조정한 뒤 발송합니다.</li>
        </ul>
      </div>

      <div className="bg-white p-5 rounded-xl border border-gray-200">
        <ArticlesTable articles={articles as any} canScrap={canScrap} emptyText="아직 스크랩한 기사가 없습니다. 대시보드 기사 목록에서 ☆를 눌러 스크랩하세요." />
      </div>
    </>
  );
}
