/**
 * 포트폴리오사 섹터 태깅 → DB 직접 반영 (한국 + 해외지사 전부).
 *
 * 왜 별도 스크립트인가:
 *   기존 tag-portfolio-sectors.ts는 한국 Live 회사만 대상으로 검토용 draft JSON을 만든다.
 *   시너지 매칭은 한국과 대만을 "같은 축"에 세워야 하므로 양쪽을 같은 택소노미로 태깅해
 *   DB(MonitoringTarget.domain/sector)에 넣어야 한다. 프롬프트는
 *   src/lib/sparkscope/sector-tagger.ts 한 곳을 공유한다.
 *
 * 이미 검토된 draft를 먼저 반영한다:
 *   data/portfolio-sectors-draft.json에 한국 194건이 이미 사람 검토를 거쳐 있다.
 *   그건 LLM을 다시 부르지 않고 그대로 DB에 넣고, 태그가 없는 회사만 새로 태깅한다.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/tag-portfolio-sectors-db.ts [--dry] [--limit N] [--retag]
 *     --dry    : 저장하지 않고 무엇이 바뀔지만 출력
 *     --limit N: 새로 태깅할 회사 수 상한 (테스트용)
 *     --retag  : 이미 sector가 있는 회사도 다시 태깅
 */
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/prisma';
import { tagBatch, normalizeTag, TAG_BATCH, TAG_MODEL, type Tagged } from '../src/lib/sparkscope/sector-tagger';

const DRAFT_PATH = path.resolve(process.cwd(), 'data/portfolio-sectors-draft.json');
const DRY = process.argv.includes('--dry');
const RETAG = process.argv.includes('--retag');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : 0;
})();

/** notes 첫 줄이 실제 사업 설명 — 대만은 앞에 "[중문: ...]"가 붙어 있어 떼어낸다. */
function businessContext(notes: string | null): string {
  return (notes ?? '').split('\n')[0].replace(/^\[중문:[^\]]*\]\s*/, '').trim();
}

async function main() {
  console.log(`=== 포트폴리오 섹터 태깅 → DB ===${DRY ? ' (dry-run)' : ''}`);

  const targets = await prisma.monitoringTarget.findMany({
    where: { category: { in: ['portfolio_company', 'portfolio_company_tw'] } },
    select: { id: true, name: true, notes: true, region: true, sector: true, domain: true, status: true },
    orderBy: { name: 'asc' },
  });
  console.log(`대상 ${targets.length}개 (한국 ${targets.filter(t => t.region === 'kr').length} · 대만 ${targets.filter(t => t.region === 'tw').length})`);

  // ── 1) 검토된 draft 먼저 반영 ────────────────────────────────
  let fromDraft = 0;
  if (fs.existsSync(DRAFT_PATH)) {
    const draft = JSON.parse(fs.readFileSync(DRAFT_PATH, 'utf8')) as Tagged[];
    const byName = new Map(draft.map(d => [d.name, d]));
    for (const t of targets) {
      if (t.sector && !RETAG) continue;
      const d = byName.get(t.name) ? normalizeTag(byName.get(t.name)!) : null;
      if (!d) continue;
      if (!DRY) {
        await prisma.monitoringTarget.update({
          where: { id: t.id }, data: { domain: d.domain, sector: d.sector },
        });
      }
      t.sector = d.sector; t.domain = d.domain;
      fromDraft++;
    }
    console.log(`draft 반영: ${fromDraft}건 (LLM 호출 없음)`);
  } else {
    console.log('draft 파일 없음 — 전부 새로 태깅합니다.');
  }

  // ── 2) 남은 회사만 새로 태깅 ─────────────────────────────────
  const todo = targets
    .filter(t => (RETAG || !t.sector) && businessContext(t.notes).length >= 10)
    .slice(0, LIMIT > 0 ? LIMIT : undefined);
  const skippedNoNotes = targets.filter(t => !t.sector && businessContext(t.notes).length < 10);

  console.log(`새로 태깅할 회사: ${todo.length}개 · 사업설명 부족으로 건너뜀: ${skippedNoNotes.length}개`);
  if (skippedNoNotes.length > 0) {
    console.log(`  (${skippedNoNotes.slice(0, 8).map(t => t.name).join(', ')}${skippedNoNotes.length > 8 ? ' …' : ''})`);
  }

  if (todo.length === 0) {
    await summarize();
    await prisma.$disconnect();
    return;
  }
  if (DRY) {
    console.log(`dry-run — ${TAG_MODEL}로 ${Math.ceil(todo.length / TAG_BATCH)}배치 호출 예정. 저장하지 않고 종료.`);
    await prisma.$disconnect();
    return;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  let saved = 0, invalid = 0, missing = 0;

  for (let i = 0; i < todo.length; i += TAG_BATCH) {
    const chunk = todo.slice(i, i + TAG_BATCH);
    try {
      const tagged = await tagBatch(openai, chunk.map(c => ({ name: c.name, notes: businessContext(c.notes) })));
      const byName = new Map(tagged.map(t => [t.name, t]));
      for (const c of chunk) {
        const raw = byName.get(c.name);
        if (!raw) { missing++; console.error(`\n[MISS] ${c.name} — 응답 누락`); continue; }
        // domain이 틀려도 sector가 맞으면 normalizeTag가 바로잡는다(주석 참고).
        const t = normalizeTag(raw);
        if (!t) { invalid++; console.error(`\n[INVALID] ${c.name} → ${raw.domain}/${raw.sector} (택소노미 밖)`); continue; }
        await prisma.monitoringTarget.update({
          where: { id: c.id }, data: { domain: t.domain, sector: t.sector },
        });
        saved++;
      }
    } catch (e: any) {
      missing += chunk.length;
      console.error(`\n[ERR] ${chunk.map(c => c.name).join(',')}: ${(e?.message ?? '').split('\n')[0]}`);
    }
    process.stdout.write(`\r진행 ${Math.min(i + TAG_BATCH, todo.length)}/${todo.length} · 저장 ${saved} · 누락 ${missing} · 택소노미밖 ${invalid}   `);
  }
  process.stdout.write('\n');
  console.log(`태깅 저장 ${saved}건 (draft ${fromDraft}건 포함하면 총 ${saved + fromDraft}건)`);
  await summarize();
  await prisma.$disconnect();
}

async function summarize() {
  const rows = await prisma.monitoringTarget.groupBy({
    by: ['region', 'sector'],
    where: { category: { in: ['portfolio_company', 'portfolio_company_tw'] }, status: 'ACTIVE' },
    _count: true,
  });
  const untagged = await prisma.monitoringTarget.count({
    where: { category: { in: ['portfolio_company', 'portfolio_company_tw'] }, status: 'ACTIVE', sector: null },
  });
  const bySector = new Map<string, { kr: number; tw: number }>();
  for (const r of rows) {
    if (!r.sector) continue;
    const e = bySector.get(r.sector) ?? { kr: 0, tw: 0 };
    if (r.region === 'tw') e.tw += r._count; else e.kr += r._count;
    bySector.set(r.sector, e);
  }
  console.log(`\n=== ACTIVE 회사 섹터 분포 (양국 다 있는 섹터가 시너지 후보) ===`);
  console.log(`  ${'섹터'.padEnd(20)} 한국  대만`);
  const both: string[] = [];
  for (const [s, v] of [...bySector.entries()].sort((a, b) => (b[1].kr + b[1].tw) - (a[1].kr + a[1].tw))) {
    const mark = v.kr > 0 && v.tw > 0 ? ' ← 양국' : '';
    if (v.kr > 0 && v.tw > 0) both.push(s);
    console.log(`  ${s.padEnd(20)} ${String(v.kr).padStart(4)} ${String(v.tw).padStart(5)}${mark}`);
  }
  console.log(`\n양국 다 있는 섹터 ${both.length}개 · 미태깅 ${untagged}개`);
}

main().catch(async e => { console.error('치명적 오류:', e); await prisma.$disconnect(); process.exit(1); });
