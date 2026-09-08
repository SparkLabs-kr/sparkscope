import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { ChatWelcome } from '@/components/ChatWelcome';

export default async function ChatPage() {
  const session = OPEN_ACCESS
    ? ({ user: { email: 'dev@localhost', id: 'dev' } } as any)
    : await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');

  // 대시보드로 가는 링크는 챗봇 상단 바 안에 있다(ChatWelcome).
  return <ChatWelcome userEmail={session.user.email} />;
}
