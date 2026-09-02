// ────────────────────────────────────────────────────────────────
// 개발용 로그인 우회 스위치
//
// 로컬에서 메일 없이 화면을 보고 싶을 때만 .env.local에
//   DEV_AUTH_BYPASS=true
// 를 넣는다. 권한 판단은 src/lib/authz.ts가 하고, 우회도 거기 한 곳에서만 적용된다.
//
// ⚠️ 프로덕션 빌드에서는 이 스위치가 아예 동작하지 않는다.
//
//    환경변수만으로 판단하면, Vercel에 DEV_AUTH_BYPASS=true 가 (실수로든 예전 설정이
//    남아서든) 들어 있는 순간 로그인이 통째로 꺼지고 대시보드가 공개된다. 게다가 Vercel에서
//    민감(sensitive)으로 저장된 값은 나중에 열어볼 수 없어서, 켜져 있는지조차 확인할 수 없다.
//
//    그래서 NODE_ENV까지 함께 본다. `next build`로 만들어진 프로덕션 서버에서는
//    NODE_ENV가 'production'이라 어떤 환경변수를 넣어도 우회가 켜지지 않는다.
//    끄는 것을 잊는 실수보다, 켜는 방법이 없는 쪽이 안전하다.
// ────────────────────────────────────────────────────────────────
const bypassRequested = process.env.DEV_AUTH_BYPASS === 'true';
const isProduction = process.env.NODE_ENV === 'production';

export const OPEN_ACCESS = bypassRequested && !isProduction;

// 프로덕션에서 우회를 켜려 한 흔적이 있으면 로그로 남긴다 — 조용히 무시하면
// "왜 로컬에선 되는데 배포하면 로그인을 요구하지?" 를 한참 헤매게 된다.
if (bypassRequested && isProduction) {
  console.warn(
    '[flags] DEV_AUTH_BYPASS=true 가 설정돼 있지만 프로덕션 빌드이므로 무시합니다. ' +
      '로그인은 정상적으로 요구됩니다. 이 환경변수는 배포 환경에서 지우는 것이 좋습니다.',
  );
}

/** 우회 모드에서 사용할 가짜 관리자 메일. 사내 도메인이어야 ADMIN으로 취급된다. */
export const DEV_AUTH_EMAIL = process.env.DEV_AUTH_EMAIL ?? 'dev@sparklabs.co.kr';
