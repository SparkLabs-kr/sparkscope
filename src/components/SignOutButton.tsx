'use client';
import { signOut } from 'next-auth/react';
import { useT } from '@/lib/i18n/client';

export function SignOutButton() {
  const t = useT();
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/' })}
      className="text-xs text-gray-400 hover:text-gray-700"
    >
      {t('로그아웃')}
    </button>
  );
}
