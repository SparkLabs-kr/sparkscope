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
