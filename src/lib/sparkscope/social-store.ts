/**
 * 소셜 시그널 저장·조회 — 화면과 외부 API 사이의 완충.
 *
 * 크론이 소스별 주기로 긁어 여기 쌓고(saveSignals), 화면은 DB만 읽는다(readSignals).
 * 다이제스트·DashboardInsight가 쓰는 "미리 계산 → 읽기만"과 같은 패턴.
 *
 * 저장 구조는 maxnambranch(0837a8c)가 먼저 만든 것을 따른다 — 식별키 (source, externalId),
 * 시점별 수치는 SocialSignalSample에 한 줄씩. 그 설계 근거는 schema.prisma 주석 참고.
 *
 * 여기서 달라진 점:
 *  · 저장을 항목마다 SELECT→UPDATE/INSERT 하던 것을 upsert + createMany로 바꿨다.
 *    200건이면 왕복이 600번이었다(조회·쓰기·샘플). 크론이 소스 11개를 도는 구조라
 *    그대로 두면 한 번 도는 데만 수천 왕복이 된다.
 *  · 랭킹을 "지금 점수"가 아니라 "그 기간에 관측된 최고 점수"로 매긴다(readSignals).
 *    이미 식은 글이 낮은 현재 점수 때문에 밀려나면 "그 기간에 뭐가 뜨거웠나"에 답할 수 없다.
 */
import { prisma } from '@/lib/prisma';

/** 어떤 소스에서 왔든 저장 직전에는 이 모양이 된다. */
export interface RawSignal {
  source: string;
  externalId: string;
  domain: 'ai' | 'bio';
  title: string;
  titleKo?: string | null;
  url: string;
  origin?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
  points: number;
  pointsLabel?: string | null;
  comments: number;
}

/**
 * 수집한 것을 저장한다. 처음 보면 새로 만들고, 이미 있으면 최신 수치로 갱신하며,
 * 어느 쪽이든 이번 시점의 수치를 샘플로 남긴다 — 그 차이가 상승 속도가 된다.
 *
 * 한 건이 실패해도 나머지는 저장된다. 소스 하나가 이상한 값을 주는 것 때문에
 * 그날 수집 전체가 날아가면 안 된다.
 */
export async function saveSignals(signals: RawSignal[]): Promise<{ saved: number; failed: number }> {
  if (signals.length === 0) return { saved: 0, failed: 0 };

  const now = new Date();
  const ids: { id: string; points: number; comments: number }[] = [];
  let failed = 0;

  for (const s of signals) {
    const title = s.title?.trim();
    if (!title || !s.externalId || !s.url) { failed++; continue; }
    try {
      const row = await prisma.socialSignal.upsert({
        where: { source_externalId: { source: s.source, externalId: s.externalId } },
        create: {
          source: s.source, externalId: s.externalId, domain: s.domain,
          title, titleKo: s.titleKo ?? null, url: s.url,
          origin: s.origin ?? null, author: s.author ?? null,
          publishedAt: s.publishedAt ?? null,
          points: s.points, pointsLabel: s.pointsLabel ?? null, comments: s.comments,
        },
        update: {
          title, url: s.url, origin: s.origin ?? null, author: s.author ?? null,
          points: s.points, pointsLabel: s.pointsLabel ?? null, comments: s.comments,
          lastSeenAt: now,
          // 번역은 있을 때만 덮어쓴다 — 이번 수집이 번역을 안 했다고 해서
          // 이미 있는 캐시를 지우면 다음 조회에서 다시 돈을 쓴다.
          ...(s.titleKo ? { titleKo: s.titleKo } : {}),
        },
        select: { id: true },
      });
      ids.push({ id: row.id, points: s.points, comments: s.comments });
    } catch (e) {
      failed++;
      console.error('[social-store] 저장 실패:', s.source, s.externalId, e);
    }
  }

  // 샘플은 한 번에 넣는다 — 건마다 INSERT면 왕복이 항목 수만큼 늘어난다.
  if (ids.length > 0) {
    try {
      await prisma.socialSignalSample.createMany({
        data: ids.map(r => ({ signalId: r.id, points: r.points, comments: r.comments, sampledAt: now })),
      });
    } catch (e) {
      // 샘플이 빠져도 항목 자체는 저장됐다 — 속도 계산만 한 칸 비는 것이라 치명적이지 않다.
      console.error('[social-store] 샘플 저장 실패:', e);
    }
  }

  return { saved: ids.length, failed };
}

export interface StoredSignal extends RawSignal {
  /** 그 기간에 관측된 최고 점수. 랭킹은 이 값으로 매긴다. */
  peakPoints: number;
  publishedAt: Date | null;
  lastSeenAt: Date;
}

/**
 * "지금 뜨는 것" 목록이라 발행일로 자르면 안 되는 소스.
 *
 * Hugging Face 인기 모델이 대표적이다 — 2026-08-05에 공개된 Qwen3.8-27B가 지금도
 * 트렌딩 2위인데, 발행일 기준 2주 창으로 자르면 목록에서 빠진다. 실측하면 10건이
 * 4건으로 줄었다(2026-09-08). "언제 나왔나"가 아니라 "지금 뜨거운가"가 기준인
 * 목록이므로, 수집기가 이미 "현재 인기 상위"만 담아 온다는 사실을 신뢰한다.
 *
 * 반대로 arXiv·bioRxiv·PubMed·임상·HF 새 모델은 "새로 나온 것"이 목록의 뜻이라
 * 발행일 창을 그대로 적용한다.
 */
const TIMELESS_SOURCES: ReadonlySet<string> = new Set(['hf', 'hn', 'lobsters']);

/**
 * 저장된 시그널을 읽는다.
 *
 * @param domain   'ai' | 'bio'
 * @param sources  읽을 소스 id 목록
 * @param sinceMs  이 시점 이후에 발행된 것만 (기간 랭킹의 "기간").
 *                 TIMELESS_SOURCES에는 적용하지 않는다.
 * @param perSource 소스당 최대 건수
 */
export async function readSignals(
  domain: 'ai' | 'bio',
  sources: string[],
  sinceMs: number,
  perSource = 10,
): Promise<Map<string, StoredSignal[]>> {
  const since = new Date(sinceMs);
  const timeless = sources.filter(s => TIMELESS_SOURCES.has(s));
  const dated = sources.filter(s => !TIMELESS_SOURCES.has(s));

  const rows = await prisma.socialSignal.findMany({
    where: {
      domain,
      OR: [
        // 지금 뜨는 것 목록 — 발행일을 보지 않는다.
        ...(timeless.length ? [{ source: { in: timeless } }] : []),
        // 새로 나온 것 목록 — 발행일 창을 적용한다.
        // 발행일을 모르는 항목(publishedAt null)도 버리지 않는다 — 논문·임상 쪽에
        // 날짜가 비는 경우가 있고, 그것만으로 목록에서 지울 이유는 없다.
        ...(dated.length ? [{
          source: { in: dated },
          OR: [{ publishedAt: { gte: since } }, { publishedAt: null }],
        }] : []),
      ],
    },
    select: {
      source: true, externalId: true, domain: true, title: true, titleKo: true, url: true,
      origin: true, author: true, publishedAt: true, points: true, pointsLabel: true,
      comments: true, lastSeenAt: true,
      // 최고 점수 — 기간 랭킹의 기준.
      samples: { select: { points: true }, orderBy: { points: 'desc' }, take: 1 },
    },
    // 후보를 넉넉히 받아 아래에서 소스별로 자른다.
    orderBy: { points: 'desc' },
    take: sources.length * perSource * 4,
  });

  const out = new Map<string, StoredSignal[]>();
  for (const r of rows) {
    const peak = Math.max(r.points, r.samples[0]?.points ?? 0);
    const list = out.get(r.source) ?? [];
    list.push({
      source: r.source, externalId: r.externalId, domain: r.domain as 'ai' | 'bio',
      title: r.title, titleKo: r.titleKo, url: r.url, origin: r.origin, author: r.author,
      publishedAt: r.publishedAt, points: r.points, pointsLabel: r.pointsLabel,
      comments: r.comments, peakPoints: peak, lastSeenAt: r.lastSeenAt,
    });
    out.set(r.source, list);
  }

  // 소스마다 정렬 기준이 다르다 — 점수가 있으면 최고 점수 순, 없으면 최신순.
  // 점수 없는 소스(논문·임상)를 점수순으로 세우면 전부 0이라 순서가 무의미해진다.
  for (const [src, list] of out) {
    const ranked = list.some(s => s.peakPoints > 0);
    list.sort(ranked
      ? (a, b) => (b.peakPoints + b.comments * 2) - (a.peakPoints + a.comments * 2)
      : (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
    out.set(src, list.slice(0, perSource));
  }
  return out;
}

/** 소스별 마지막 수집 시각 — 크론이 "지금 돌 차례인 소스"를 고를 때 쓴다. */
export async function lastCollectedAt(): Promise<Map<string, Date>> {
  const rows = await prisma.socialSignal.groupBy({
    by: ['source'],
    _max: { lastSeenAt: true },
  });
  const out = new Map<string, Date>();
  for (const r of rows) if (r._max.lastSeenAt) out.set(r.source, r._max.lastSeenAt);
  return out;
}

/**
 * 오래된 샘플 정리. 소스×항목×시간이라 놔두면 계속 늘어난다.
 * 상승 속도는 최근 며칠만 있으면 되므로 그 밖은 버린다.
 */
export async function pruneSignalSamples(keepDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86400_000);
  const { count } = await prisma.socialSignalSample.deleteMany({ where: { sampledAt: { lt: cutoff } } });
  return count;
}
