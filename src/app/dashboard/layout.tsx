import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/authz';
import { countPending } from '@/lib/sparkscope/access-request';
import { SignOutButton } from '@/components/SignOutButton';
import { ScrollTopButton } from '@/components/ScrollTopButton';
import { DashboardTutorial } from '@/components/DashboardTutorial';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { getT } from '@/lib/i18n/server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // 이 레이아웃이 /dashboard/* 6개 화면의 유일한 관문이다.
  // OPEN_ACCESS 처리는 getSessionUser 안에 있다.
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // 사내 대시보드는 경쟁사·시너지·다른 포트폴리오사 자료를 함께 보여준다.
  // 포트폴리오사 계정은 자기 회사 화면으로 보낸다 — 여기서 막지 않으면
  // page.tsx 40여 군데 조회를 하나하나 막아야 한다.
  if (user.role !== 'ADMIN') redirect('/portfolio');

  const initial = user.email[0].toUpperCase();
  // 접근 요청은 메일로 알리지만, 메일은 실패할 수 있다. 본부가 매일 보는
  // 화면에 대기 건수를 띄워 두면 알림이 실패해도 요청이 묻히지 않는다.
  const { pending, unnotified } = await countPending().catch(() => ({ pending: 0, unnotified: 0 }));
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
          <span className="hidden sm:inline text-xs font-medium text-spark-muted">{t('본부 인사이트 대시보드')}</span>
          <Link href="/chat" className="hidden sm:inline text-xs font-semibold text-spark-muted hover:text-spark-purple transition">💬 {t('챗봇')}</Link>
          <DashboardTutorial />
          {pending > 0 && (
            <Link
              href="/dashboard/accounts"
              className={`text-[11px] font-bold px-2 py-0.5 rounded-md border transition ${
                unnotified > 0
                  ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                  : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
              }`}
              title={unnotified > 0 ? t('알림 메일이 나가지 않은 요청이 있습니다') : undefined}
            >
              {unnotified > 0 ? '⚠ ' : ''}
              {t('접근 요청 {n}건', { n: pending })}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-spark-muted">
          <LanguageSwitcher />
          <span className="hidden md:inline px-2 py-0.5 rounded-md bg-spark-subtle border border-spark-border text-[11px] font-semibold tracking-wide text-spark-ink-soft">🔒 INTERNAL</span>
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
