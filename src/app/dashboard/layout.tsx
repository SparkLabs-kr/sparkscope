import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { SignOutButton } from '@/components/SignOutButton';
import { ScrollTopButton } from '@/components/ScrollTopButton';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // 협업 개발 단계(OPEN_ACCESS)면 로그인 없이 임시 세션 사용
  const session = OPEN_ACCESS
    ? ({ user: { email: 'dev@localhost', id: 'dev' } } as any)
    : await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');

  const initial = session.user.email[0].toUpperCase();

  return (
    <div className="min-h-screen bg-spark-cream">
      <nav className="bg-white/80 backdrop-blur-md border-b border-spark-border px-8 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <span className="w-6 h-6 rounded-lg bg-spark-purple text-white grid place-items-center text-[13px] font-extrabold leading-none">S</span>
            <span className="text-spark-ink font-extrabold tracking-tight text-[15px]">SparkScope</span>
          </Link>
          <span className="hidden sm:inline h-3.5 w-px bg-spark-border" />
          <span className="hidden sm:inline text-xs font-medium text-spark-muted">본부 인사이트 대시보드</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-spark-muted">
          <span className="hidden md:inline px-2 py-0.5 rounded-md bg-spark-subtle border border-spark-border text-[11px] font-semibold tracking-wide text-spark-ink-soft">🔒 INTERNAL</span>
          <span className="hidden md:inline text-[13px]">{session.user.email}</span>
          <div className="w-7 h-7 rounded-full bg-spark-purple text-white grid place-items-center text-xs font-bold">{initial}</div>
          <SignOutButton />
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-7 animate-rise">{children}</main>
      <ScrollTopButton />
    </div>
  );
}
