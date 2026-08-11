import { redirect } from 'next/navigation';

// 접속 첫 화면은 대시보드가 아니라 챗봇(/chat).
// 미로그인 사용자는 /chat 에서 다시 /login 으로 보내진다.
export default function Home() {
  redirect('/chat');
}
