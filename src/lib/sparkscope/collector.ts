/**
 * 뉴스 수집기 — Google News RSS + (옵션) 네이버 뉴스 검색 API
 * 마스터 시트(MonitoringTarget)의 키워드로 호출하고,
 * 중복 제거·매체 블랙리스트·게시일 필터까지 적용하여
 * RawArticle 배열을 반환.
 */
import { parseStringPromise } from 'xml2js';
import { prisma } from '@/lib/prisma';
import type { RawArticle, Category } from './types';

// 수집 소스가 반환하는 기사 형태 (카테고리·키워드 부여 전)
type SourceItem = Omit<RawArticle, 'matchedKeyword' | 'category' | 'basePriority'>;

// 네이버 API 키가 모두 설정된 경우에만 네이버 수집 활성화
function naverEnabled(): boolean {
  return !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

// 자동생성·노이즈 매체 블랙리스트 (마스터 시트로 옮겨도 됨)
const NOISE_SOURCES = new Set(['주달', '뉴스봇', 'Auto News', '주간시세', '시세분석']);

const MAX_DAYS_AGO = 7;

const CATEGORY_PRIORITY: Record<string, number> = {
  sparklabs_self: 100,
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

  console.log(`[collector] querying ${limited.length} targets across ${grouped.size} categories (Naver: ${naverEnabled() ? 'ON' : 'OFF'})`);

  const allArticles: RawArticle[] = [];
  // 동시 호출 제한 (네트워크 친화적)
  const CONCURRENCY = 5;
  for (let i = 0; i < limited.length; i += CONCURRENCY) {
    const batch = limited.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async target => {
        const items = await fetchForKeyword(target.primaryKeyword);
        return items.map<RawArticle>(item => ({
          ...item,
          matchedKeyword: target.primaryKeyword,
          category: target.category as Category,
          basePriority: CATEGORY_PRIORITY[target.category] ?? 50,
        }));
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

// 한 키워드에 대해 구글 + (옵션)네이버를 함께 수집. 각 소스는 독립적으로 실패 격리.
async function fetchForKeyword(keyword: string): Promise<SourceItem[]> {
  const jobs = [safeSource(() => fetchGoogleNews(keyword), keyword, 'google')];
  if (naverEnabled()) jobs.push(safeSource(() => fetchNaverNews(keyword), keyword, 'naver'));
  const results = await Promise.all(jobs);
  return results.flat();
}

async function safeSource(
  fn: () => Promise<SourceItem[]>,
  keyword: string,
  label: string,
): Promise<SourceItem[]> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[collector] ${label} failed for "${keyword}":`, e);
    return [];
  }
}

async function fetchNaverNews(keyword: string): Promise<SourceItem[]> {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(keyword)}&display=30&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);

  const data = await res.json();
  const items: any[] = data?.items ?? [];
  const out: SourceItem[] = [];

  for (const item of items) {
    const title = stripHtml(item.title ?? '');
    // originallink(원문 URL) 우선, 없으면 네이버 링크
    const link = String(item.originallink || item.link || '').trim();
    if (!title || !link) continue;

    let pubDate: Date;
    try {
      pubDate = new Date(item.pubDate);
      if (isNaN(pubDate.getTime())) continue;
    } catch {
      continue;
    }

    // 네이버는 매체명을 별도로 주지 않아 원문 도메인을 매체로 사용
    const source = domainToSource(link);
    if (NOISE_SOURCES.has(source)) continue;

    out.push({ title, link, source, pubDate });
  }
  return out;
}

// 네이버 제목의 <b> 태그·HTML 엔티티 제거
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function domainToSource(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return 'naver';
  }
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
