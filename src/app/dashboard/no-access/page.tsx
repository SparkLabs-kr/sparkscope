// 권한 없는 화면에 들어왔을 때 — requireAdmin()이 포트폴리오사 계정을 여기로 보낸다.
//
// 예전에는 조용히 /dashboard로 되돌렸다. 그러면 링크를 눌렀는데 아무 일도 안 일어난 것처럼
// 보여서, 사용자는 고장인지 권한 문제인지 알 수 없었다.
//
// 이 화면은 이미 로그인한 사람만 보기 때문에 "권한이 없다"를 분명히 말해도 된다.
// (로그인 폼에서는 같은 말을 할 수 없다 — 거기선 그게 주소 확인 도구가 된다.)
import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { requireUser } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const t = getT();
  // requireAdmin이 아니라 requireUser — 여기서 다시 권한을 따지면 무한 리다이렉트가 된다.
  const user = await requireUser();

  // 어느 화면을 열려다 막혔는지. 화면 이름만 쓰고 임의의 경로는 그대로 노출하지 않는다.
  const SECTION_LABEL: Record<string, string> = {
    keywords: '키워드 관리',
    'noise-suggestions': '노이즈 제안',
    scraps: '스크랩함',
    accounts: '계정 관리',
    digest: '다이제스트 검수·발송',
    chat: '챗봇',
  };
  const section = searchParams.from ? SECTION_LABEL[searchParams.from] : undefined;

  return (
    <div className="mx-auto max-w-xl py-14 text-center">
      <div className="text-5xl mb-4">🔒</div>
      <h1 className="text-2xl font-bold mb-3">
        {section
          ? t('{section}에 접근 권한이 없습니다', { section: t(section) })
          : t('이 화면에 접근 권한이 없습니다')}
      </h1>
      <p className="text-[15px] text-spark-ink-soft leading-relaxed mb-2">
        {t('이 화면은 스파크랩스 내부 계정만 사용할 수 있습니다.')}
      </p>
      <p className="text-[13px] text-spark-muted leading-relaxed mb-7">
        {t('{email} 계정은 포트폴리오사 계정으로, 우리 회사 언론 보도 현황만 볼 수 있습니다.', {
          email: user.email,
        })}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href="/dashboard"
          className="rounded-lg bg-spark-purple px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          {t('내 회사 보도 현황으로')}
        </Link>
      </div>
      <p className="mt-8 text-xs text-spark-muted leading-relaxed">
        {t('권한이 잘못 설정된 것 같다면 담당 스파크랩스 매니저에게 알려주세요.')}
      </p>
    </div>
  );
}
