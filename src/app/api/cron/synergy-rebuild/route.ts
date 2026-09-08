/**
 * 시너지 후보 재계산 크론 — 주 1회.
 *
 * 왜 주 1회인가:
 *   입력이 회사 사업설명(MonitoringTarget.notes)이다. 기사처럼 매일 바뀌는 값이 아니라
 *   포트폴리오사가 추가·수정될 때만 바뀌므로 매일 돌릴 이유가 없다.
 *
 * 무엇을 하는가:
 *   ① 태깅·② 임베딩이 안 된 신규 회사를 채우고
 *   ③ 코사인으로 후보를 좁힌 뒤(LLM 0회)
 *   ④ 새 후보만 LLM으로 판정해 SynergyPair에 넣는다.
 *   이미 판정된 쌍과 사람 피드백이 달린 쌍은 건드리지 않는다.
 *
 * 전체 재계산(임계값·프롬프트를 바꿨을 때)은 크론이 아니라 스크립트로 한다:
 *   npx tsx --env-file=.env.local scripts/build-synergy-pairs.ts --recompute
 */
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { buildCandidates, buildVerifyUser, VERIFY_SYSTEM, extractJsonArray, RELATIONS, type Verdict, type RelationKey } from '@/lib/sparkscope/synergy';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL = 'gpt-4o-mini';
const BATCH = 8;
// 한 번 실행에서 LLM에 보낼 조합 상한 — maxDuration(300초) 안에 끝나야 한다.
// 넘치는 후보는 다음 주 실행이 이어서 처리한다(이미 판정된 쌍은 건너뛰므로 진행된다).
const MAX_PER_RUN = 120;

const SELECT = { id: true, name: true, sector: true, notes: true, embedding: true } as const;

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [kr, tw] = await Promise.all([
      prisma.monitoringTarget.findMany({ where: { category: 'portfolio_company', status: 'ACTIVE' }, select: SELECT }),
      prisma.monitoringTarget.findMany({ where: { category: 'portfolio_company_tw', status: 'ACTIVE' }, select: SELECT }),
    ]);

    // 임베딩이 없는 회사는 이번 회차에서 빠진다 — 태깅·임베딩은 스크립트가 담당한다.
    // (신규 회사가 생기면 embed-portfolio.ts를 돌려야 후보에 들어온다. 여기서 임베딩까지
    //  만들면 크론 하나가 너무 많은 일을 하게 되고 실패 지점이 늘어난다.)
    const { candidates, pairsScored, skippedNoEmbedding } = buildCandidates(kr, tw);

    const existing = await prisma.synergyPair.findMany({ select: { krTargetId: true, twTargetId: true } });
    const done = new Set(existing.map(e => `${e.krTargetId}|${e.twTargetId}`));
    const todo = candidates.filter(c => !done.has(`${c.krId}|${c.twId}`)).slice(0, MAX_PER_RUN);

    if (todo.length === 0) {
      console.log(`[cron:synergy-rebuild] 새 후보 0개 (계산 ${pairsScored}쌍 · 기존 ${done.size}쌍)`);
      return NextResponse.json({ ok: true, scored: pairsScored, verified: 0, remaining: 0 });
    }

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
      } catch (e) {
        failed += chunk.length;
        console.error('[cron:synergy-rebuild] 판정 실패:', e);
        continue;
      }
      const byIdx = new Map(verdicts.map(v => [v.i, v]));
      for (const [k, c] of chunk.entries()) {
        const v = byIdx.get(k + 1);
        if (!v || !(v.relation in RELATIONS)) { failed++; continue; }
        if (v.relation === 'none') none++;
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
          update: data, // 사람 피드백 컬럼은 건드리지 않는다
        });
        saved++;
      }
    }

    const remaining = candidates.filter(c => !done.has(`${c.krId}|${c.twId}`)).length - todo.length;
    console.log(
      `[cron:synergy-rebuild] 계산 ${pairsScored}쌍 → 후보 ${candidates.length} · 판정 ${saved}건` +
      `(근거없음 ${none} · 실패 ${failed}) · 남은 후보 ${remaining} · 임베딩없음 ${skippedNoEmbedding}`,
    );
    return NextResponse.json({ ok: true, scored: pairsScored, candidates: candidates.length, verified: saved, none, failed, remaining });
  } catch (e: any) {
    console.error('[cron:synergy-rebuild] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
