// 다이제스트 발송 검수 콘솔 — 발송 전 TOP3·카테고리 요약·편집자 한 줄 조정 + 미리보기 + 발송.
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { canScrap } from '@/lib/scrap';
import { loadDigestCandidates, buildReviewDigest } from '@/lib/sparkscope/review';
import { DigestReviewEditor } from '@/components/DigestReviewEditor';

export const dynamic = 'force-dynamic';

export default async function DigestReviewPage() {
  const session = OPEN_ACCESS ? { user: { email: 'dev@localhost' } } as any : await getServerSession(authOptions);
  const canSend = canScrap(session?.user?.email ?? null);

  const candidates = await loadDigestCandidates();
  const initial = buildReviewDigest(candidates);
  const initialTop3Ids = initial.top3.map(a => (a as any).id).filter(Boolean) as string[];

  const dto = candidates.map(a => ({
    id: a.id,
    title: a.title,
    source: a.source,
    category: a.category,
    oneLiner: a.oneLiner,
    pitchScore: a.pitchScore,
    isScrapped: a.isScrapped,
    priorityScore: a.priorityScore,
    matchedKeyword: a.matchedKeyword,
    pubDate: a.pubDate instanceof Date ? a.pubDate.toISOString() : String(a.pubDate),
  }));

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">📤 다이제스트 검수·발송</h1>
          <p className="text-sm text-gray-500 mt-1">
            발송 예정: 매주 월·수·금 오전 9시. 발송 전 TOP 3 순서·포함, 카테고리 요약, 편집자 한 줄을 조정하고 실제 발송 화면을 미리 볼 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/scraps" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">⭐ 스크랩함</Link>
          <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← 대시보드</Link>
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-gray-500">
          최근 4일 내 발송할 후보 기사가 없습니다. 수집이 실행되면 후보가 채워집니다.
        </div>
      ) : (
        <DigestReviewEditor
          candidates={dto}
          initialTop3Ids={initialTop3Ids}
          initialEditorIntro={initial.editorIntro}
          canSend={canSend}
          recipient={process.env.DIGEST_TEST_RECIPIENT ?? process.env.DIGEST_TO_GROUP ?? ''}
        />
      )}
    </>
  );
}
