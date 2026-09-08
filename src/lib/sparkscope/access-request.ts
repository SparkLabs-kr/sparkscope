/**
 * 포트폴리오사 접근 요청 — 대표가 신청하고, 마케팅팀이 승인하면 계정이 발급된다.
 *
 * 왜 구글 폼이 아닌가:
 * 요청에서 가장 중요한 값은 "어느 포트폴리오사인가"이고, 그것은 MonitoringTarget의
 * id여야 한다(User.companyId가 그 테이블을 가리킨다). 구글 폼으로 받으면 411곳을
 * 손으로 유지하는 드롭다운이 되거나 자유 입력이 되어, 승인할 때마다 사람이
 * "Acme"가 어느 행인지 번역해야 한다. 사이트 안에서 받으면 목록을 그때그때 읽어
 * 실제 id를 그대로 담을 수 있다.
 *
 * 저장은 DashboardInsight(kind/key/JSON)를 쓴다 — 마이그레이션 없이 쓸 수 있는
 * 범용 캐시가 이미 있고, 프로덕션 DB 드리프트 때문에 새 테이블을 함부로 만들지 않는다.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { OPEN_ACCESS } from '@/lib/flags';

const KIND = 'access_request';

export type AccessRequest = {
  /** 승인/거절 링크에 실리는 값. 요청을 만들 때 한 번만 생성한다. */
  token: string;
  email: string;
  name: string;
  title: string;
  companyId: string;
  companyName: string;
  referrer: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'denied';
  decidedAt?: string;
  decidedBy?: string;
  /**
   * 마케팅팀 알림 메일이 실제로 나갔는지. 메일이 실패했는데 조용히 넘어가면
   * 요청은 저장돼 있지만 아무도 모르는 상태가 된다 — 그 상태를 눈에 보이게
   * 남긴다(대시보드가 이 값을 읽어 경고를 띄운다).
   */
  notified?: boolean;
  notifyError?: string;
};

/** 요청 하나를 만들어 저장한다. 같은 메일로 대기 중인 요청이 있으면 그것을 돌려준다. */
export async function createRequest(
  input: Omit<AccessRequest, 'token' | 'requestedAt' | 'status'>,
): Promise<{ created: boolean; request: AccessRequest }> {
  const email = input.email.trim().toLowerCase();
  const existing = await findPendingByEmail(email);
  if (existing) return { created: false, request: existing };

  const request: AccessRequest = {
    ...input,
    email,
    token: crypto.randomBytes(24).toString('hex'),
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };
  await prisma.dashboardInsight.create({
    data: { kind: KIND, key: request.token, value: JSON.stringify(request) },
  });
  return { created: true, request };
}

export async function getRequest(token: string): Promise<AccessRequest | null> {
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: KIND, key: token } },
    select: { value: true },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as AccessRequest;
  } catch {
    return null;
  }
}

export async function listRequests(): Promise<AccessRequest[]> {
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND },
    orderBy: { computedAt: 'desc' },
    select: { value: true },
  });
  const out: AccessRequest[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.value) as AccessRequest);
    } catch {
      /* 깨진 행은 무시 */
    }
  }
  return out;
}

export async function markDecided(
  token: string,
  status: 'approved' | 'denied',
  decidedBy: string,
): Promise<AccessRequest | null> {
  const req = await getRequest(token);
  if (!req) return null;
  const next: AccessRequest = {
    ...req,
    status,
    decidedAt: new Date().toISOString(),
    decidedBy,
  };
  await prisma.dashboardInsight.update({
    where: { kind_key: { kind: KIND, key: token } },
    data: { value: JSON.stringify(next) },
  });
  return next;
}

async function findPendingByEmail(email: string): Promise<AccessRequest | null> {
  const all = await listRequests();
  return all.find(r => r.email === email && r.status === 'pending') ?? null;
}

/** 알림 메일 발송 결과를 요청에 기록한다. */
export async function markNotified(
  token: string,
  notified: boolean,
  notifyError?: string,
): Promise<void> {
  const request = await getRequest(token);
  if (!request) return;
  const next: AccessRequest = { ...request, notified, notifyError };
  await prisma.dashboardInsight.update({
    where: { kind_key: { kind: KIND, key: token } },
    data: { value: JSON.stringify(next) },
  });
}

/** 대기 중인 요청 수 — 대시보드 배너용. 실패해도 화면을 막지 않는다. */
export async function countPending(): Promise<{ pending: number; unnotified: number }> {
  const all = await listRequests().catch(() => []);
  const pending = all.filter(r => r.status === 'pending');
  return {
    pending: pending.length,
    unnotified: pending.filter(r => r.notified === false).length,
  };
}

/**
 * 승인 권한이 있는 주소. 알림을 받는 사람과 같은 목록을 쓴다 —
 * 목록을 둘로 나누면 사람이 바뀔 때 한쪽만 고쳐져서 어긋난다.
 * ACCESS_REQUEST_APPROVERS 로 따로 지정할 수도 있다.
 *
 * 사내 메일이면 누구나 ADMIN 이 되므로(authz.ts) 승인까지 열어 두면
 * 전 직원이 외부 회사에 포트폴리오 자료 접근을 줄 수 있다. 그래서 승인은
 * 키워드 관리(SCRAP_ALLOWED_EMAILS)처럼 지정된 사람만 한다.
 */
export function accessApprovers(): string[] {
  const raw =
    process.env.ACCESS_REQUEST_APPROVERS ??
    process.env.ACCESS_REQUEST_REVIEWERS ??
    'marketing@sparklabs.co.kr';
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 이 사람이 승인·거절을 할 수 있는가. */
export function canApproveAccess(email: string | null | undefined): boolean {
  if (OPEN_ACCESS) return true; // 로컬 협업 모드
  if (!email) return false;
  return accessApprovers().includes(email.trim().toLowerCase());
}
