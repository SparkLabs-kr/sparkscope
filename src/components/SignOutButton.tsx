'use client';
import { signOut } from 'next-auth/react';
import { useT } from '@/lib/i18n/client';

export function SignOutButton() {
  const t = useT();
  // 미리보기 쿠키는 로그아웃해도 남으므로(httpOnly, next-auth 밖), 먼저 서버에서 지운 뒤 로그아웃한다.
  // 그렇지 않으면 다음 로그인이 미리보기 상태로 판정돼 관리자가 포트폴리오사 화면으로 떨어진다.
  const onClick = async () => {
    await fetch('/api/preview-as', { method: 'POST' }).catch(() => {});
    await signOut({ callbackUrl: '/' });
  };
  return (
    <button
      onClick={onClick}
      className="text-xs text-gray-400 hover:text-gray-700"
    >
      {t('로그아웃')}
    </button>
  );
}
