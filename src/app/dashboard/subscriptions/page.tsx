/**
 * 로그인해서 바꾸는 구독 설정 화면.
 * 아직 구독자 표에 없는 사람이 들어오면 그 자리에서 만들어 준다 — 사내 도메인이면 누구나
 * 로그인할 수 있으므로, 시드 명단에 빠진 사람도 스스로 구독을 시작할 수 있어야 한다.
 */
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import SubscriptionForm from '@/components/SubscriptionForm';
import { toPrefs } from '@/lib/sparkscope/subscription';

export const dynamic = 'force-dynamic';

const SELECT = {
  email: true, active: true,
  sparklabs: true, portfolio: true, inter: true,
  aiSignals: true, bioSignals: true, competitor: true, industry: true,
} as const;

export default async function SubscriptionsPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect('/login?callbackUrl=%2Fdashboard%2Fsubscriptions');

  const subscriber =
    (await prisma.digestSubscriber.findUnique({ where: { email }, select: SELECT }))
    ?? (await prisma.digestSubscriber.create({
      data: { email, name: session?.user?.name ?? null },
      select: SELECT,
    }));

  return (
    <div className="py-4">
      <SubscriptionForm
        email={subscriber.email}
        initialSections={toPrefs(subscriber)}
        initialActive={subscriber.active}
      />
    </div>
  );
}
