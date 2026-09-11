/**
 * 다이제스트 기사 → 포트폴리오사 영향 매칭.
 *
 * 새로 만들지 않고 Inter 탭이 쓰는 inter-portfolio-match.ts를 그대로 재사용한다.
 * 그쪽에는 이미 (a) 회사 목록을 system에 두어 프롬프트 캐시가 걸리게 하는 구조와
 * (b) "막연한 개연성으로 아무 회사나 갖다 붙이지 말라"는 엄격한 판정 기준이 들어 있다.
 * 특히 (a)는 2026-08-05에 같은 회사 목록을 784번 전액 결제해 크레딧이 소진된 뒤
 * 나온 구조라, 여기서 프롬프트를 새로 짜면 그 사고를 반복하게 된다.
 *
 * 캐시는 요약과 같은 DashboardInsight를 쓰되 kind만 다르게 둔다.
 * 기사 URL 단위라 같은 기사에 두 번 과금되지 않는다.
 */
import OpenAI from 'openai';
import { translateBatch } from './translate-content';
import { prisma } from '@/lib/prisma';
import { buildSystemPrompt, analyzeBatch } from './inter-portfolio-match';
import type { DigestItem } from './news-digest';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const KIND = 'news_portfolio';
const MAX_DESC_CHARS = 120;
/** 한 번의 조회에서 새로 매칭할 기사 수. 나머지는 다음 조회가 채운다. */
const MAX_NEW = 12;
/** 한 호출에 넣을 기사 수 — 기존 매처와 같은 값. */
const BATCH = 10;

export type PortfolioHit = {
  company: string;
  reason: string;
  /** EN 화면용. 같은 캐시 행에 함께 저장해 기사당 한 번만 번역한다. */
  companyEn?: string | null;
  reasonEn?: string | null;
};

/** 회사 목록. 한국·대만 포트폴리오사를 함께 본다 — 해외 뉴스는 어느 쪽에도 영향을 준다. */
async function loadCompanies() {
  const rows = await prisma.monitoringTarget.findMany({
    where: { category: { in: ['portfolio_company', 'portfolio_company_tw'] }, status: 'ACTIVE' },
    select: { name: true, englishName: true, notes: true },
  });
  return rows.map(c => {
    const raw = (c.notes ?? '').split('\n')[0]!.trim() || c.englishName || c.name;
    return { name: c.name, profile: raw.length > MAX_DESC_CHARS ? `${raw.slice(0, MAX_DESC_CHARS)}…` : raw };
  });
}

async function readCache(urls: string[]): Promise<Map<string, PortfolioHit[]>> {
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND, key: { in: urls } },
    select: { key: true, value: true },
  });
  const out = new Map<string, PortfolioHit[]>();
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value);
      if (Array.isArray(v)) out.set(r.key, v);
    } catch { /* 깨진 캐시는 무시하고 다시 만든다 */ }
  }
  return out;
}

/**
 * 각 기사에 영향받을 만한 포트폴리오사를 채운다.
 * 매칭이 0건인 것이 정상이다 — 대부분의 해외 뉴스는 우리 포트폴리오와 직접 관계가 없다.
 */
export async function ensurePortfolioHits(items: DigestItem[]): Promise<DigestItem[]> {
  if (items.length === 0) return items;

  const cached = await readCache(items.map(i => i.url)).catch(() => new Map<string, PortfolioHit[]>());
  for (const it of items) it.portfolio = cached.get(it.url) ?? null;

  const todo = items.filter(i => i.portfolio === null).slice(0, MAX_NEW);
  if (todo.length === 0) return items;

  try {
    const companies = await loadCompanies();
    if (companies.length === 0) return items;
    const systemPrompt = buildSystemPrompt(companies);

    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      // 판정 근거로 제목과 요약을 함께 넘긴다 — 제목만으로는 무슨 사안인지 좁히기 어렵다.
      const articles = batch.map(a => ({
        title: a.title,
        reason: a.summary?.ko ?? a.blurb ?? '',
      }));
      const results = await analyzeBatch(client(), systemPrompt, articles);

      await Promise.all(batch.map(async (it, k) => {
        const hits = results[k];
        if (hits === null) return;   // 이 기사만 실패 — 다음 조회에서 다시 시도한다.
        it.portfolio = hits;
        await prisma.dashboardInsight.upsert({
          where: { kind_key: { kind: KIND, key: it.url } },
          create: { kind: KIND, key: it.url, value: JSON.stringify(hits) },
          update: { value: JSON.stringify(hits) },
        }).catch(e => console.error('[news-portfolio] 캐시 저장 실패:', it.url, e));
      }));
    }
  } catch (e) {
    console.error('[news-portfolio] 매칭 실패 — 영향 회사 없이 내보낸다:', e);
  }

  return items;
}

/**
 * EN 화면에서 쓸 영문 회사명·사유를 채운다.
 *
 * 왜 별도 함수인가: 매칭 자체(ensurePortfolioHits)는 한국어로 판정하는 편이
 * 낫다 — 회사 설명과 감시 키워드가 한국어라 영어로 돌리면 매칭이 나빠진다.
 * 번역은 화면에 EN으로 뜰 때만, 그리고 기사당 한 번만 한다.
 *
 * 회사명은 번역하지 않고 MonitoringTarget.englishName 을 쓴다 — 고유명사를
 * 모델에 맡기면 음역(스플랩 -> "Splab"이 아니라 "Seuplaep")이 나온다.
 */
export async function ensurePortfolioHitsEn(items: DigestItem[]): Promise<void> {
  const pending = items.filter(
    it => it.portfolio?.some(h => !h.reasonEn && needsEnglish(h.reason)),
  );
  if (pending.length === 0) {
    // 영문명만 비어 있을 수 있으니 그것만 채우고 끝낸다.
    await fillEnglishNames(items);
    return;
  }

  await fillEnglishNames(items);

  const texts = [...new Set(
    pending.flatMap(it => (it.portfolio ?? []).filter(h => !h.reasonEn).map(h => h.reason)),
  )];
  if (texts.length === 0) return;

  try {
    const translated = await translateBatch(texts);
    const byText = new Map(texts.map((t, i) => [t, translated[i]]));
    await Promise.all(pending.map(async it => {
      for (const h of it.portfolio ?? []) {
        const v = byText.get(h.reason);
        if (v && v !== h.reason) h.reasonEn = v;
      }
      // 번역 결과를 같은 캐시 행에 되돌려 저장한다.
      await prisma.dashboardInsight.update({
        where: { kind_key: { kind: KIND, key: it.url } },
        data: { value: JSON.stringify(it.portfolio) },
      }).catch(() => { /* 캐시 갱신 실패는 화면을 막지 않는다 */ });
    }));
  } catch (e) {
    console.error('[news-portfolio] 사유 번역 실패 — 한국어로 내보낸다:', e);
  }
}

/** 회사명의 영문 표기를 MonitoringTarget 에서 가져와 채운다. */
async function fillEnglishNames(items: DigestItem[]): Promise<void> {
  const names = [...new Set(items.flatMap(it => (it.portfolio ?? []).map(h => h.company)))];
  if (names.length === 0) return;
  const rows = await prisma.monitoringTarget.findMany({
    where: { name: { in: names } },
    select: { name: true, englishName: true },
  }).catch(() => []);
  const byName = new Map(rows.map(r => [r.name, r.englishName]));
  for (const it of items) {
    for (const h of it.portfolio ?? []) {
      const en = byName.get(h.company);
      if (en && en.trim()) h.companyEn = en.trim();
    }
  }
}

/** 한글이 섞여 있으면 번역이 필요하다고 본다. */
function needsEnglish(text: string): boolean {
  return /[가-힣]/.test(text ?? '');
}
