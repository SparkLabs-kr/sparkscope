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
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">⭐ 스크랩함</h1>
          <p className="text-sm text-gray-500 mt-1">본부가 스크랩한 기사 {articles.length}건. 다이제스트 메일 TOP3에 우선 반영됩니다. 별표를 다시 누르면 해제됩니다.</p>
        </div>
        <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← 대시보드</Link>
      </div>
      <div className="bg-white p-5 rounded-xl border border-gray-200">
        <ArticlesTable articles={articles as any} canScrap={canScrap} emptyText="아직 스크랩한 기사가 없습니다. 대시보드 기사 목록에서 ☆를 눌러 스크랩하세요." />
      </div>
    </>
  );
}
