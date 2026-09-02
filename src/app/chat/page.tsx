import { requireAdmin } from '@/lib/authz';
import { ChatWelcome } from '@/components/ChatWelcome';

export default async function ChatPage() {
  // 챗봇 API가 관리자 전용이므로 화면도 같은 기준으로 막는다 — 안 그러면
  // 포트폴리오사 계정이 화면은 열고 질문마다 401을 받는다.
  const user = await requireAdmin('chat');

  // 대시보드로 가는 링크는 챗봇 상단 바 안에 있다(ChatWelcome).
  return <ChatWelcome userEmail={user.email} />;
}
