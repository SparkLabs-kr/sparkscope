// ────────────────────────────────────────────────────────────────
// 개발용 로그인 우회 스위치
//
// 2.1 로그인·계정 체계 작업으로 기본값이 false가 되었다.
// 이제 모든 진입은 /login을 거치고, 권한 판단은 src/lib/authz.ts가 한다.
//
// 로컬에서 메일 없이 화면을 보고 싶을 때만 .env.local에
//   DEV_AUTH_BYPASS=true
// 를 넣는다. 이 값은 Vercel 환경변수로 설정하지 않는다 —
// 배포 환경에서 켜지면 대시보드가 그대로 공개된다.
//
// 우회 모드에서도 "관리자로 로그인한 것처럼" 동작하게 하려면
// DEV_AUTH_EMAIL 로 사내 도메인 메일을 지정한다(기본값은 사내 도메인).
// ────────────────────────────────────────────────────────────────
export const OPEN_ACCESS = process.env.DEV_AUTH_BYPASS === 'true';

/** 우회 모드에서 사용할 가짜 관리자 메일. 사내 도메인이어야 ADMIN으로 취급된다. */
export const DEV_AUTH_EMAIL = process.env.DEV_AUTH_EMAIL ?? 'dev@sparklabs.co.kr';
