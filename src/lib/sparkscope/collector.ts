/**
 * 뉴스 수집기 — Google News RSS + 네이버 뉴스 검색 API.
 * 감시대상(MonitoringTarget) 키워드로 호출하고, 관련성/노이즈 필터·중복 제거·게시일 컷을 적용.
 * 네이버는 name(한글)+englishName+helperKeywords 각각으로 검색 (키가 있을 때만).
 */
import { parseStringPromise } from 'xml2js';
import { prisma } from '@/lib/prisma';
import type { RawArticle, Category } from './types';
import { isRelevant } from './relevance';
import { isKnownMedia } from './media';

type SourceItem = Omit<RawArticle, 'matchedKeyword' | 'category' | 'basePriority'>;
type Target = Awaited<ReturnType<typeof prisma.monitoringTarget.findMany>>[number];

function naverEnabled(): boolean {
  return !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

const NOISE_SOURCES = new Set(['주달', '뉴스봇', 'Auto News', '주간시세', '시세분석']);
const MAX_DAYS_AGO = 7;
const NAVER_DELAY_MS = 150; // 전역 직렬 간격 (병렬 대상이 동시에 때려 429 나는 것 방지)

// 네이버 호출 전역 직렬 스로틀 — 병렬 수집이어도 네이버는 150ms 간격으로 순차 처리.
let naverGate: Promise<unknown> = Promise.resolve();
function throttledNaver(keyword: string): Promise<SourceItem[]> {
  const result = naverGate.then(() => fetchNaverNews(keyword));
  naverGate = result.then(() => sleep(NAVER_DELAY_MS), () => sleep(NAVER_DELAY_MS));
  return result;
}

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function splitCsv(s?: string | null): string[] {
  return (s ?? '').split(',').map(x => x.trim()).filter(Boolean);
}
function uniqueTerms(terms: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const v = (t ?? '').trim();
    if (v.length >= 2 && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

export async function collectAllArticles(opts: CollectOptions = {}): Promise<RawArticle[]> {
  const targets = await prisma.monitoringTarget.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });

  const grouped = new Map<string, Target[]>();
  for (const t of targets) {
    if (!grouped.has(t.category)) grouped.set(t.category, []);
    grouped.get(t.category)!.push(t);
  }

  const max = opts.maxKeywordsPerCategory ?? Infinity;
  const limited: Target[] = [];
  for (const [, list] of grouped) limited.push(...list.slice(0, max));

  console.log(`[collector] querying ${limited.length} targets across ${grouped.size} categories (Naver: ${naverEnabled() ? 'ON' : 'OFF'})`);

  const allArticles: RawArticle[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < limited.length; i += CONCURRENCY) {
    const batch = limited.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async target => {
      const items = await fetchForTarget(target);
      // 포폴사·자사는 회사명이 제목에 강하게 토큰 매칭되면(=isRelevant 통과) 매체 무관 수집.
      // (약사공론·의학신문 등 업종 전문지의 포폴사 부정기사를 놓치지 않기 위함)
      // 경쟁사·업계동향은 기존대로 확정 매체 26개(media.ts)만.
      const strongCat = target.category === 'portfolio_company' || target.category === 'sparklabs_self';
      // 관련성/노이즈 필터: 강한 식별자(회사명·영문명·주키워드) 포함 + 스포츠/광고/제외어 배제
      return items
        .filter(item => strongCat || isKnownMedia(item.source))
        .filter(item => isRelevant({ title: item.title, primaryKeyword: target.primaryKeyword, name: target.name, englishName: target.englishName, helperKeywords: target.helperKeywords, excludeWords: target.excludeWords, category: target.category, link: item.link, source: item.source }))
        .map<RawArticle>(item => ({
          ...item,
          matchedKeyword: target.primaryKeyword,
          category: target.category as Category,
          basePriority: CATEGORY_PRIORITY[target.category] ?? 50,
        }));
    }));
    results.forEach(arr => allArticles.push(...arr));
  }

  console.log(`[collector] raw (relevant) collected: ${allArticles.length}`);
  const filtered = filterAndDedupe(allArticles, opts.daysBack ?? MAX_DAYS_AGO);
  console.log(`[collector] after dedupe: ${filtered.length}`);
  return filtered;
}

// 대상 하나: Google(주키워드) + Naver(이름·영문·보조 다중 검색)
async function fetchForTarget(target: Target): Promise<SourceItem[]> {
  const jobs: Promise<SourceItem[]>[] = [
    safeSource(() => fetchGoogleNews(target.primaryKeyword), target.primaryKeyword, 'google'),
  ];
  if (naverEnabled()) {
    const terms = uniqueTerms([target.primaryKeyword, target.name, target.englishName, ...splitCsv(target.helperKeywords)]);
    jobs.push(fetchNaverForTerms(terms));
  }
  const results = await Promise.all(jobs);
  return results.flat();
}

async function fetchNaverForTerms(terms: string[]): Promise<SourceItem[]> {
  const out: SourceItem[] = [];
  for (const term of terms) {
    try {
      out.push(...await throttledNaver(term)); // 전역 스로틀 통과
    } catch (e) {
      console.error(`[collector] naver failed for "${term}":`, e);
    }
  }
  return out;
}

async function safeSource(fn: () => Promise<SourceItem[]>, keyword: string, label: string): Promise<SourceItem[]> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[collector] ${label} failed for "${keyword}":`, e);
    return [];
  }
}

async function fetchGoogleNews(keyword: string): Promise<SourceItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 SparkScope/0.1' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  const parsed = await parseStringPromise(xml);
  const items = parsed?.rss?.channel?.[0]?.item ?? [];
  const out: SourceItem[] = [];

  for (const item of items) {
    const titleRaw = item.title?.[0] ?? '';
    const link = item.link?.[0] ?? '';
    const pubDateStr = item.pubDate?.[0] ?? '';
    const source = item.source?.[0]?._ ?? item.source?.[0] ?? '';
    if (!titleRaw || !link) continue;
    if (NOISE_SOURCES.has(source)) continue;

    const title = titleRaw.replace(/\s+-\s+[^-]+$/, '').trim();
    let pubDate: Date;
    try {
      pubDate = new Date(pubDateStr);
      if (isNaN(pubDate.getTime())) continue;
    } catch { continue; }

    out.push({ title, link, source, pubDate });
  }
  return out;
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
    const link = String(item.originallink || item.link || '').trim();
    if (!title || !link) continue;

    let pubDate: Date;
    try {
      pubDate = new Date(item.pubDate);
      if (isNaN(pubDate.getTime())) continue;
    } catch { continue; }

    const source = domainToSource(link);
    if (NOISE_SOURCES.has(source)) continue;
    out.push({ title, link, source, pubDate });
  }
  return out;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function domainToSource(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return 'naver';
  }
}

// 최근 N일 + 중복 제거 (URL 우선, 그다음 정규화 제목 기준)
function filterAndDedupe(articles: RawArticle[], daysBack: number): RawArticle[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const seenLinks = new Set<string>();
  const seenTitles = new Map<string, RawArticle>();

  for (const a of articles) {
    if (a.pubDate.getTime() < cutoff) continue;
    if (seenLinks.has(a.link)) continue; // URL 기반 중복 제거
    seenLinks.add(a.link);
    const key = a.title.replace(/\s+/g, '').slice(0, 30);
    const existing = seenTitles.get(key);
    if (!existing || existing.basePriority < a.basePriority) {
      seenTitles.set(key, a);
    }
  }
  return Array.from(seenTitles.values());
}
