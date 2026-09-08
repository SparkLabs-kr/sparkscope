/**
 * 소셜 시그널 갱신 — 외부에서 긁어와 DB에 쌓는 쪽.
 *
 * 화면(/api/inter/social)은 DB만 읽고, 외부 API는 여기서만 부른다.
 * 그 경계를 파일로 갈라 두는 이유: 예전에는 화면을 새로 고칠 때마다 외부를 때렸고,
 * 그래서 (1) 외부가 죽으면 화면이 비고 (2) 레이트리밋을 사용자 클릭 수만큼 소모했다.
 *
 * 크론이 부른다(/api/cron/collect-social). 소스마다 원본이 갱신되는 속도가 달라서
 * 매번 전부 긁지 않고, 주기가 된 소스만 고른다(COLLECT_INTERVAL_SEC).
 */
import {
  collectSocialSignals,
  COLLECT_INTERVAL_SEC,
  DOMAIN_SOURCES,
  NO_TRANSLATE,
  type SocialDomain,
  type SocialSourceId,
} from './social-collect';
import { saveSignals, lastCollectedAt, pruneSignalSamples, findUntranslated, setTitleKo, type RawSignal } from './social-store';
import { translateBatchMemo } from './translate-content';
import { fillHfBlurbs } from './hf-model-blurb';

/** 수집 대상 기간 — 이보다 오래된 글은 애초에 받아오지 않는다. */
const LOOKBACK_DAYS = 30;

export interface RefreshResult {
  domain: SocialDomain;
  /** 주기가 되어 실제로 긁은 소스 */
  refreshed: string[];
  /** 아직 주기가 안 된 소스 (건너뜀) */
  skipped: string[];
  saved: number;
  failed: number;
  translated: number;
}

/**
 * 주기가 된 소스만 골라 긁고 저장한다.
 * @param force true면 주기를 무시하고 전부 긁는다(첫 채움·수동 실행용).
 */
export async function refreshSocialSignals(
  domain: SocialDomain,
  opts: { force?: boolean } = {},
): Promise<RefreshResult> {
  const lastAt = await lastCollectedAt();
  const now = Date.now();

  const wanted = DOMAIN_SOURCES[domain];
  const due = new Set<SocialSourceId>();
  const skipped: string[] = [];

  for (const id of wanted) {
    const last = lastAt.get(id);
    const intervalMs = (COLLECT_INTERVAL_SEC[id] ?? 6 * 3600) * 1000;
    // 한 번도 안 긁었으면 무조건 대상이다.
    if (opts.force || !last || now - last.getTime() >= intervalMs) due.add(id);
    else skipped.push(id);
  }

  if (due.size === 0) {
    return { domain, refreshed: [], skipped, saved: 0, failed: 0, translated: 0 };
  }

  // collectSocialSignals는 도메인 단위로 한꺼번에 긁는다. 주기가 안 된 소스의 결과는
  // 버린다 — 소스별로 호출을 쪼개면 같은 구조를 두 벌 유지해야 해서, 지금 규모에서는
  // 받아서 버리는 쪽이 단순하고 실제 왕복도 크게 늘지 않는다(대부분 같이 주기가 온다).
  const sinceMs = now - LOOKBACK_DAYS * 86400_000;
  const sources = await collectSocialSignals(domain, sinceMs);
  const target = sources.filter(s => due.has(s.id));

  // 한국어 제목은 여기서 한 번만 번역해 DB에 저장한다. 예전에는 조회할 때마다
  // 번역하고 메모리에만 담아서, 배포될 때마다 같은 제목에 다시 과금됐다.
  let translated = 0;
  const toTranslate = target.filter(s => !NO_TRANSLATE.has(s.id));
  const titles = toTranslate.flatMap(s => s.posts.map(p => p.title));
  const koMap = new Map<string, string>();
  if (titles.length > 0) {
    try {
      const ko = await translateBatchMemo(titles, 'ko');
      titles.forEach((t, i) => { if (ko[i]) koMap.set(t, ko[i]!); });
      translated = koMap.size;
    } catch (e) {
      // 번역이 실패해도 원문으로 저장한다 — 이것 때문에 수집 전체가 날아가면 안 된다.
      console.error('[social-refresh] 제목 번역 실패 — 원문으로 저장:', e);
    }
  }

  const rows: RawSignal[] = target.flatMap(s =>
    s.posts.map(p => ({
      source: s.id,
      externalId: p.externalId,
      domain,
      title: p.title,
      titleKo: NO_TRANSLATE.has(s.id) ? null : (koMap.get(p.title) ?? null),
      url: p.url,
      origin: p.origin ?? null,
      author: p.author ?? null,
      publishedAt: p.date ? new Date(p.date) : null,
      points: p.points ?? 0,
      pointsLabel: p.pointsLabel ?? null,
      comments: p.comments ?? 0,
    })),
  );

  const { saved, failed } = await saveSignals(rows);

  // 이번에 새로 받은 것 말고, DB에 남아 있는 미번역 행도 함께 채운다.
  //
  // 왜 필요한가: 번역은 "수집한 그 순간"에만 붙는다. 그래서 이 구조가 생기기 전에 쌓인 행,
  // 번역 호출이 실패한 행, 주기가 안 돌아온 소스의 행은 titleKo가 영원히 null로 남는다.
  // 실제로 그 상태였다 — 2026-09-08 확인 시 Hacker News 223건 중 209건, Reddit 128건 중
  // 108건이 미번역이라 한국어 화면에 영어 문장이 그대로 나갔다(사용자 신고).
  const backfilled = await backfillMissingKo(domain).catch(e => {
    console.error('[social-refresh] 미번역 백필 실패(무시):', e);
    return 0;
  });

  return { domain, refreshed: [...due], skipped, saved, failed, translated: translated + backfilled };
}

/** 한 번에 번역할 미번역 행 수 — 크론 한 회차가 너무 길어지지 않는 선. */
const KO_BACKFILL_LIMIT = 60;

/**
 * titleKo가 비어 있는 행을 채운다. 남아 있으면 다음 회차가 이어서 처리한다.
 * 모델 id처럼 번역하면 안 되는 소스(NO_TRANSLATE)는 건너뛴다.
 */
async function backfillMissingKo(domain: SocialDomain): Promise<number> {
  const ids = DOMAIN_SOURCES[domain].filter(id => !NO_TRANSLATE.has(id));
  if (ids.length === 0) return 0;

  const rows = await findUntranslated(domain, ids, KO_BACKFILL_LIMIT);
  if (rows.length === 0) return 0;

  const ko = await translateBatchMemo(rows.map(r => r.title), 'ko');
  const pairs = rows
    .map((r, i) => ({ id: r.id, titleKo: ko[i] }))
    .filter((p): p is { id: string; titleKo: string } => !!p.titleKo && p.titleKo.trim().length > 0);

  if (pairs.length === 0) return 0;
  await setTitleKo(pairs);
  console.log(`[social-refresh] ${domain} 미번역 ${rows.length}건 중 ${pairs.length}건 번역 저장`);
  return pairs.length;
}

/** 두 도메인을 모두 갱신하고 오래된 샘플을 정리한다. 크론이 부르는 진입점. */
export async function refreshAllSocialSignals(opts: { force?: boolean } = {}) {
  const results: RefreshResult[] = [];
  // 도메인을 순차로 돈다 — 동시에 던지면 두 도메인이 같은 외부(HN·Reddit)를
  // 같은 순간에 때려서 레이트리밋에 걸리기 쉽다.
  for (const domain of ['ai', 'bio'] as SocialDomain[]) {
    try {
      results.push(await refreshSocialSignals(domain, opts));
    } catch (e) {
      console.error('[social-refresh] 도메인 실패:', domain, e);
      results.push({ domain, refreshed: [], skipped: [], saved: 0, failed: 0, translated: 0 });
    }
  }
  // HF 모델 한 줄 설명 — 제목이 모델 id라 그것만으로는 용도를 알 수 없다.
  // 실패해도 수집 결과는 그대로 나간다.
  const blurbs = await fillHfBlurbs().catch(e => {
    console.error('[social-refresh] HF 설명 생성 실패(무시):', e);
    return 0;
  });
  const pruned = await pruneSignalSamples().catch(e => {
    console.error('[social-refresh] 샘플 정리 실패:', e);
    return 0;
  });
  return { results, pruned, blurbs };
}
