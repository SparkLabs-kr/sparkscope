/**
 * 사용자 유형 3종 — 누가 무엇을 할 수 있는지의 단일 기준.
 *
 * 2026-09-22 이전에는 등급이 사실상 2개였다: "사내 도메인 메일 = 무조건 ADMIN"이라
 * 인턴을 포함한 모든 @sparklabs.co.kr 계정에 계정 발급·키워드 편집·노이즈 승인까지
 * 전부 열려 있었다(authz.ts 가 DB 의 role 을 덮어썼다). 마케팅팀은 전체를 관리하는
 * 역할이고 다른 임직원은 읽기만 하면 되는데, 그 차이를 표현할 방법이 없었다.
 *
 *   ADMIN     커뮤니케이션본부 지정 계정. 관리 기능 전부.
 *   STAFF     그 외 사내 임직원·인턴. 전사 열람 + 북마크. 관리 기능은 403.
 *   PORTFOLIO 포트폴리오사 대표. 기사는 전체, 내부 분석은 전부 가림.
 *
 * ADMIN 은 "도메인"이 아니라 "명단"으로 정한다. 도메인으로 정하면 사내 계정이
 * 하나 늘 때마다 관리자가 하나 느는데, 그건 아무도 의도한 적이 없는 승격이다.
 * 명단으로 두면 권한 회수도 환경변수 한 줄을 지우는 일이 된다 — 담당자가 바뀌거나
 * 인턴 기간이 끝날 때 계정을 지우지 않고도 관리 기능만 닫힌다.
 */
import { OPEN_ACCESS } from '@/lib/flags';

export type Role = 'ADMIN' | 'STAFF' | 'PORTFOLIO';

/**
 * 사내 도메인 목록. 여러 오피스를 쉼표로 넣는다(예전 단수형 이름도 계속 읽는다).
 *
 * ⚠️ 이 목록에 넣는다는 것은 "그 도메인 메일이면 사내 임직원(STAFF)"이라는 뜻이다.
 * 우리가 실제로 통제하는 회사 도메인만 넣는다. gmail.com 같은 공용 도메인은 절대 안 된다.
 * 관리자 승격은 이 목록이 아니라 아래 ADMIN_EMAILS 가 한다.
 *
 * 매번 읽는 이유: 모듈 로드 시점에 상수로 굳혀 두면 테스트에서 환경변수를 바꿔도
 * 반영되지 않고, 무엇보다 "왜 바꿨는데 안 먹지"를 한참 헤매게 된다.
 */
function staffDomains(): string[] {
  return (
    process.env.ALLOWED_EMAIL_DOMAINS ??
    process.env.ALLOWED_EMAIL_DOMAIN ??
    'sparklabs.co.kr'
  )
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** 구글 로그인 화면에 넘길 도메인 힌트(hd). 사내 도메인 중 첫 번째. */
export function primaryStaffDomain(): string {
  return staffDomains()[0] ?? 'sparklabs.co.kr';
}

/**
 * 사내 계정인가 — 도메인만으로 판단한다.
 * '@'를 붙여 비교하는 것이 중요하다. 빼면 notsparklabs.co.kr 같은 남의 도메인이 통과한다.
 */
export function isStaffEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const addr = email.trim().toLowerCase();
  return staffDomains().some(d => addr.endsWith(`@${d}`));
}

/**
 * 관리자 명단.
 *
 * 기본값을 접근요청 승인자(ACCESS_REQUEST_APPROVERS)와 같은 주소로 둔 이유:
 * 이 변경 전까지 실제로 계정 발급·승인을 하던 사람들이 그들이다. ADMIN_EMAILS 를
 * 설정하기 전에 배포되더라도 관리 화면에 아무도 못 들어가는 상태가 되지 않는다.
 *
 * 승인자 명단과 관리자 명단을 따로 두지 않는다 — 두 개가 되면 반드시 어긋나고,
 * "승인은 되는데 계정 발급은 안 되는" 사람이 생긴다. access-request.ts 의
 * accessApprovers() 도 이 함수를 쓴다.
 */
export function adminEmails(): string[] {
  const raw =
    process.env.ADMIN_EMAILS ??
    process.env.ACCESS_REQUEST_APPROVERS ??
    process.env.ACCESS_REQUEST_REVIEWERS ??
    'marketing@sparklabs.co.kr,sparkai@sparklabs.co.kr';
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

/**
 * 최종 등급 판정 — 등급을 묻는 곳은 전부 이 함수를 거친다.
 *
 * 사내 메일인데 명단에 없으면 STAFF 다. 반대로 DB 의 role 이 ADMIN 이어도 사내 메일이
 * 아니면 관리자가 되지 않는다 — 외부 계정이 실수로 승격되는 경로를 막는다.
 *
 * dbRole 을 함께 보는 이유는 화면에서 개별 승격을 하게 될 때를 위한 자리다.
 * 지금은 옛 데이터(모든 사내 계정이 ADMIN 으로 적혀 있다)와 섞이므로,
 * 사내 메일이면서 명단에 없는 경우에는 dbRole 을 신뢰하지 않는다.
 */
export function resolveRole(email: string, _dbRole?: string | null): Role {
  if (OPEN_ACCESS) return 'ADMIN';
  if (!isStaffEmail(email)) return 'PORTFOLIO';
  return isAdminEmail(email) ? 'ADMIN' : 'STAFF';
}

/** 사내 사람인가 — 전사 데이터를 볼 수 있는가(ADMIN·STAFF 공통). */
export function isInternal(role: Role): boolean {
  return role === 'ADMIN' || role === 'STAFF';
}

/**
 * 화면 우상단 배지 — 지금 내가 무엇을 할 수 있는 상태인지 한눈에 보이게 한다.
 * 권한이 바뀌면(ADMIN_EMAILS 에서 빠지면) 이 배지가 먼저 바뀐다.
 *
 * 영문을 en.ts 사전에 맡기지 않고 여기 함께 두는 이유: 사전의 키는 한국어 원문이라
 * 같은 낱말이 다른 뜻으로 이미 등록돼 있으면 부딪힌다. 실제로 '포트폴리오사'는
 * 복수형 필터 라벨('Portfolio companies')로, '포트폴리오사 계정'은 관리 화면 제목으로
 * 이미 쓰이고 있었다. 배지는 짧은 고정 라벨이므로 사전을 거칠 이유가 없다.
 */
export const ROLE_BADGE: Record<Role, { label: string; labelEn: string; icon: string; tone: string }> = {
  ADMIN: { label: '관리자', labelEn: 'Admin', icon: '🔒', tone: 'bg-spark-light-purple border-spark-purple/30 text-spark-purple' },
  STAFF: { label: '임직원', labelEn: 'Staff', icon: '👁', tone: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  PORTFOLIO: { label: '포트폴리오사', labelEn: 'Portfolio', icon: '🏢', tone: 'bg-amber-50 border-amber-200 text-amber-800' },
};
