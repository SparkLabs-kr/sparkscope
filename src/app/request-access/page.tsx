/**
 * 포트폴리오사 접근 요청 — 로그인 없이 열리는 화면.
 *
 * middleware의 matcher가 /dashboard·/digest·/chat·/api 만 보므로 이 경로는 자연히 공개다.
 * 계정이 없는 대표가 쓰는 화면이라 공개여야 한다 — 로그인 뒤에 두면 아무도 도달하지 못한다.
 *
 * 회사 목록을 서버에서 읽어 내려보내는 것이 이 화면의 핵심이다. User.companyId 는
 * MonitoringTarget 을 가리키므로, 자유 입력을 받으면 승인할 때마다 사람이
 * "그 회사가 어느 행인지"를 손으로 맞춰야 한다.
 */
import { prisma } from '@/lib/prisma';
import { RequestAccessForm } from '@/components/RequestAccessForm';

export const runtime = 'nodejs';
// 포트폴리오사 목록은 자주 바뀌지 않는다 — 30분 캐시로 충분하다.
export const revalidate = 1800;

export default async function RequestAccessPage() {
  const companies = await prisma.monitoringTarget
    .findMany({
      where: { category: { startsWith: 'portfolio_company' }, status: 'ACTIVE' },
      select: { id: true, name: true, englishName: true },
      orderBy: { name: 'asc' },
    })
    .catch(() => [] as { id: string; name: string; englishName: string | null }[]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <RequestAccessForm companies={companies} />
    </main>
  );
}
