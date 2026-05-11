import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { SignOutButton } from '@/components/SignOutButton';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');

  const initial = session.user.email[0].toUpperCase();

  return (
    <div className="min-h-screen bg-spark-cream">
      <nav className="bg-white border-b border-gray-200 px-8 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-5">
          <Link href="/dashboard" className="text-spark-purple font-bold tracking-wide">SparkScope</Link>
          <span className="px-2.5 py-0.5 bg-spark-light-purple text-spark-purple rounded-full text-xs font-semibold">본부 인사이트 대시보드</span>
          <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-[10px] font-bold tracking-wider">🔒 INTERNAL</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="hidden md:inline">{session.user.email}</span>
          <div className="w-7 h-7 rounded-full bg-spark-purple text-white flex items-center justify-center text-xs font-bold">{initial}</div>
          <SignOutButton />
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-8 py-6">{children}</main>
    </div>
  );
}
