// 포트폴리오사 계정 관리 — 발급·비활성화·소속 회사 변경. 내부 계정(role=ADMIN)만.
import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { requireAdmin } from '@/lib/authz';
import { AccountManager } from '@/components/AccountManager';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const t = getT();
  await requireAdmin('accounts');

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">👥 {t('계정 관리')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('포트폴리오사에 SparkScope를 열어줄 계정을 발급합니다. 발급된 계정은 자기 회사 뉴스와 공개 업계 동향만 볼 수 있고, 키워드 관리·수집 로그·발송 설정은 보이지 않습니다.')}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
        >
          ← {t('대시보드')}
        </Link>
      </div>
      <AccountManager />
    </>
  );
}
