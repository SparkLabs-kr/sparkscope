// 내 북마크 — 로그인한 사용자 각자의 개인 저장 목록. ⭐ 스크랩함(본부 큐레이션)과 별개.
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ArticlesTable } from '@/components/ArticlesTable';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function BookmarksPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');

  const bookmarks = await prisma.bookmark.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const articles = await prisma.article.findMany({ where: { id: { in: bookmarks.map(b => b.articleId) } } });
  const byId = new Map(articles.map(a => [a.id, a]));
  const ordered = bookmarks.map(b => byId.get(b.articleId)).filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold">🔖 내 북마크</h1>
          <p className="text-sm text-gray-500 mt-1">내가 저장한 기사 {ordered.length}건. 나만 보이고, 다른 사람 목록에는 안 나타납니다.</p>
        </div>
        <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← 대시보드</Link>
      </div>

      <div className="bg-white p-5 rounded-xl border border-gray-200">
        <ArticlesTable
          articles={ordered.map(a => ({ ...a, isBookmarked: true })) as any}
          canBookmark
          emptyText="아직 북마크한 기사가 없습니다. 대시보드의 🔖 아이콘을 눌러 저장하세요."
        />
      </div>
    </>
  );
}
