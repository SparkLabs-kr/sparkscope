// ────────────────────────────────────────────────────────────────
// 협업 개발 단계 스위치
//
// OPEN_ACCESS = true  →  매직 링크 로그인 없이 /dashboard 바로 공개.
//   (코워커와 함께 개발/고도화하는 동안 사용)
//
// 🔒 사내 실제 발표 전에는 아래 COLLAB_OPEN_ACCESS 를 false 로 바꾸고
//    git commit + push 하면 로그인 보호가 복구됩니다.
//
// 코드에 하드코딩된 상수라 빌드 시 그대로 인라인되어
// Edge 미들웨어·서버 컴포넌트 모두에서 확실히 동작합니다.
// (Vercel 은 일반 환경변수를 Edge 미들웨어에 주입하지 않으므로
//  .env 방식이 아닌 이 상수를 사용합니다.)
// ────────────────────────────────────────────────────────────────
const COLLAB_OPEN_ACCESS = true;

// 로컬 개발 시 .env.local 의 DEV_AUTH_BYPASS 로도 켤 수 있게 fallback 유지
export const OPEN_ACCESS =
  COLLAB_OPEN_ACCESS || process.env.DEV_AUTH_BYPASS === 'true';
