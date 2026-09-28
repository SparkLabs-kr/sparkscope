// 다이제스트 발송 검수 콘솔 — 발송 전 TOP3·카테고리 요약·편집자 한 줄 조정 + 미리보기 + 발송.
import Link from 'next/link';
import { getLocale, getT } from '@/lib/i18n/server';
import { ensureArticleEnDeep } from '@/lib/sparkscope/translate-content';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { canScrap } from '@/lib/scrap';
import { loadDigestCandidates, buildReviewDigest } from '@/lib/sparkscope/review';
import { DigestReviewEditor } from '@/components/DigestReviewEditor';
import { buildInterDigest } from '@/lib/sparkscope/inter-digest';
import { loadDailyEdits, intraHeadline, interHeadline, BRIEFING_MAX } from '@/lib/sparkscope/briefing';

export const dynamic = 'force-dynamic';

export default async function DigestReviewPage() {
  const t = getT();
  const session = OPEN_ACCESS ? { user: { email: 'dev@localhost' } } as any : await getServerSession(authOptions);
  const canSend = canScrap(session?.user?.email ?? null);

  const candidates = await loadDigestCandidates();
  // 검수 화면의 후보 제목도 EN이면 영어로 — 메일 본문(미리보기)은 실제 발송본이라 한국어 그대로다.
  if (getLocale() === 'en') await ensureArticleEnDeep([candidates]);
  const initial = buildReviewDigest(candidates);
  // top3는 클러스터링(buildClusteredPool)을 거치며 id 자리에 링크가 들어온다 — 링크로 후보 id를 되찾는다.
  // (id로만 찾던 때는 TOP 3 칸이 늘 비어 보였다.)
  const idByLink = new Map(candidates.map(a => [a.link, a.id]));
  const autoTop3Ids = initial.top3.map(a => idByLink.get(a.link) ?? (a as any).id).filter(Boolean) as string[];
  // 오늘 저장된 편집이 있으면 그 상태로 연다 — 10:30 자동 발송도 이 값을 쓴다.
  const edits = await loadDailyEdits();
  const savedTop3Ids = (edits?.top3Links ?? []).map(l => idByLink.get(l)).filter(Boolean) as string[];
  const initialTop3Ids = savedTop3Ids.length > 0 ? savedTop3Ids : autoTop3Ids;
  const initialExcludedIds = (edits?.excludedLinks ?? []).map(l => idByLink.get(l)).filter(Boolean) as string[];

  // 데일리 브리핑 헤드라인 — 해외 카드는 메일과 같은 블록에서 고른다. 실패하면 국내만.
  const inter = await buildInterDigest().catch(() => null);
  const interOptions = (inter?.cards ?? []).map(interHeadline);
  // 저장된 선택이 없으면 "자동 선정 예상"을 보여준다(발송 크론과 같은 규칙: 국내 TOP3 + 해외 상위 2).
  const suggestedPicks = [
    ...initial.top3.map(a => intraHeadline({ ...a, id: idByLink.get(a.link) })),
    ...interOptions.slice(0, 2),
  ].slice(0, BRIEFING_MAX);

  const dto = candidates.map(a => ({
    id: a.id,
    title: a.title,
    titleEn: a.titleEn,
    link: a.link,
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
          <h1 className="text-3xl font-bold">📤 {t('다이제스트 검수·발송')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('발송 예정: 매주 월·수·금 오전 10시 30분. [오늘 편집 저장]한 TOP 3·제외 기사·브리핑 헤드라인은 자동 발송에 반영되고, 실제 발송 화면을 미리 볼 수 있습니다.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/scraps" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">⭐ {t('스크랩함')}</Link>
          <Link href="/dashboard" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← {t('대시보드')}</Link>
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-gray-500">
          {t('최근 4일 내 발송할 후보 기사가 없습니다. 수집이 실행되면 후보가 채워집니다.')}
        </div>
      ) : (
        <DigestReviewEditor
          candidates={dto}
          initialTop3Ids={initialTop3Ids}
          initialEditorIntro={initial.editorIntro}
          canSend={canSend}
          interOptions={interOptions}
          initialExcludedIds={initialExcludedIds}
          autoTop3Ids={autoTop3Ids}
          savedBriefing={edits?.headlines ?? []}
          hasSavedEdits={!!edits}
          suggestedBriefing={suggestedPicks}
          recipient={process.env.DIGEST_TEST_RECIPIENT ?? process.env.DIGEST_TO_GROUP ?? ''}
        />
      )}
    </>
  );
}
