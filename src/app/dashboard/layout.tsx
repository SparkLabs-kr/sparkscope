import Link from 'next/link';
import { requireUser } from '@/lib/authz';
import { SignOutButton } from '@/components/SignOutButton';
import { ScrollTopButton } from '@/components/ScrollTopButton';
import { DashboardTutorial } from '@/components/DashboardTutorial';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { getT } from '@/lib/i18n/server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const initial = user.email[0].toUpperCase();
  const admin = user.role === 'ADMIN';
  const t = getT();

  return (
    <div className="min-h-screen bg-spark-cream">
      <nav className="bg-white/80 backdrop-blur-md border-b border-spark-border px-8 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <span className="w-6 h-6 rounded-lg bg-spark-purple text-white grid place-items-center text-[13px] font-extrabold leading-none">S</span>
            <span className="text-spark-ink font-extrabold tracking-tight text-[15px]">SparkScope</span>
          </Link>
          <span className="hidden sm:inline h-3.5 w-px bg-spark-border" />
          <span className="hidden sm:inline text-xs font-medium text-spark-muted">
            {admin ? t('본부 인사이트 대시보드') : (user.companyName ?? t('포트폴리오사 대시보드'))}
          </span>
          {/* 챗봇은 전체 데이터를 자연어로 질의하는 내부 도구 — 관리자만. */}
          {admin && <Link href="/chat" className="hidden sm:inline text-xs font-semibold text-spark-muted hover:text-spark-purple transition">💬 {t('챗봇')}</Link>}
          {admin && <Link href="/dashboard/accounts" className="hidden sm:inline text-xs font-semibold text-spark-muted hover:text-spark-purple transition">👥 {t('계정 관리')}</Link>}
          {admin && <DashboardTutorial />}
        </div>
        <div className="flex items-center gap-3 text-sm text-spark-muted">
          <LanguageSwitcher />
          {/* 내부 전용 표식은 내부 계정에만 — 포트폴리오사에게는 자기 계정 범위를 알려준다. */}
          {admin ? (
            <span className="hidden md:inline px-2 py-0.5 rounded-md bg-spark-subtle border border-spark-border text-[11px] font-semibold tracking-wide text-spark-ink-soft">🔒 INTERNAL</span>
          ) : (
            <span className="hidden md:inline px-2 py-0.5 rounded-md bg-spark-light-purple border border-spark-border text-[11px] font-semibold tracking-wide text-spark-purple">{t('포트폴리오사 계정')}</span>
          )}
          <span className="hidden md:inline text-[13px]">{user.email}</span>
          <div className="w-7 h-7 rounded-full bg-spark-purple text-white grid place-items-center text-xs font-bold">{initial}</div>
          <SignOutButton />
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-7 animate-rise">{children}</main>
      <ScrollTopButton />
    </div>
  );
}
