// ────────────────────────────────────────────────────────────────
// 개발용 로그인 우회 스위치
//
// 로컬에서 메일 없이 화면을 보고 싶을 때만 .env.local에
//   DEV_AUTH_BYPASS=true
// 를 넣는다.
//
// ⚠️ 프로덕션 빌드에서는 이 스위치가 아예 동작하지 않는다.
//
//    2026-09-08까지 이 파일에는 COLLAB_OPEN_ACCESS = true 가 하드코딩돼 있었다.
//    "사내 발표 전에 false로 바꾸라"는 주석과 함께였는데, 바꾸는 것을 잊은 채 배포가
//    이어졌다. 실측 결과 프로덕션 /dashboard가 로그인 없이 200으로 열렸고,
//    /api/inter는 미인증 요청에 264KB를 돌려주며 그 안에 포트폴리오사 매칭
//    (회사명 + 어떤 트렌드에 연결됐는지)이 그대로 들어 있었다.
//
//    환경변수만으로 판단해도 같은 사고가 난다 — Vercel에 DEV_AUTH_BYPASS=true가
//    남아 있으면 로그인이 통째로 꺼지고, 민감(sensitive)으로 저장된 값은 나중에
//    열어볼 수도 없어서 켜져 있는지조차 확인이 안 된다.
//
//    그래서 NODE_ENV까지 함께 본다. `next build`로 만들어진 프로덕션 서버에서는
//    어떤 값을 넣어도 우회가 켜지지 않는다.
//    끄는 것을 잊는 실수보다, 켜는 방법이 없는 쪽이 안전하다.
//
// (원 수정은 maxnambranch의 426cf65 — main에 반영되지 않아 여기서 다시 적용한다.)
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

/** 우회 모드에서 사용할 가짜 관리자 메일. 사내 도메인이어야 내부 사용자로 취급된다. */
export const DEV_AUTH_EMAIL = process.env.DEV_AUTH_EMAIL ?? 'dev@sparklabs.co.kr';
