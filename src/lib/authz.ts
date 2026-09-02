// 계정 권한 — 2.1 로그인·계정 체계의 단일 진입점.
//
// 화면·API가 "이 사람이 관리자인가", "이 사람이 볼 수 있는 회사는 어디까지인가"를
// 직접 판단하지 않고 전부 여기를 거치게 한다. 판단 로직이 흩어지면
// 새 화면을 붙일 때마다 권한 구멍이 하나씩 생긴다.
//
// role = ADMIN     — 스파크랩 내부. 전체 열람 + 키워드 관리·수집 로그·발송 설정.
// role = PORTFOLIO — 포트폴리오사. 자기 회사 뉴스 + 공개 업계 동향만. 내부 도구는 화면에서 숨긴다.
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions, isStaffEmail } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { OPEN_ACCESS, DEV_AUTH_EMAIL } from '@/lib/flags';
import { canScrap } from '@/lib/scrap';

export type Role = 'ADMIN' | 'PORTFOLIO';

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  /** PORTFOLIO 계정이 소속된 MonitoringTarget.id — ADMIN은 null */
  companyId: string | null;
  /** 소속 회사명(감시대상 name). 대시보드 company 필터가 name 기준이라 함께 싣는다. */
  companyName: string | null;
  active: boolean;
};

/**
 * 현재 로그인 사용자. 미인증이면 null.
 *
 * role/companyId는 세션 콜백(src/lib/auth.ts)이 실어주지만, 관리자가 방금
 * 계정을 비활성화한 경우까지 반영하려면 DB를 한 번 봐야 한다 —
 * database 세션 전략이라 세션 레코드는 비활성화 시점에 갱신되지 않는다.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // 개발용 우회(.env.local의 DEV_AUTH_BYPASS=true)는 여기 한 곳에만 둔다.
  // 예전에는 화면·API 8곳이 각자 가짜 세션을 만들어서, 우회를 끄고 켜는 것만으로
  // 권한 동작이 달라지는 자리가 여러 군데 생겼다.
  if (OPEN_ACCESS) {
    return {
      id: 'dev',
      email: DEV_AUTH_EMAIL,
      role: 'ADMIN',
      companyId: null,
      companyName: null,
      active: true,
    };
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const id = (session?.user as any)?.id as string | undefined;
  if (!email || !id) return null;

  const row = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, active: true, companyId: true, company: { select: { name: true } } },
  });
  if (!row || !row.active) return null;

  // 사내 도메인 메일은 무조건 관리자다 — role 컬럼이 뭐라고 돼 있든 도메인이 기준이다.
  //
  // 이 보정이 필요한 이유: 같은 프로덕션 DB를 main 브랜치와 함께 쓴다. main에는 사내 메일을
  // ADMIN으로 올려주는 코드(events.createUser)가 없어서, 마이그레이션 이후 main 쪽으로 처음
  // 로그인한 직원은 role 기본값인 PORTFOLIO로 만들어진다. 그대로 두면 이 브랜치에서
  // 소속 회사도 없는 포트폴리오사 계정이 되어 아무것도 못 본다.
  //
  // 한 번 보정하면서 DB도 고쳐둔다(실패해도 판단에는 영향 없으므로 조용히 넘어간다).
  const staff = isStaffEmail(row.email);
  if (staff && row.role !== 'ADMIN') {
    await prisma.user
      .update({ where: { id: row.id }, data: { role: 'ADMIN' } })
      .catch(() => {});
  }

  return {
    id: row.id,
    email: row.email,
    role: staff || row.role === 'ADMIN' ? 'ADMIN' : 'PORTFOLIO',
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    active: row.active,
  };
}

/** 서버 컴포넌트용 — 미인증이면 /login으로 보낸다. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** requireAdmin이 막았을 때 안내 화면에 표시할 화면 이름. */
export type AdminSection =
  | 'keywords'
  | 'noise-suggestions'
  | 'scraps'
  | 'accounts'
  | 'digest'
  | 'chat';

/**
 * 서버 컴포넌트용 — 관리자 전용 화면 가드.
 *
 * 포트폴리오사 계정이 주소를 직접 쳐서 들어오면 안내 화면으로 보낸다.
 * 예전에는 조용히 /dashboard로 되돌렸는데, 그러면 링크를 눌렀는데 아무 일도 일어나지 않은
 * 것처럼 보여서 고장인지 권한 문제인지 알 수 없었다.
 *
 * 이미 로그인한 사람에게만 보이는 화면이라 "권한 없음"을 분명히 말해도 된다.
 */
export async function requireAdmin(section?: AdminSection): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    redirect(section ? `/dashboard/no-access?from=${section}` : '/dashboard/no-access');
  }
  return user;
}

/** API 라우트용 — 관리자면 사용자, 아니면 null. 호출부에서 401/403을 만든다. */
export async function adminOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user?.role === 'ADMIN' ? user : null;
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'ADMIN';
}

/**
 * 스크랩·노이즈 처리·다이제스트 발송처럼 "내부 계정 중에서도 지정 계정만" 하는 작업용.
 *
 * 두 조건을 모두 본다 — role=ADMIN(내부 계정)이고, SCRAP_ALLOWED_EMAILS에도 있어야 한다.
 * 목록만 검사하면, 목록에 외부 메일이 잘못 들어갔을 때 포트폴리오사 계정이 본부 도구를
 * 쓸 수 있게 된다.
 */
export async function scrapperOrNull(): Promise<SessionUser | null> {
  const admin = await adminOrNull();
  if (!admin) return null;
  return canScrap(admin.email) ? admin : null;
}

/**
 * 대시보드 회사 필터의 실효값.
 *
 * 포트폴리오 계정은 URL의 ?company=를 무시하고 항상 자기 회사로 고정한다 —
 * 화면에서 필터를 숨기는 것만으로는 URL을 직접 고치면 남의 회사가 보인다.
 * 소속 회사가 아직 연결되지 않은 계정(companyId=null)은 어떤 회사도 열지 않는다.
 */
export function effectiveCompany(
  user: SessionUser,
  requested: string | undefined,
): { company: string | undefined; locked: boolean } {
  if (user.role === 'ADMIN') return { company: requested, locked: false };
  return { company: user.companyName ?? '__no_company__', locked: true };
}
