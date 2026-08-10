import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { ChatWelcome } from '@/components/ChatWelcome';

export default async function ChatPage() {
  const session = OPEN_ACCESS
    ? ({ user: { email: 'dev@localhost', id: 'dev' } } as any)
    : await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');

  return (
    <div className="relative">
      <div className="absolute top-4 right-5 z-10">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 transition shadow-card"
        >
          대시보드로 이동
          <span aria-hidden>→</span>
        </Link>
      </div>
      <ChatWelcome userEmail={session.user.email} />
    </div>
  );
}
