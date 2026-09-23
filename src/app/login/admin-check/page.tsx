/**
 * 관리자 입구의 착지점 — 로그인 직후 명단을 대조하는 자리.
 *
 * 관리자 버튼과 임직원 버튼은 같은 구글 로그인을 부른다. 다른 것은 돌아오는 주소뿐이고,
 * 관리자 여부는 여기서 서버가 판정한다 — 버튼을 누른 사람이 스스로 관리자라고
 * 주장하는 것으로는 아무것도 얻지 못한다.
 *
 * 명단(ADMIN_EMAILS)에 없으면 로그인 자체는 성공한 채로 로그인 화면에 되돌려 보내고,
 * 무엇이 없는지 알려 준다. 계정을 지우거나 세션을 끊지 않는 것이 중요하다 —
 * 그 사람은 여전히 임직원이고, 임직원 입구로는 그대로 들어갈 수 있어야 한다.
 * 이것이 "권한 회수는 명단 한 줄"이라는 설계가 화면에서 드러나는 지점이다.
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminCheckPage() {
  const user = await getSessionUser();
  // 로그인이 아예 안 된 채로 이 주소를 직접 열면 로그인 화면으로.
  if (!user) redirect('/login');
  if (user.role === 'ADMIN') redirect('/dashboard');

  // 포트폴리오사가 이 주소를 직접 열었다면 자기 화면으로 보낸다 —
  // "관리자 권한 없음"이라고 알려 줄 이유가 없다(있지도 않은 길이다).
  if (user.role === 'PORTFOLIO') redirect('/portfolio');

  const q = new URLSearchParams({ denied: 'admin', email: user.email });
  redirect(`/login?${q.toString()}`);
}
