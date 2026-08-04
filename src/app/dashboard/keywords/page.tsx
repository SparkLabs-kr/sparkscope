// 키워드 셀프 관리 — 감시대상(MonitoringTarget) 추가/편집/삭제. ★ 스크랩과 동일한 관리자 계정만.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';
import { KeywordManager } from '@/components/KeywordManager';

export const dynamic = 'force-dynamic';

export default async function KeywordsPage() {
  const session = await getServerSession(authOptions);
  if (!canScrap(session?.user?.email ?? null)) redirect('/dashboard');

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">⚙️ 키워드 셀프 관리</h1>
          <p className="text-sm text-gray-500 mt-1">모니터링 대상을 화면에서 직접 추가·편집·삭제합니다. 편집 즉시 반영되며, 삭제는 복구 가능한 소프트 삭제입니다.</p>
        </div>
        <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← 대시보드</Link>
      </div>
      <KeywordManager />
    </>
  );
}
