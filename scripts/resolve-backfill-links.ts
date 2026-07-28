/**
 * 백필 기사(link=backfill://해시)의 실제 원문 URL을 네이버 뉴스 검색 API로 복구.
 * 매칭: 정규화 제목(normalizeTitleKey) 완전 일치 + pubDate 3일 이내 근접.
 * 이미 다른 기사가 그 URL을 쓰고 있으면(충돌) 건드리지 않고 스킵.
 *
 * 실행: npx tsx scripts/resolve-backfill-links.ts        (드라이런 — 매칭 결과만 출력)
 *       npx tsx scripts/resolve-backfill-links.ts --apply (실제 DB 반영)
 *       npx tsx scripts/resolve-backfill-links.ts --apply --limit=20 (일부만)
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeTitleKey } from '../src/lib/sparkscope/relevance';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : undefined;
const NAVER_DELAY_MS = 150;
const MAX_DATE_DIFF_DAYS = 3;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

interface NaverItem { title: string; link: string; pubDate: Date }

async function searchNaver(query: string): Promise<NaverItem[]> {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=30&sort=date`;
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
  const out: NaverItem[] = [];
  for (const item of items) {
    const title = stripHtml(item.title ?? '');
    const link = String(item.originallink || item.link || '').trim();
    if (!title || !link) continue;
    const pubDate = new Date(item.pubDate);
    if (isNaN(pubDate.getTime())) continue;
    out.push({ title, link, pubDate });
  }
  return out;
}

async function main() {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    console.error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다 (.env.local 확인).');
    process.exit(1);
  }

  let targets = await prisma.article.findMany({
    where: { link: { startsWith: 'backfill://' } },
    select: { id: true, title: true, source: true, pubDate: true },
    orderBy: { pubDate: 'desc' },
  });
  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log(`대상: ${targets.length}건 (${APPLY ? '⚠️  실제 DB 적용' : '드라이런'})\n`);

  let resolved = 0, dateMismatch = 0, collided = 0, notFound = 0, errored = 0;

  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    try {
      const results = await searchNaver(a.title);
      const key = normalizeTitleKey(a.title);
      const matches = results.filter(r => normalizeTitleKey(r.title) === key);

      if (matches.length === 0) {
        notFound++;
        if (!APPLY) console.log(`  · 못찾음(${results.length}건 중 매칭없음) [${a.id}] ${a.title.slice(0, 50)}`);
      } else {
        matches.sort((x, y) => Math.abs(+x.pubDate - +a.pubDate) - Math.abs(+y.pubDate - +a.pubDate));
        const best = matches[0];
        const daysDiff = Math.abs(+best.pubDate - +a.pubDate) / 86_400_000;

        if (daysDiff > MAX_DATE_DIFF_DAYS) {
          dateMismatch++;
          console.log(`  △ 날짜불일치(${daysDiff.toFixed(0)}일차) [${a.id}] ${a.title.slice(0, 40)}`);
        } else {
          const existing = await prisma.article.findUnique({ where: { link: best.link } });
          if (existing && existing.id !== a.id) {
            collided++;
            console.log(`  ✗ 링크중복 [${a.id}] ${a.title.slice(0, 40)} → 이미 ${existing.id}가 사용 중`);
          } else {
            resolved++;
            console.log(`  ✓ [${a.id}] ${a.title.slice(0, 40)} → ${best.link}`);
            if (APPLY) {
              await prisma.article.update({ where: { id: a.id }, data: { link: best.link } });
            }
          }
        }
      }
    } catch (e) {
      errored++;
      console.error(`  ⚠ 에러 [${a.id}] ${a.title.slice(0, 40)} — ${e}`);
    }

    if ((i + 1) % 100 === 0) console.log(`--- 진행: ${i + 1}/${targets.length} ---`);
    await sleep(NAVER_DELAY_MS);
  }

  console.log(`\n=== 결과 (${APPLY ? '적용됨' : '드라이런'}) ===`);
  console.log(`해결: ${resolved}건`);
  console.log(`날짜 불일치(스킵): ${dateMismatch}건`);
  console.log(`링크 중복(스킵): ${collided}건`);
  console.log(`못 찾음: ${notFound}건`);
  console.log(`에러: ${errored}건`);
  if (!APPLY) console.log(`\n[드라이런] 실제 반영하려면 --apply 옵션을 붙여 재실행하세요.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
