/**
 * master-keywords.json → MonitoringTarget DB 동기화.
 * prisma/seed.ts(CLI)와 /api/cron/seed-keywords(자동 배포)가 공유하는 로직.
 * upsert 사용 — 몇 번을 다시 돌려도 안전.
 */
import { prisma } from '@/lib/prisma';
import targets from '../../../data/master-keywords.json';

export interface SeedKeywordsResult {
  total: number;
  created: number;
  updated: number;
  counts: { category: string; status: string; count: number }[];
}

export async function seedKeywords(): Promise<SeedKeywordsResult> {
  let created = 0;
  let updated = 0;

  for (const t of targets as any[]) {
    const existing = await prisma.monitoringTarget.findUnique({ where: { name: t.name } });

    await prisma.monitoringTarget.upsert({
      where: { name: t.name },
      create: t,
      update: {
        englishName: t.englishName,
        category: t.category,
        status: t.status,
        primaryKeyword: t.primaryKeyword,
        helperKeywords: t.helperKeywords,
        excludeWords: t.excludeWords,
        contextWords: t.contextWords ?? null,
        portfolioStatus: t.portfolioStatus ?? null,
        tier: t.tier ?? null,
        notes: t.notes,
      },
    });

    if (existing) updated++;
    else created++;
  }

  const cats = await prisma.monitoringTarget.groupBy({
    by: ['category', 'status'],
    _count: true,
  });

  return {
    total: targets.length,
    created,
    updated,
    counts: cats.map(c => ({ category: c.category, status: c.status, count: c._count })),
  };
}
