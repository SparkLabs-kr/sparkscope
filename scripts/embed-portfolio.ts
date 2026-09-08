/**
 * 포트폴리오사 사업설명 임베딩 — 시너지 매칭의 유사도 계산용.
 *
 * 왜 임베딩이 필요한가:
 *   섹터만으로 붙이면 해상도가 부족하다. 'AI버티컬 SaaS' 하나에 한국 회사가 33개 들어 있어서
 *   대만 회사 하나에 후보 33개가 딸려온다(2026-09-08 실측). 섹터 안에서 순위를 매기려면
 *   사업설명 자체의 유사도가 필요하다.
 *
 * 왜 회사 단위 1회인가:
 *   218 × 69 = 15,042쌍을 LLM에 물어보면 회사 하나 추가될 때마다 비용이 선형으로 늘어난다.
 *   임베딩은 회사당 1회만 만들어두면, 쌍 계산은 코사인 곱셈이라 LLM 호출이 0회다.
 *
 * 왜 영어로 정규화해서 임베딩하는가 (중요):
 *   한국 회사 설명은 한국어, 대만 회사 설명은 영어다. 그대로 임베딩하면 같은 사업을 하는
 *   두 회사여도 코사인이 눌린다 — 2026-09-08 실측으로 베러먼데이코리아("커피 프랜차이즈
 *   '베러먼데이커피' 운영") ↔ IDrip("IoT coffee maker")가 0.221밖에 안 나왔다. 둘 다 커피인데도.
 *   그래서 한국어 설명은 gpt-4o-mini로 영어 한 줄로 바꾼 뒤 임베딩한다. 번역문은
 *   embedSource에 남겨서 "왜 이 둘이 비슷하다고 나왔나"를 사람이 되짚을 수 있게 한다.
 *
 * 차원:
 *   text-embedding-3-small을 256차원으로 줄여 쓴다. 기본 1536은 이 용도(287개 회사 비교)에
 *   과하고, Prisma가 다루기 쉬운 JSON 문자열로 저장하므로 작을수록 좋다.
 *   (기사 검색용 ArticleEmbedding은 pgvector 512차원 — 그쪽과 별개다.)
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/embed-portfolio.ts [--dry] [--re]
 *     --re : 이미 임베딩이 있는 회사도 다시 만든다(설명이 바뀌거나 정규화 방식이 바뀐 경우)
 */
import OpenAI from 'openai';
import { prisma } from '../src/lib/prisma';

const MODEL = 'text-embedding-3-small';
const NORMALIZE_MODEL = 'gpt-4o-mini'; // 한국어 설명 → 영어 한 줄
const DIMS = 256;
const BATCH = 64; // 임베딩 API는 배열 입력을 받는다 — 한 번에 여러 개.
const NORM_BATCH = 20;
const DRY = process.argv.includes('--dry');
const REDO = process.argv.includes('--re');

/** 한글이 섞여 있으면 한국어 설명으로 본다. */
function hasKorean(s: string): boolean {
  return /[\u3131-\uD79D]/.test(s);
}

const NORMALIZE_SYSTEM = `You normalize company descriptions for semantic matching.
Given numbered company descriptions (Korean or English), rewrite each as ONE English sentence
that names: what the company makes/sells, who the customer is, and the core technology or channel.
Keep proper nouns. Do not add facts that are not in the input. Do not editorialize.
Return ONLY a valid JSON array: [{"i": <number>, "en": "<one English sentence>"}]`;

function extractJsonArray(text: string): string {
  const fence = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('['); const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

/** 한국어 설명들을 영어 한 줄로 바꾼다. 실패하면 원문을 그대로 쓴다(수집을 막지 않는다). */
async function normalizeToEnglish(
  openai: OpenAI,
  items: { key: string; text: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < items.length; i += NORM_BATCH) {
    const chunk = items.slice(i, i + NORM_BATCH);
    try {
      const resp = await openai.chat.completions.create({
        model: NORMALIZE_MODEL, max_tokens: 1800,
        messages: [
          { role: 'system', content: NORMALIZE_SYSTEM },
          { role: 'user', content: chunk.map((c, k) => `${k + 1}. ${c.text}`).join('\n') },
        ],
      });
      const arr = JSON.parse(extractJsonArray(resp.choices[0]?.message?.content ?? '')) as { i: number; en: string }[];
      for (const r of arr) {
        const c = chunk[r.i - 1];
        if (c && r.en && r.en.trim()) out.set(c.key, r.en.trim());
      }
    } catch (e: any) {
      console.error(`\n[normalize ERR] ${(e?.message ?? '').split('\n')[0]} — 원문으로 진행`);
    }
    process.stdout.write(`\r영어 정규화 ${Math.min(i + NORM_BATCH, items.length)}/${items.length}   `);
  }
  if (items.length > 0) process.stdout.write('\n');
  return out;
}

/** 임베딩에 넣을 텍스트 — 회사명과 사업설명을 함께 넣어야 이름만 다른 유사 회사가 구분된다. */
export function embedText(name: string, englishName: string | null, notes: string | null): string {
  const ctx = (notes ?? '').split('\n')[0].replace(/^\[중문:[^\]]*\]\s*/, '').trim();
  return [name, englishName, ctx].filter(Boolean).join(' — ');
}

async function main() {
  const targets = await prisma.monitoringTarget.findMany({
    where: { category: { in: ['portfolio_company', 'portfolio_company_tw'] }, status: 'ACTIVE' },
    select: { id: true, name: true, englishName: true, notes: true, embedding: true },
    orderBy: { name: 'asc' },
  });

  const todo = targets.filter(t => {
    if (!REDO && t.embedding) return false;
    return embedText(t.name, t.englishName, t.notes).length >= 10;
  });
  console.log(`=== 포트폴리오 임베딩 (${MODEL} · ${DIMS}차원) ===${DRY ? ' (dry-run)' : ''}`);
  console.log(`ACTIVE ${targets.length}개 · 임베딩 필요 ${todo.length}개 · 이미 있음 ${targets.filter(t => t.embedding).length}개`);

  if (todo.length === 0 || DRY) {
    if (DRY && todo.length > 0) console.log(`dry-run — ${Math.ceil(todo.length / BATCH)}배치 호출 예정.`);
    await prisma.$disconnect();
    return;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  // 1) 한국어 설명은 영어 한 줄로 정규화 — 위 주석 참고.
  const raw = new Map(todo.map(t => [t.id, embedText(t.name, t.englishName, t.notes)]));
  const needNorm = todo.filter(t => hasKorean(raw.get(t.id)!)).map(t => ({ key: t.id, text: raw.get(t.id)! }));
  console.log(`한국어 설명 ${needNorm.length}개를 영어로 정규화합니다 (${NORMALIZE_MODEL}).`);
  const englished = await normalizeToEnglish(openai, needNorm);

  // 회사명은 정규화문에서 빠질 수 있으므로 항상 앞에 붙여 둔다(고유명사 신호 유지).
  const finalText = new Map(todo.map(t => {
    const en = englished.get(t.id);
    const base = en ? [t.name, t.englishName, en].filter(Boolean).join(' — ') : raw.get(t.id)!;
    return [t.id, base];
  }));

  // 2) 임베딩
  let saved = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const inputs = chunk.map(c => finalText.get(c.id)!);
    const resp = await openai.embeddings.create({ model: MODEL, dimensions: DIMS, input: inputs });
    for (const [k, c] of chunk.entries()) {
      const vec = resp.data[k]?.embedding;
      if (!vec || vec.length !== DIMS) { console.error(`\n[ERR] ${c.name} — 임베딩 길이 이상`); continue; }
      await prisma.monitoringTarget.update({
        where: { id: c.id },
        data: { embedding: JSON.stringify(vec), embedSource: finalText.get(c.id)!, embeddedAt: new Date() },
      });
      saved++;
    }
    process.stdout.write(`\r진행 ${Math.min(i + BATCH, todo.length)}/${todo.length} · 저장 ${saved}   `);
  }
  process.stdout.write('\n');
  console.log(`[embed-portfolio] 저장 ${saved}건`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
