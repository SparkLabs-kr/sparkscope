/**
 * 메일 푸터 링크로 들어오는 구독 설정 화면 — 로그인이 필요 없다.
 * 로그인 계정이 5개뿐인데 메일 수신자는 훨씬 많아서, 계정 없이도 바꿀 수 있어야 한다.
 * 토큰은 본인만 아는 값(메일로만 전달)이라 이것 자체가 본인 확인 역할을 한다.
 */
import { prisma } from '@/lib/prisma';
import SubscriptionForm from '@/components/SubscriptionForm';
import { toPrefs } from '@/lib/sparkscope/subscription';

export const dynamic = 'force-dynamic';

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const subscriber = token
    ? await prisma.digestSubscriber.findUnique({
        where: { token },
        select: {
          email: true, token: true, active: true,
          sparklabs: true, portfolio: true, inter: true,
          aiSignals: true, competitor: true, industry: true,
        },
      })
    : null;

  if (!subscriber) {
    return (
      <main className="min-h-screen bg-spark-subtle px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-2xl border border-spark-border bg-white p-8 text-center shadow-card">
          <h1 className="text-xl font-bold text-spark-ink">링크가 유효하지 않습니다</h1>
          <p className="mt-2 text-sm text-spark-muted">
            가장 최근에 받은 다이제스트 메일 하단의 &quot;구독 설정 바꾸기&quot; 링크를 다시 눌러 주세요.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-spark-subtle px-4 py-12">
      <SubscriptionForm
        email={subscriber.email}
        token={subscriber.token}
        initialSections={toPrefs(subscriber)}
        initialActive={subscriber.active}
      />
    </main>
  );
}
