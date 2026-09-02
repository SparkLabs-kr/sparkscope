// 키워드 셀프 관리 — 감시대상(MonitoringTarget) 추가/편집/삭제. 내부 계정(role=ADMIN)만.
import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { requireAdmin } from '@/lib/authz';
import { KeywordManager } from '@/components/KeywordManager';

export const dynamic = 'force-dynamic';

export default async function KeywordsPage() {
  const t = getT();
  await requireAdmin('keywords');

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">⚙️ {t('키워드 셀프 관리')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('모니터링 대상을 화면에서 직접 추가·편집·삭제합니다. 편집 즉시 반영되며, 삭제는 복구 가능한 소프트 삭제입니다.')}</p>
        </div>
        <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← {t('대시보드')}</Link>
      </div>
      <KeywordManager />
    </>
  );
}
