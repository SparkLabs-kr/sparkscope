// 노이즈 신고 → AI 제안 승인 대기 목록. ★ 스크랩과 동일한 관리자 계정만.
import Link from 'next/link';
import { getLocale, getT } from '@/lib/i18n/server';
import { ensureArticleEnDeep } from '@/lib/sparkscope/translate-content';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';
import { prisma } from '@/lib/prisma';
import { NoiseQueueList, type QueueItem } from '@/components/NoiseQueueList';

export const dynamic = 'force-dynamic';

export default async function NoiseSuggestionsPage() {
  const t = getT();
  const isEn = getLocale() === 'en';
  const session = await getServerSession(authOptions);
  if (!canScrap(session?.user?.email ?? null)) redirect('/dashboard');

  const [pendingSuggestions, pendingRequests] = await Promise.all([
    prisma.noiseSuggestion.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
    prisma.noiseReportRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const articleIds = [...new Set([...pendingSuggestions.map(p => p.articleId), ...pendingRequests.map(p => p.articleId)])];
  const articles = await prisma.article.findMany({
    where: { id: { in: articleIds } },
    select: { id: true, title: true, titleEn: true, link: true, source: true },
  });
  if (isEn) await ensureArticleEnDeep([articles]);
  const articleById = new Map(articles.map(a => [a.id, a]));

  // AI 제안과 사용자 신고를 한 목록으로 섞어서 시간순(최신 먼저)으로 보여준다 —
  // 관리자 입장에선 "누가 냈든 신고는 신고"라 굳이 탭을 나눌 필요가 없다.
  const items: QueueItem[] = [
    ...pendingSuggestions.flatMap(s => {
      const article = articleById.get(s.articleId);
      if (!article) return [];
      return [{ kind: 'ai' as const, id: s.id, article, targetName: s.targetName, field: s.field, currentValue: s.currentValue, addition: s.addition, reason: s.reason, createdAt: s.createdAt }];
    }),
    ...pendingRequests.flatMap(r => {
      const article = articleById.get(r.articleId);
      if (!article) return [];
      return [{ kind: 'user' as const, id: r.id, article, reportedBy: r.reportedBy, reason: r.reason, createdAt: r.createdAt }];
    }),
  ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">🔍 {t('노이즈 제안')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('AI 재발방지 제안과 사용자 신고 모두 여기서 승인해야만 실제로 반영됩니다({n}건 대기 중).', { n: items.length })}
          </p>
        </div>
        <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← {t('대시보드')}</Link>
      </div>
      <NoiseQueueList items={items} />
    </>
  );
}
