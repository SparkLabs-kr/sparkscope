'use client';
import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/' })}
      className="text-xs text-gray-400 hover:text-gray-700"
    >
      로그아웃
    </button>
  );
}
