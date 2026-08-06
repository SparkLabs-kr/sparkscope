// 노이즈 신고 → AI 제안 승인 대기 목록. ★ 스크랩과 동일한 관리자 계정만.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';
import { prisma } from '@/lib/prisma';
import { NoiseSuggestionList } from '@/components/NoiseSuggestionList';

export const dynamic = 'force-dynamic';

export default async function NoiseSuggestionsPage() {
  const session = await getServerSession(authOptions);
  if (!canScrap(session?.user?.email ?? null)) redirect('/dashboard');

  const pending = await prisma.noiseSuggestion.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  const articles = await prisma.article.findMany({
    where: { id: { in: pending.map(p => p.articleId) } },
    select: { id: true, title: true, link: true, source: true },
  });
  const articleById = new Map(articles.map(a => [a.id, a]));
  const items = pending
    .map(p => ({ suggestion: p, article: articleById.get(p.articleId) ?? null }))
    .filter(x => x.article !== null) as { suggestion: typeof pending[number]; article: NonNullable<ReturnType<typeof articleById.get>> }[];

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">🔍 노이즈 제안 승인</h1>
          <p className="text-sm text-gray-500 mt-1">
            노이즈 신고 시 AI가 재발 방지용 문맥어/제외어를 제안합니다. 승인해야만 실제 감시대상 설정에 반영돼요({pending.length}건 대기 중).
          </p>
        </div>
        <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← 대시보드</Link>
      </div>
      <NoiseSuggestionList items={items} />
    </>
  );
}
