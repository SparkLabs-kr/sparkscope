/**
 * 뉴스 수집기 — Google News RSS + (옵션) 네이버 뉴스 검색 API
 * 마스터 시트(MonitoringTarget)의 키워드로 호출하고,
 * 중복 제거·매체 블랙리스트·게시일 필터까지 적용하여
 * RawArticle 배열을 반환.
 */
import { parseStringPromise } from 'xml2js';
import { prisma } from '@/lib/prisma';
import type { RawArticle, Category } from './types';

// 자동생성·노이즈 매체 블랙리스트 (마스터 시트로 옮겨도 됨)
const NOISE_SOURCES = new Set(['주달', '뉴스봇', 'Auto News', '주간시세', '시세분석']);

const MAX_DAYS_AGO = 7;

const CATEGORY_PRIORITY: Record<string, number> = {
  sparklabs_self: 100,
  sparklabs_executive: 95,
  portfolio_company: 70,
  competitor: 50,
  industry_trend: 40,
};

interface CollectOptions {
  maxKeywordsPerCategory?: number;
  daysBack?: number;
}

export async function collectAllArticles(opts: CollectOptions = {}): Promise<RawArticle[]> {
  const targets = await prisma.monitoringTarget.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });

  // 카테고리별 쿼터로 균형 유지
  const grouped = new Map<string, typeof targets>();
  for (const t of targets) {
    if (!grouped.has(t.category)) grouped.set(t.category, []);
    grouped.get(t.category)!.push(t);
  }

  const max = opts.maxKeywordsPerCategory ?? Infinity;
  const limited: typeof targets = [];
  for (const [, list] of grouped) {
    limited.push(...list.slice(0, max));
  }

  console.log(`[collector] querying ${limited.length} targets across ${grouped.size} categories`);

  const allArticles: RawArticle[] = [];
  // 동시 호출 제한 (네트워크 친화적)
  const CONCURRENCY = 5;
  for (let i = 0; i < limited.length; i += CONCURRENCY) {
    const batch = limited.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async target => {
        try {
          const items = await fetchGoogleNews(target.primaryKeyword);
          return items.map<RawArticle>(item => ({
            ...item,
            matchedKeyword: target.primaryKeyword,
            category: target.category as Category,
            basePriority: CATEGORY_PRIORITY[target.category] ?? 50,
          }));
        } catch (e) {
          console.error(`[collector] failed for "${target.primaryKeyword}":`, e);
          return [];
        }
      }),
    );
    results.forEach(arr => allArticles.push(...arr));
  }

  console.log(`[collector] raw collected: ${allArticles.length}`);

  const filtered = filterAndDedupe(allArticles, opts.daysBack ?? MAX_DAYS_AGO);
  console.log(`[collector] after dedupe: ${filtered.length}`);

  return filtered;
}

async function fetchGoogleNews(keyword: string): Promise<Omit<RawArticle, 'matchedKeyword' | 'category' | 'basePriority'>[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 SparkScope/0.1' },
    // edge runtime 호환을 위해 no-store
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  const parsed = await parseStringPromise(xml);

  const items = parsed?.rss?.channel?.[0]?.item ?? [];
  const out: Omit<RawArticle, 'matchedKeyword' | 'category' | 'basePriority'>[] = [];

  for (const item of items) {
    const titleRaw = item.title?.[0] ?? '';
    const link = item.link?.[0] ?? '';
    const pubDateStr = item.pubDate?.[0] ?? '';
    const source = item.source?.[0]?._ ?? item.source?.[0] ?? '';

    if (!titleRaw || !link) continue;
    if (NOISE_SOURCES.has(source)) continue;

    // Google News 형식 "제목 - 매체명" → 매체명 제거
    const title = titleRaw.replace(/\s+-\s+[^-]+$/, '').trim();

    let pubDate: Date;
    try {
      pubDate = new Date(pubDateStr);
      if (isNaN(pubDate.getTime())) continue;
    } catch {
      continue;
    }

    out.push({ title, link, source, pubDate });
  }
  return out;
}

function filterAndDedupe(articles: RawArticle[], daysBack: number): RawArticle[] {
  const now = Date.now();
  const cutoff = now - daysBack * 24 * 60 * 60 * 1000;

  // 최근 N일 + 중복 제거 (정규화된 제목 기준)
  const seen = new Map<string, RawArticle>();
  for (const a of articles) {
    if (a.pubDate.getTime() < cutoff) continue;
    const key = a.title.replace(/\s+/g, '').slice(0, 30);
    const existing = seen.get(key);
    if (!existing || existing.basePriority < a.basePriority) {
      seen.set(key, a);
    }
  }
  return Array.from(seen.values());
}
