/**
 * 접근 요청 승인 화면 — 관리자 전용. 메일의 링크가 여기로 온다.
 *
 * 권한은 토큰이 아니라 로그인이 준다. 메일이 전달되거나 새도 토큰만으로는
 * 아무것도 승인되지 않는다(승인 API가 requireAdmin을 본다).
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/authz';
import { listRequests, canApproveAccess } from '@/lib/sparkscope/access-request';
import { AccessRequestList } from '@/components/AccessRequestList';
import { CompanyAccountList } from '@/components/CompanyAccountList';
import { listCompanyAccounts } from '@/lib/sparkscope/company-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?callbackUrl=%2Fdashboard%2Faccounts');
  // 포트폴리오사 계정이 이 화면에 들어오면 다른 회사의 요청까지 보게 된다.
  if (user.role !== 'ADMIN') redirect('/dashboard');
  // 승인은 마케팅팀(ACCESS_REQUEST_APPROVERS)만. 사내 메일이면 전원 ADMIN 이라
  // role 검사만으로는 전 직원이 외부 회사 접근을 허가할 수 있게 된다.
  if (!canApproveAccess(user.email)) redirect('/dashboard');

  const [requests, accounts] = await Promise.all([
    listRequests().catch(() => []),
    listCompanyAccounts().catch(() => []),
  ]);
  return (
    <main className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight mb-1">포트폴리오사 접근 요청</h1>
      <p className="text-[13.5px] text-spark-muted mb-6">
        승인하면 그 주소로 로그인 링크를 받을 수 있게 되고, 계정은 소속 회사 자료만 봅니다.
      </p>
      <AccessRequestList requests={requests} />
      <CompanyAccountList accounts={accounts} />
    </main>
  );
}
