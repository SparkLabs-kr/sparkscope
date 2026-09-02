// 포트폴리오사 계정 발급·관리 API — 관리자(role=ADMIN) 전용.
//
// 비밀번호를 쓰지 않으므로 "계정 발급"은 곧 초대다. 관리자가 여기서 만든 User 레코드가
// 있어야 그 메일로 온 매직 링크가 로그인으로 이어진다(src/lib/auth.ts의 signIn 콜백).
// 그래서 계정 비활성화(active=false)는 즉시 로그인 차단이 된다.
//
// 계정은 지우지 않는다 — 지우면 누구에게 열어줬었는지가 사라지고, 북마크도 함께 날아간다.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { adminOrNull } from '@/lib/authz';
import { isStaffEmail } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 계정을 연결할 수 있는 감시대상 = 포트폴리오사. 국가별 분류(_tw 등)를 모두 포함한다. */
const PORTFOLIO_CATEGORY_PREFIX = 'portfolio_company';

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET() {
  const admin = await adminOrNull();
  if (!admin) return bad('권한이 없습니다.', 403);

  const [accounts, companies] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'PORTFOLIO' },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        email: true,
        active: true,
        companyId: true,
        company: { select: { id: true, name: true, category: true } },
        invitedBy: true,
        invitedAt: true,
        deactivatedAt: true,
        lastLoginAt: true,
      },
    }),
    prisma.monitoringTarget.findMany({
      where: { category: { startsWith: PORTFOLIO_CATEGORY_PREFIX }, status: { not: 'DELETED' } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, englishName: true, category: true },
    }),
  ]);

  return NextResponse.json({ accounts, companies });
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  companyId: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const admin = await adminOrNull();
  if (!admin) return bad('권한이 없습니다.', 403);

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad('이메일과 회사를 확인해주세요.');
  const { email, companyId } = parsed.data;

  // 사내 메일로 포트폴리오사 계정을 만들면, 그 사람이 사내 계정으로 다시 로그인할 때
  // 어느 쪽 권한이어야 하는지가 모호해진다. 애초에 막는다.
  if (isStaffEmail(email)) {
    return bad('사내 도메인 메일은 포트폴리오사 계정으로 발급할 수 없습니다. 사내 계정은 로그인 시 자동으로 생성됩니다.');
  }

  const company = await prisma.monitoringTarget.findUnique({
    where: { id: companyId },
    select: { id: true, category: true, status: true },
  });
  if (!company || !company.category.startsWith(PORTFOLIO_CATEGORY_PREFIX)) {
    return bad('포트폴리오사가 아닌 감시대상에는 계정을 연결할 수 없습니다.');
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, active: true },
  });

  // 이미 있는 계정이면 재발급으로 취급한다 — 비활성화했던 계정을 다시 열어주는 경로.
  if (existing) {
    if (existing.role !== 'PORTFOLIO') return bad('이미 내부 계정으로 등록된 메일입니다.', 409);
    const revived = await prisma.user.update({
      where: { id: existing.id },
      data: {
        companyId,
        active: true,
        invitedBy: admin.email,
        invitedAt: new Date(),
        deactivatedAt: null,
      },
      select: { id: true, email: true, active: true, company: { select: { name: true } } },
    });
    return NextResponse.json({ account: revived, revived: true });
  }

  const account = await prisma.user.create({
    data: {
      email,
      role: 'PORTFOLIO',
      companyId,
      active: true,
      invitedBy: admin.email,
      invitedAt: new Date(),
    },
    select: { id: true, email: true, active: true, company: { select: { name: true } } },
  });

  return NextResponse.json({ account, revived: false });
}

const updateSchema = z.object({
  id: z.string().trim().min(1),
  active: z.boolean().optional(),
  companyId: z.string().trim().min(1).optional(),
});

export async function PATCH(req: Request) {
  const admin = await adminOrNull();
  if (!admin) return bad('권한이 없습니다.', 403);

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad('요청이 올바르지 않습니다.');
  const { id, active, companyId } = parsed.data;
  if (active === undefined && companyId === undefined) return bad('변경할 내용이 없습니다.');

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return bad('계정을 찾을 수 없습니다.', 404);
  // 이 API로는 포트폴리오사 계정만 건드린다 — 관리자 계정 권한 조정은 여기 범위가 아니다.
  if (target.role !== 'PORTFOLIO') return bad('내부 계정은 이 화면에서 변경할 수 없습니다.', 403);

  if (companyId) {
    const company = await prisma.monitoringTarget.findUnique({
      where: { id: companyId },
      select: { category: true },
    });
    if (!company || !company.category.startsWith(PORTFOLIO_CATEGORY_PREFIX)) {
      return bad('포트폴리오사가 아닌 감시대상에는 계정을 연결할 수 없습니다.');
    }
  }

  const account = await prisma.user.update({
    where: { id },
    data: {
      ...(companyId ? { companyId } : {}),
      ...(active !== undefined ? { active, deactivatedAt: active ? null : new Date() } : {}),
    },
    select: {
      id: true,
      email: true,
      active: true,
      deactivatedAt: true,
      company: { select: { id: true, name: true } },
    },
  });

  // 비활성화했으면 열려 있는 세션도 끊는다 — 그러지 않으면 이미 로그인해둔 브라우저는
  // 세션이 만료될 때까지 계속 들어온다. (authz.getSessionUser()가 active를 다시 보긴 하지만,
  // 세션 자체를 지워야 확실하다.)
  if (active === false) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  return NextResponse.json({ account });
}
