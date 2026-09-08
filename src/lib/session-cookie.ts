/**
 * 세션 쿠키가 남아 있는지만 본다 — 유효한지는 보지 않는다.
 *
 * 쿠키는 있는데 getSessionUser()가 null 이면 "죽은 쿠키"다. 그 상태에서
 * /login 으로만 보내면 쿠키가 그대로 남아 같은 일이 반복된다.
 * 이 함수가 true 면 쿠키를 지우는 경로로 보내야 한다.
 */
import { cookies } from 'next/headers';

const NAMES = ['next-auth.session-token', '__Secure-next-auth.session-token'];

export function hasStaleSession(): boolean {
  const jar = cookies();
  return NAMES.some(n => {
    const v = jar.get(n)?.value;
    return typeof v === 'string' && v.length > 0;
  });
}
