import Link from 'next/link';
import { requireAdmin } from '@/lib/authz';
import { SignOutButton } from '@/components/SignOutButton';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { getT } from '@/lib/i18n/server';

// /digest/* 레이아웃 — 대시보드와 동일한 상단 바·인증.
export default async function DigestLayout({ children }: { children: React.ReactNode }) {
  // 다이제스트 검수·발송은 내부 도구 — 포트폴리오사 계정은 들어올 수 없다.
  const user = await requireAdmin('digest');
  const initial = user.email[0].toUpperCase();
  const t = getT();

  return (
    <div className="min-h-screen bg-spark-cream">
      <nav className="bg-white border-b border-gray-200 px-8 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-5">
          <Link href="/dashboard" className="text-spark-purple font-bold tracking-wide">SparkScope</Link>
          <span className="px-2.5 py-0.5 bg-spark-light-purple text-spark-purple rounded-full text-xs font-semibold">{t('다이제스트 검수')}</span>
          <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-[10px] font-bold tracking-wider">🔒 INTERNAL</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <LanguageSwitcher />
          <span className="hidden md:inline">{user.email}</span>
          <div className="w-7 h-7 rounded-full bg-spark-purple text-white flex items-center justify-center text-xs font-bold">{initial}</div>
          <SignOutButton />
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-8 py-6">{children}</main>
    </div>
  );
}
