/**
 * 포트폴리오사 계정 목록과 접근 해제 — 승인의 반대편.
 *
 * 승인만 있고 해제가 없으면, 회사가 엑싯하거나 담당자가 퇴사해도 계정이
 * 그대로 남는다. 되돌릴 수 없는 절차는 운영에서 쓰기 어렵다.
 *
 * 지우지 않고 active=false 로 둔다:
 *  - authz.getSessionUser 가 active 아니면 null 을 돌려주고(로그인 상태 무효),
 *    auth.canSignIn 이 새 로그인 링크도 막는다. 두 곳 다 이미 그렇게 되어 있다.
 *  - 행을 지우면 "언제 누구를 들였는지"가 함께 사라진다. 나중에 다시 열어줄
 *    때도 승인 이력이 남아 있는 편이 낫다.
 */
import { prisma } from '@/lib/prisma';

export type CompanyAccount = {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  active: boolean;
  invitedBy: string | null;
  invitedAt: string | null;
  deactivatedAt: string | null;
  lastLoginAt: string | null;
  sessions: number;
};

/** 포트폴리오사 계정 전부 — 활성 먼저, 그다음 해제된 것. */
export async function listCompanyAccounts(): Promise<CompanyAccount[]> {
  const rows = await prisma.user.findMany({
    where: { role: { not: 'ADMIN' } },
    select: {
      id: true, email: true, name: true, active: true,
      invitedBy: true, invitedAt: true, deactivatedAt: true, lastLoginAt: true,
      company: { select: { name: true } },
      _count: { select: { sessions: true } },
    },
    orderBy: [{ active: 'desc' }, { email: 'asc' }],
  });
  return rows.map(r => ({
    id: r.id,
    email: r.email,
    name: r.name,
    companyName: r.company?.name ?? null,
    active: r.active,
    invitedBy: r.invitedBy,
    invitedAt: r.invitedAt?.toISOString() ?? null,
    deactivatedAt: r.deactivatedAt?.toISOString() ?? null,
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
    sessions: r._count.sessions,
  }));
}

/**
 * 접근을 끊는다. 세션까지 지워서 지금 열려 있는 창도 바로 막힌다 —
 * active=false 만으로도 다음 요청에서 걸리지만, 남겨 둘 이유가 없다.
 */
export async function deactivateCompanyAccount(
  userId: string,
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) return { ok: false, reason: 'not_found' };
  // 사내 계정을 여기서 끄면 대시보드에서 스스로를 잠글 수 있다.
  if (user.role === 'ADMIN') return { ok: false, reason: 'is_staff' };

  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.verificationToken.deleteMany({ where: { identifier: user.email } });
  await prisma.user.update({
    where: { id: user.id },
    data: { active: false, deactivatedAt: new Date() },
  });
  return { ok: true, email: user.email };
}

/** 다시 열어 준다. 승인 이력(invitedBy/invitedAt)은 그대로 둔다. */
export async function reactivateCompanyAccount(
  userId: string,
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.role === 'ADMIN') return { ok: false, reason: 'is_staff' };
  await prisma.user.update({
    where: { id: user.id },
    data: { active: true, deactivatedAt: null },
  });
  return { ok: true, email: user.email };
}
