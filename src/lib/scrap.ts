// 스크랩(기사 큐레이션) 권한 — .env.local의 SCRAP_ALLOWED_EMAILS로 관리.
//
// 이건 role과는 다른 축의 권한이다. role=ADMIN이 "내부 계정"이라면,
// canScrap은 그 내부 계정 중에서도 커뮤니케이션 본부 지정 계정만 갖는 더 좁은 권한이다.
// 그래서 키워드 관리·수집 로그 같은 내부 도구 접근 판단에는 쓰지 않는다 —
// 그쪽은 src/lib/authz.ts의 role을 본다. (예전에는 둘이 같은 함수를 쓰고 있었고,
// OPEN_ACCESS가 켜져 있어 둘 다 무조건 통과했다.)
//
// 목록이 비어 있으면 아무도 스크랩할 수 없다 — 내부 도구 접근과 분리해둔 덕에
// 이 값이 비어도 관리자가 대시보드에서 잠기지는 않는다.
export function scrapAllowedEmails(): string[] {
  return (process.env.SCRAP_ALLOWED_EMAILS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function canScrap(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = scrapAllowedEmails().map(e => e.toLowerCase());
  return allowed.includes(email.toLowerCase());
}
