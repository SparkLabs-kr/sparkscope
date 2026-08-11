// 기사 임베딩 — 의미 검색용 벡터를 만들고 저장한다.
//
// 키워드 검색으로는 원리적으로 못 잡는 질문이 있다. "돈 잘 굴러가는 포폴사"에 해당하는
// 제목은 존재하지 않기 때문이다. 임베딩은 글자가 아니라 의미로 찾으므로 이런 질문을 받는다.
//
// 모델: text-embedding-3-small을 512차원으로 줄여서 쓴다(dimensions 파라미터).
// 1536차원 대비 저장·인덱스가 1/3인데, 제목+한 줄 요약 정도의 짧은 텍스트를 다루는
// 이 용도에서는 검색 품질 차이가 사실상 없다.
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 512;

/** 한 기사를 임베딩할 텍스트. 제목만으로는 맥락이 얇아 한 줄 요약·회사명을 함께 넣는다. */
export function embeddingText(a: {
  title: string;
  oneLiner?: string | null;
  matchedKeyword?: string | null;
}) {
  return [a.matchedKeyword, a.title, a.oneLiner].filter(Boolean).join(' · ').slice(0, 2000);
}

let client: OpenAI | null = null;
function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 없습니다');
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/** 텍스트 여러 개를 한 번에 임베딩한다. 반환 순서는 입력 순서와 같다. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const resp = await openai().embeddings.create({
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
    input: texts,
  });
  // API가 순서를 보장하지만 index로 다시 정렬해 확실히 맞춘다.
  return resp.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}

/** pgvector 리터럴 — '[0.1,0.2,...]' 형태여야 한다. */
export const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`;

/**
 * 아직 임베딩이 없는 기사를 채운다.
 * 매일 수집 후에 호출하면 새 기사만 임베딩된다(이미 있는 건 건너뛴다).
 * @returns 이번에 새로 임베딩한 건수
 */
export async function backfillEmbeddings(opts: {
  /** 한 번에 API로 보낼 기사 수 */
  batchSize?: number;
  /** 최대 몇 건까지 처리할지. 넘기지 않으면 남은 걸 전부 처리한다 */
  limit?: number;
  onProgress?: (done: number, total: number) => void;
} = {}): Promise<number> {
  const batchSize = opts.batchSize ?? 200;

  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "Article" a
     WHERE a."isNoise" = false
       AND NOT EXISTS (SELECT 1 FROM "ArticleEmbedding" e WHERE e."articleId" = a.id)`
  );
  const remaining = Number(n);
  const target = opts.limit ? Math.min(remaining, opts.limit) : remaining;
  if (!target) return 0;

  let done = 0;
  while (done < target) {
    const take = Math.min(batchSize, target - done);
    const rows = await prisma.$queryRawUnsafe<
      { id: string; title: string; oneLiner: string | null; matchedKeyword: string | null }[]
    >(
      `SELECT a.id, a.title, a."oneLiner", a."matchedKeyword" FROM "Article" a
       WHERE a."isNoise" = false
         AND NOT EXISTS (SELECT 1 FROM "ArticleEmbedding" e WHERE e."articleId" = a.id)
       ORDER BY a."pubDate" DESC
       LIMIT ${take}`
    );
    if (!rows.length) break;

    const vectors = await embedBatch(rows.map(embeddingText));

    // 한 문장으로 몰아 넣는다. 행마다 왕복하면 200건에 200번 왕복이라 훨씬 느리다.
    // id는 우리가 만든 cuid지만, 문자열로 이어붙이는 자리라 형식을 한 번 확인하고 넣는다.
    const values = rows
      .map((r, i) => {
        if (!/^[A-Za-z0-9_-]+$/.test(r.id)) throw new Error(`예상 밖의 id 형식: ${r.id}`);
        return `('${r.id}', '${toVectorLiteral(vectors[i])}'::vector, '${EMBEDDING_MODEL}')`;
      })
      .join(',');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ArticleEmbedding" ("articleId", embedding, model) VALUES ${values}
       ON CONFLICT ("articleId") DO UPDATE
         SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, "updatedAt" = now()`
    );

    done += rows.length;
    opts.onProgress?.(done, target);
  }
  return done;
}
