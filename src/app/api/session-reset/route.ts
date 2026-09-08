/**
 * 세션 쿠키를 비우고 로그인 화면으로 보낸다.
 *
 * 왜 필요한가: 세션 쿠키는 httpOnly 라서 브라우저 자바스크립트로 지울 수 없다.
 * 쿠키는 남아 있는데 DB의 세션 행이 없으면(만료·삭제·수동으로 심은 값)
 * 미들웨어는 "쿠키 있음"으로 통과시키고 페이지는 세션이 없다고 로그인으로
 * 돌려보낸다. 사용자 눈에는 "로그인이 안 된다"로 보이고, 스스로 빠져나올
 * 방법이 없다. 그 상태를 끊는 유일한 방법이 서버가 쿠키를 지우는 것이다.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** NextAuth가 쓰는 세션 쿠키 이름 — https 에서는 __Secure- 접두사가 붙는다. */
const SESSION_COOKIES = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
  'next-auth.csrf-token',
  '__Host-next-auth.csrf-token',
  'next-auth.callback-url',
  '__Secure-next-auth.callback-url',
];

function clearAll(req: NextRequest) {
  const url = new URL('/login', req.url);
  url.searchParams.set('reset', '1');
  const res = NextResponse.redirect(url);
  for (const name of SESSION_COOKIES) {
    // 만료시켜 지운다. secure 여부가 다른 같은 이름의 쿠키가 둘 있을 수 있어
    // 양쪽으로 각각 지운다.
    res.cookies.set(name, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
    res.cookies.set(name, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: true });
  }
  return res;
}

export async function GET(req: NextRequest) {
  return clearAll(req);
}

export async function POST(req: NextRequest) {
  return clearAll(req);
}
