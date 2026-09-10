/**
 * 오늘의 시그널 패널의 사전계산 캐시.
 *
 * 왜 필요한가 — 이 패널은 DB에서 읽어 오는 게 아니라 요청마다 전부 새로 만들고 있었다.
 * 2026-09-09 실측(캐시가 다 찬 상태에서도):
 *
 *     collectDigest        3.5초   RSS 25곳 왕복 + 중요도 채점 + 사건 병합 + 키워드
 *     ensureSummaries      7.5초   기사별 쉬운 말 요약
 *     ensurePortfolioHits  1.4초   포트폴리오사 매칭
 *     ─────────────────────────
 *     합계                12.5초
 *
 * 라우트에 revalidate=1800이 걸려 있지만 (도메인 2 × 기간 3) = 6가지 조합이라
 * 캐시 미스가 자주 나고, 그때마다 누군가가 12초를 기다린다. 배포하면 전부 비워진다.
 *
 * 그래서 대시보드 AI 요약이 쓰는 것과 같은 패턴을 적용한다(CLAUDE.md: "미리 계산 →
 * 읽기만"). 크론이 계산해 넣고 화면은 읽기만 한다. 값이 없거나 너무 오래됐으면
 * 그 자리에서 만들어 쓴다 — 화면이 비는 것보다는 느린 게 낫다.
 */
import { prisma } from '@/lib/prisma';
import type { DigestItem, NewsDomain } from './news-digest';
import type { TrendKeyword } from './news-keywords';
import type { EntityCard } from './entity-cards';

const KIND = 'inter_digest';
const keyOf = (domain: NewsDomain, days: number) => `${domain}:${days}`;

export interface DigestPayload {
  items: DigestItem[];
  feeds: { name: string; ok: boolean; count: number }[];
  keywords: TrendKeyword[];
  /** "지금 화제인 이름" 카드 — 기사와 커뮤니티를 이름으로 이어 붙인 것. */
  entities: EntityCard[];
  computedAt: string;
}

/**
 * 이 창의 사전계산이 얼마나 최근인지(밀리초). 없으면 null.
 * 창마다 갱신 주기를 다르게 두려고 쓴다 — precompute-digest.ts 참고.
 */
export async function digestAge(domain: NewsDomain, days: number): Promise<number | null> {
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: KIND, key: keyOf(domain, days) } },
    select: { updatedAt: true },
  });
  return row ? Date.now() - row.updatedAt.getTime() : null;
}

export async function saveDigest(
  domain: NewsDomain, days: number,
  payload: Omit<DigestPayload, 'computedAt'>,
): Promise<void> {
  const value = JSON.stringify({ ...payload, computedAt: new Date().toISOString() });
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND, key: keyOf(domain, days) } },
    create: { kind: KIND, key: keyOf(domain, days), value },
    update: { value },
  });
}

/**
 * 사전계산 결과를 읽는다. maxAgeMs보다 오래됐으면 null을 준다 —
 * 크론이 죽었을 때 며칠 지난 목록을 계속 보여주면 안 된다.
 */
export async function readDigest(
  domain: NewsDomain, days: number, maxAgeMs = 6 * 3600_000,
): Promise<DigestPayload | null> {
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: KIND, key: keyOf(domain, days) } },
    select: { value: true, computedAt: true, updatedAt: true },
  });
  if (!row) return null;
  try {
    const p = JSON.parse(row.value) as DigestPayload;
    const at = Date.parse(p.computedAt ?? '') || row.updatedAt.getTime();
    if (Date.now() - at > maxAgeMs) return null;
    if (!Array.isArray(p.items)) return null;
    return p;
  } catch {
    return null;
  }
}
