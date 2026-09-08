/**
 * 소셜 시그널 API — Inter 탭 도메인별 커뮤니티·모델·논문 시그널.
 * GET /api/inter/social?domain=bio|ai&hours=24&lang=ko
 *
 * DB만 읽는다. 외부 API는 크론(/api/cron/collect-social)이 소스별 주기로 부른다.
 * 예전에는 이 라우트가 조회할 때마다 외부를 직접 때려서 —
 *   · 외부가 죽거나 레이트리밋에 걸리면 그 순간 화면이 비었고,
 *   · "지난 24시간 중 가장 화제였던 글"을 물어볼 수 없었으며(지금 순간만 알았다),
 *   · 같은 제목을 매번 다시 번역했다(메모리 캐시라 배포마다 날아갔다).
 *
 * 다만 DB가 비어 있으면(첫 배포·새 소스 추가 직후) 그 자리에서 한 번 긁어 채운다 —
 * 크론이 처음 돌 때까지 화면이 비어 있는 것보다 낫다.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  DOMAIN_SOURCES,
  SOURCE_META,
  whyOf,
  type SocialDomain,
  type SocialSource,
  type SocialSourceId,
} from '@/lib/sparkscope/social-collect';
import { readSignals } from '@/lib/sparkscope/social-store';
import { refreshSocialSignals } from '@/lib/sparkscope/social-refresh';

export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
// DB 조회라 짧게 잡아도 부담이 없다. 크론이 채운 것을 빨리 반영하는 쪽이 낫다.
export const revalidate = 300;

/** 기본 조회 창 — "요즘 뭐가 뜨나"는 최근 2주 정도가 자연스럽다. */
const DEFAULT_HOURS = 24 * 14;

/** DB에서 읽은 것을 화면이 쓰는 모양(SocialSource[])으로 되살린다. */
async function buildSources(domain: SocialDomain, sinceMs: number): Promise<SocialSource[]> {
  const ids = DOMAIN_SOURCES[domain];
  const bySource = await readSignals(domain, ids, sinceMs);

  return ids.map<SocialSource>(id => {
    const rows = bySource.get(id) ?? [];
    const meta = SOURCE_META[id];
    return {
      id,
      label: meta.label,
      connected: rows.length > 0,
      // 점수가 실제로 있는 소스만 "인기순"이라고 말한다 — 전부 0인데 인기순이라고
      // 표시하면 순위가 아닌 목록을 순위로 오해하게 된다.
      ranked: meta.ranked && rows.some(r => r.peakPoints > 0),
      note: meta.note,
      why: whyOf(id),
      posts: rows.map(r => ({
        externalId: r.externalId,
        title: r.title,
        titleKo: r.titleKo ?? undefined,
        url: r.url,
        date: r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : '',
        // 화면에는 그 기간의 최고 점수를 보여준다 — 랭킹 기준과 표시 값이 달라지면
        // "왜 이게 위에 있지?"를 설명할 수 없다.
        points: r.peakPoints > 0 ? r.peakPoints : undefined,
        pointsLabel: r.pointsLabel ?? undefined,
        comments: r.comments || undefined,
        origin: r.origin ?? undefined,
        author: r.author ?? undefined,
      })),
    };
  });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const domain: SocialDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';

  const hoursRaw = Number(sp.get('hours'));
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 90) : DEFAULT_HOURS;
  const sinceMs = Date.now() - hours * 3600_000;

  try {
    let sources = await buildSources(domain, sinceMs);

    // 첫 채움 — 아직 크론이 한 번도 안 돌았거나 소스를 새로 추가한 직후.
    if (sources.every(s => s.posts.length === 0)) {
      console.log(`[api/inter/social] ${domain} DB 비어 있음 — 즉석 수집 후 저장`);
      await refreshSocialSignals(domain, { force: true });
      sources = await buildSources(domain, sinceMs);
    }

    return NextResponse.json({ domain, hours, sources: sources.filter(s => s.posts.length > 0) });
  } catch (e: any) {
    console.error('[api/inter/social] 실패:', e);
    // 이 패널 하나 때문에 Inter 탭 전체가 죽으면 안 된다 — 빈 배열로 응답한다.
    return NextResponse.json({ domain, sources: [], error: String(e?.message ?? e) }, { status: 200 });
  }
}
