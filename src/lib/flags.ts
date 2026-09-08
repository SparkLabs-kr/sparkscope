// ────────────────────────────────────────────────────────────────
// 개발용 로그인 우회 스위치
//
// OPEN_ACCESS = true  →  매직 링크 로그인 없이 /dashboard 바로 공개.
//   로컬에서 메일 없이 화면을 보고 싶을 때만 .env.local 에 DEV_AUTH_BYPASS=true.
//
// ⚠️ 프로덕션 빌드에서는 이 스위치가 아예 동작하지 않는다.
//
//    2026-09-08 실측: COLLAB_OPEN_ACCESS 를 false 로 바꿔 커밋·배포했는데도
//    프로덕션 /dashboard 가 로그인 없이 200을 돌려줬다. 최신 코드는 배포됐고
//    (x-vercel-cache MISS, 새 UI 문구로 확인) 캐시도 아니었다.
//    원인은 아래 `||` 뒤쪽 — Vercel 환경변수에 DEV_AUTH_BYPASS=true 가 남아 있어
//    상수를 false 로 바꿔도 우회가 계속 켜져 있었다. 게다가 Vercel 에서
//    민감(sensitive)으로 저장된 값은 나중에 열어볼 수 없어서, 켜져 있는지조차
//    확인할 수 없었다. "코드는 닫혔다고 말하는데 실제로는 열려 있는" 상태가
//    그냥 열려 있는 것보다 나쁘다 — 아무도 다시 확인하지 않게 되기 때문이다.
//
//    그래서 NODE_ENV 을 함께 본다. `next build` 로 만들어진 프로덕션 서버에서는
//    어떤 환경변수를 넣어도 우회가 켜지지 않는다.
//    끄는 것을 잊는 실수보다, 켤 방법이 없는 쪽이 안전하다.
//
// 상수는 코드에 하드코딩돼 빌드 시 인라인되므로 Edge 미들웨어에서도 확실히 동작한다
// (Vercel 은 일반 환경변수를 Edge 미들웨어에 주입하지 않는다).
// ────────────────────────────────────────────────────────────────
const COLLAB_OPEN_ACCESS = false;

const bypassRequested = COLLAB_OPEN_ACCESS || process.env.DEV_AUTH_BYPASS === 'true';
const isProduction = process.env.NODE_ENV === 'production';

export const OPEN_ACCESS = bypassRequested && !isProduction;

// 프로덕션에서 우회를 켜려 한 흔적이 있으면 로그로 남긴다 — 조용히 무시하면
// "왜 로컬에선 되는데 배포하면 로그인을 요구하지?" 를 한참 헤매게 된다.
if (bypassRequested && isProduction) {
  console.warn(
    '[flags] 로그인 우회(DEV_AUTH_BYPASS / COLLAB_OPEN_ACCESS)가 켜져 있지만 ' +
      '프로덕션 빌드이므로 무시합니다. 로그인은 정상적으로 요구됩니다. ' +
      'Vercel 환경변수의 DEV_AUTH_BYPASS 는 지우는 것이 좋습니다.',
  );
}
