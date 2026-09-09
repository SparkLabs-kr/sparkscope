import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/authz';
import { hasStaleSession } from '@/lib/session-cookie';
import { countPending, canApproveAccess } from '@/lib/sparkscope/access-request';
import { SignOutButton } from '@/components/SignOutButton';
import { ScrollTopButton } from '@/components/ScrollTopButton';
import { DashboardTutorial } from '@/components/DashboardTutorial';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { getT } from '@/lib/i18n/server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // 이 레이아웃이 /dashboard/* 6개 화면의 유일한 관문이다.
  // OPEN_ACCESS 처리는 getSessionUser 안에 있다.
  const user = await getSessionUser();
  // 쿠키가 남아 있는데 세션이 없으면 /login 으로만 보내면 안 된다 — 쿠키가
  // 그대로라 다시 여기로 와서 같은 일이 반복된다. 서버가 쿠키를 지우는
  // 경로로 보내 상태를 끊는다.
  if (!user) redirect(hasStaleSession() ? '/api/session-reset' : '/login');
  // 포트폴리오사 계정도 사내와 같은 화면을 본다 — 다만 열람 전용이다.
  // 쓰기는 각 API 가 requireAdmin 으로 막고, 화면의 편집 컨트롤은
  // canScrap(지정 계정) 으로 이미 감춰진다.
  //
  // 예외는 /dashboard/accounts 다. 그 화면에는 다른 회사 신청자의 이름·메일이
  // 들어 있어서, 회사 계정에 보이면 남의 개인정보가 새는 것이다.
  // (그 화면 자체가 requireAdmin + canApproveAccess 로 막고 있다.)

  const initial = user.email[0].toUpperCase();
  // 접근 요청은 메일로 알리지만, 메일은 실패할 수 있다. 본부가 매일 보는
  // 화면에 대기 건수를 띄워 두면 알림이 실패해도 요청이 묻히지 않는다.
  // 배지는 승인할 수 있는 사람에게만 — 다른 직원에게 보여도 눌러 들어갈 수 없다.
  const mayApprove = canApproveAccess(user.email);
  const { pending, unnotified } = mayApprove
    ? await countPending().catch(() => ({ pending: 0, unnotified: 0 }))
    : { pending: 0, unnotified: 0 };
  const t = getT();

  return (
    <div className="min-h-screen bg-spark-cream">
      <nav className="bg-white/80 backdrop-blur-md border-b border-spark-border px-8 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <span className="w-6 h-6 rounded-lg bg-spark-purple text-white grid place-items-center text-[13px] font-extrabold leading-none">S</span>
            <span className="text-spark-ink font-extrabold tracking-tight text-[15px]">SparkScope</span>
          </Link>
          <span className="hidden sm:inline h-3.5 w-px bg-spark-border" />
          <span className="hidden sm:inline text-xs font-medium text-spark-muted">{t('본부 인사이트 대시보드')}</span>
          <Link href="/chat" className="hidden sm:inline text-xs font-semibold text-spark-muted hover:text-spark-purple transition">💬 {t('챗봇')}</Link>
          <DashboardTutorial />
          {pending > 0 && (
            <Link
              href="/dashboard/accounts"
              className={`text-[11px] font-bold px-2 py-0.5 rounded-md border transition ${
                unnotified > 0
                  ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                  : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
              }`}
              title={unnotified > 0 ? t('알림 메일이 나가지 않은 요청이 있습니다') : undefined}
            >
              {unnotified > 0 ? '⚠ ' : ''}
              {t('접근 요청 {n}건', { n: pending })}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-spark-muted">
          <LanguageSwitcher />
          <span className="hidden md:inline px-2 py-0.5 rounded-md bg-spark-subtle border border-spark-border text-[11px] font-semibold tracking-wide text-spark-ink-soft">{user.role === 'ADMIN' ? '🔒 INTERNAL' : `👁 ${t('열람 전용')}`}</span>
          <span className="hidden md:inline text-[13px]">{user.email}</span>
          <div className="w-7 h-7 rounded-full bg-spark-purple text-white grid place-items-center text-xs font-bold">{initial}</div>
          <SignOutButton />
        </div>
      </nav>
      {/* 폭 상한을 1280px(max-w-7xl)에서 1800px로 넓혔다(2026-09-09).
          예전 값은 본문이 긴 문서를 읽기 좋은 폭이었는데, 이 대시보드는 읽는 화면이
          아니라 훑는 화면이다. 카드가 3열로 놓이는 자리에서 양옆에 각각 160px씩
          빈 띠가 남아 "화면이 안 채워진다"는 지적이 반복됐다.
          완전히 없애지 않은 이유: 초대형 모니터에서 한 줄이 지나치게 길어지면
          기사 제목을 따라 읽기 어려워진다. */}
      <main className="max-w-[1800px] mx-auto px-6 sm:px-8 py-7 animate-rise">{children}</main>
      <ScrollTopButton />
    </div>
  );
}
