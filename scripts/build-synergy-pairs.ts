/**
 * ③④ 시너지 후보 생성 + 검증 — 주 1회 배치.
 *
 * 흐름:
 *   1) ACTIVE 한국·대만 포트폴리오사를 임베딩과 함께 읽는다
 *   2) 코사인 유사도로 한국 회사별 상위 3개 후보만 남긴다 (LLM 0회)
 *   3) 이미 판정된 쌍은 건너뛴다 (사람 피드백이 달린 쌍은 절대 덮어쓰지 않는다)
 *   4) 남은 후보만 LLM에 보내 관계유형·근거·협업형식을 받는다
 *   5) SynergyPair에 저장. relation='none'도 저장한다 — 다시 묻지 않기 위한 기록.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/build-synergy-pairs.ts [--dry] [--limit N] [--recompute]
 *     --dry       : 후보만 뽑아 보여주고 LLM은 부르지 않는다
 *     --limit N   : LLM에 보낼 조합 수 상한
 *     --recompute : 이미 판정된 쌍도 다시 판정 (피드백 달린 쌍은 그래도 보존)
 */
import OpenAI from 'openai';
import { prisma } from '../src/lib/prisma';
import {
  buildCandidates, buildVerifyUser, VERIFY_SYSTEM, extractJsonArray,
  RELATIONS, TOP_PER_KR, SAME_SECTOR_FLOOR, CROSS_SECTOR_FLOOR,
  type Candidate, type Verdict, type RelationKey,
} from '../src/lib/sparkscope/synergy';

const MODEL = 'gpt-4o-mini'; // 판정+두 문장 작성. 상위 후보만 보내므로 mini로 충분하다.
const BATCH = 8;
const DRY = process.argv.includes('--dry');
const RECOMPUTE = process.argv.includes('--recompute');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : 0;
})();

const SELECT = { id: true, name: true, sector: true, notes: true, embedding: true } as const;

async function main() {
  console.log(`=== 시너지 후보 생성 ===${DRY ? ' (dry-run)' : ''}`);

  const [kr, tw] = await Promise.all([
    prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company', status: 'ACTIVE' }, select: SELECT, orderBy: { name: 'asc' },
    }),
    prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company_tw', status: 'ACTIVE' }, select: SELECT, orderBy: { name: 'asc' },
    }),
  ]);
  console.log(`한국 ${kr.length}개 · 대만 ${tw.length}개 (최대 조합 ${kr.length * tw.length})`);

  const { candidates, pairsScored, skippedNoEmbedding } = buildCandidates(kr, tw);
  console.log(`③ 유사도 계산 ${pairsScored}쌍 (LLM 0회) → 후보 ${candidates.length}개`);
  console.log(`   임계값: 같은섹터 ≥${SAME_SECTOR_FLOOR} · 다른섹터 ≥${CROSS_SECTOR_FLOOR} · 한국사당 상위 ${TOP_PER_KR}개`);
  if (skippedNoEmbedding > 0) console.log(`   ⚠️ 임베딩 없어 건너뛴 한국 회사 ${skippedNoEmbedding}개 — embed-portfolio.ts 먼저 실행`);

  // 이미 판정된 쌍 (피드백이 달린 쌍은 --recompute에도 보존)
  const existing = await prisma.synergyPair.findMany({ select: { krTargetId: true, twTargetId: true, feedback: true } });
  const done = new Set(existing.filter(e => !RECOMPUTE || e.feedback).map(e => `${e.krTargetId}|${e.twTargetId}`));
  const todo = candidates.filter(c => !done.has(`${c.krId}|${c.twId}`)).slice(0, LIMIT > 0 ? LIMIT : undefined);
  console.log(`④ 검증 대상 ${todo.length}개 (이미 판정 ${done.size}개 건너뜀)`);

  if (DRY) {
    console.log('\n=== 후보 상위 20개 (유사도 순) ===');
    [...candidates].sort((a, b) => b.similarity - a.similarity).slice(0, 20).forEach(c =>
      console.log(`  ${c.similarity.toFixed(3)} ${c.sameSector ? '[같은섹터]' : '[다른섹터]'} ${c.krName} ↔ ${c.twName}` +
                  `\n      KR(${c.krSector}) ${c.krDesc.slice(0, 62)}\n      TW(${c.twSector}) ${c.twDesc.slice(0, 62)}`));
    await prisma.$disconnect();
    return;
  }
  if (todo.length === 0) { await summarize(); await prisma.$disconnect(); return; }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  let saved = 0, none = 0, failed = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    let verdicts: Verdict[] = [];
    try {
      const resp = await openai.chat.completions.create({
        model: MODEL, max_tokens: 1600,
        messages: [{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content: buildVerifyUser(chunk) }],
      });
      verdicts = JSON.parse(extractJsonArray(resp.choices[0]?.message?.content ?? '')) as Verdict[];
    } catch (e: any) {
      failed += chunk.length;
      console.error(`\n[ERR] ${chunk.map(c => c.krName + '↔' + c.twName).join(', ')}: ${(e?.message ?? '').split('\n')[0]}`);
      continue;
    }
    const byIdx = new Map(verdicts.map(v => [v.i, v]));
    for (const [k, c] of chunk.entries()) {
      const v = byIdx.get(k + 1);
      if (!v || !(v.relation in RELATIONS)) { failed++; continue; }
      if (v.relation === 'none') none++;
      await upsertPair(c, v);
      saved++;
    }
    process.stdout.write(`\r진행 ${Math.min(i + BATCH, todo.length)}/${todo.length} · 저장 ${saved} · 근거없음 ${none} · 실패 ${failed}   `);
  }
  process.stdout.write('\n');
  console.log(`[build-synergy-pairs] 저장 ${saved}건 (근거없음 ${none} · 실패 ${failed})`);
  await summarize();
  await prisma.$disconnect();
}

async function upsertPair(c: Candidate, v: Verdict) {
  const data = {
    krName: c.krName, twName: c.twName, twRegion: 'tw',
    sector: c.sameSector ? c.krSector : (c.krSector ?? c.twSector),
    similarity: Number(c.similarity.toFixed(4)),
    relation: v.relation as RelationKey,
    rationale: v.rationale ?? null,
    collabFormat: v.relation === 'none' ? null : (v.collabFormat ?? null),
    computedAt: new Date(),
  };
  await prisma.synergyPair.upsert({
    where: { krTargetId_twTargetId: { krTargetId: c.krId, twTargetId: c.twId } },
    create: { krTargetId: c.krId, twTargetId: c.twId, ...data },
    // 사람 피드백(feedback/feedbackBy/feedbackAt)은 건드리지 않는다.
    update: data,
  });
}

async function summarize() {
  const rows = await prisma.synergyPair.groupBy({ by: ['relation'], _count: true });
  console.log('\n=== SynergyPair 관계유형 분포 ===');
  for (const r of rows.sort((a, b) => b._count - a._count)) {
    const label = RELATIONS[r.relation as RelationKey]?.label ?? r.relation;
    console.log(`  ${label.padEnd(8)} ${String(r._count).padStart(4)}건${r.relation === 'none' ? ' (화면에서 감춤)' : ''}`);
  }
  const shown = await prisma.synergyPair.count({ where: { relation: { in: ['same', 'complement', 'chain'] } } });
  console.log(`\n화면에 뜨는 조합: ${shown}건`);
  const top = await prisma.synergyPair.findMany({
    where: { relation: { in: ['same', 'complement', 'chain'] } },
    orderBy: { similarity: 'desc' }, take: 12,
    select: { krName: true, twName: true, relation: true, similarity: true, sector: true, collabFormat: true },
  });
  console.log('\n=== 상위 12개 ===');
  top.forEach(t => console.log(
    `  ${t.similarity.toFixed(3)} [${RELATIONS[t.relation as RelationKey]?.label}] ${t.krName} ↔ ${t.twName}` +
    `  (${t.sector})\n      → ${t.collabFormat ?? '-'}`));
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
