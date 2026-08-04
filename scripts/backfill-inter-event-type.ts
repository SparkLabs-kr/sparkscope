/**
 * Inter 판정 데이터에 주제(topicSector)·사건유형(eventType) 축을 백필한다.
 *
 * 배경: 기존 `sector` 하나에 주제(항암·신약발굴 …)와 사건유형(규제·거버넌스, 투자·산업동향)이
 * 섞여 있어서, "머크가 항암 신약사를 32조에 인수" 같은 기사가 항암이 아니라 투자로 분류됐다.
 * 그 결과 투자·산업동향 혼자 relevant 450건 중 151건(34%)을 먹고 항암은 실제보다 작아 보였다.
 *
 * 이 스크립트는 `sector`를 건드리지 않고(되돌리기용 보존) topicSector·eventType만 새로 채운다.
 *
 * 실행:
 *   npx tsx scripts/backfill-inter-event-type.ts           # 미분류 건만 (재실행 안전)
 *   npx tsx scripts/backfill-inter-event-type.ts --all     # relevant 전체 재분류
 *   npx tsx scripts/backfill-inter-event-type.ts --limit 20 --dry-run
 */

import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import {
  BIO_TOPIC_SECTORS,
  AI_TOPIC_SECTORS,
  INTER_EVENT_TYPES,
} from '../src/lib/sparkscope/inter-taxonomy';

const prisma = new PrismaClient();

const BIO_TOPIC_KEYS = BIO_TOPIC_SECTORS.map(s => s.key);
const AI_TOPIC_KEYS = AI_TOPIC_SECTORS.map(s => s.key);
const EVENT_KEYS = INTER_EVENT_TYPES.map(e => e.key);

const SYSTEM = `당신은 해외 AI/바이오 기사를 두 축으로 분류하는 분류기입니다. 두 축을 절대 섞지 마세요.

1) topicSector — "무엇에 관한 기사인가"
   바이오: ${BIO_TOPIC_KEYS.join(', ')}
   AI: ${AI_TOPIC_KEYS.join(', ')}
   ⚠ 투자 기사·규제 기사도 "그래서 어느 분야 이야기인가"로 주제를 정합니다.
     예) "Merck to acquire cancer drugmaker for $23B" → 항암 (투자가 아님)
     예) "FDA overhauls clinical trial review" → 그 정책이 가장 크게 영향을 주는 주제(신약발굴 등)
   특정 분야로 좁히기 정말 어려운 도메인 전반 기사만 null.

2) eventType — "무슨 일이 일어났는가"
   ${INTER_EVENT_TYPES.map(e => `${e.key}(${e.sub})`).join(', ')}
     예) 인수·투자 라운드·IPO → 투자·딜
     예) FDA/EMA 승인·정책·소송 → 규제·승인
     예) 임상 결과·논문 발표 → 연구성과
     예) 제품 출시·파트너십 → 제품·상용화
     예) 시장 전망·인사·조직 개편 → 시장·인물

주어진 domain(bio/ai)에 맞는 주제 목록에서만 고릅니다. 응답은 valid JSON 배열만.`;

type Row = {
  id: string;
  domain: string | null;
  sector: string | null;
  titleKo: string | null;
  news: { title: string; source: string };
};

type Result = { index: number; topicSector?: string | null; eventType?: string | null };

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

async function classify(ai: GoogleGenAI, batch: Row[]): Promise<Result[]> {
  const prompt = `다음 ${batch.length}개 기사를 분류하세요.

${batch
  .map(
    (r, i) =>
      `${i + 1}. domain=${r.domain ?? 'unknown'} | [${r.news.source}] ${r.news.title}${
        r.titleKo ? ` (${r.titleKo})` : ''
      }`,
  )
  .join('\n')}

출력 스키마: [{"index": 0-based, "topicSector": "<주제>"|null, "eventType": "<사건유형>"}]
JSON 배열만 반환:`;

  const result = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: prompt,
    config: { systemInstruction: SYSTEM },
  });
  return JSON.parse(extractJson(result.text ?? '')) as Result[];
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;

  const rows = (await prisma.interNewsVerdict.findMany({
    where: {
      relevant: true,
      ...(all ? {} : { OR: [{ topicSector: null }, { eventType: null }] }),
    },
    select: {
      id: true,
      domain: true,
      sector: true,
      titleKo: true,
      news: { select: { title: true, source: true } },
    },
    ...(limit ? { take: limit } : {}),
  })) as Row[];

  console.log(`대상 ${rows.length}건 (${all ? '전체 재분류' : '미분류만'}${dryRun ? ' · dry-run' : ''})`);
  if (rows.length === 0) return;

  const ai = new GoogleGenAI({ vertexai: true, project: 'communication-504101', location: 'global' });

  const BATCH = 10;
  let ok = 0;
  let skipped = 0;
  const eventCount = new Map<string, number>();
  const topicCount = new Map<string, number>();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let results: Result[];
    try {
      results = await classify(ai, batch);
    } catch (e: any) {
      console.error(`  배치 ${i / BATCH + 1} 실패 (건너뜀): ${e.message}`);
      skipped += batch.length;
      continue;
    }

    for (const r of results) {
      const row = batch[r.index];
      if (!row) continue;

      // 도메인에 맞는 목록에 있는 값만 받는다 — LLM이 다른 도메인 주제를 뱉으면 버린다.
      const validTopics = row.domain === 'ai' ? AI_TOPIC_KEYS : BIO_TOPIC_KEYS;
      const topicSector = r.topicSector && validTopics.includes(r.topicSector) ? r.topicSector : null;
      const eventType = r.eventType && EVENT_KEYS.includes(r.eventType) ? r.eventType : null;

      if (!eventType) {
        skipped += 1;
        continue;
      }

      if (topicSector) topicCount.set(topicSector, (topicCount.get(topicSector) ?? 0) + 1);
      eventCount.set(eventType, (eventCount.get(eventType) ?? 0) + 1);

      if (!dryRun) {
        await prisma.interNewsVerdict.update({
          where: { id: row.id },
          data: { topicSector, eventType },
        });
      }
      ok += 1;
    }

    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length} 처리`);
    if (i + BATCH < rows.length) await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n완료: ${ok}건 반영, ${skipped}건 건너뜀${dryRun ? ' (dry-run — DB 미반영)' : ''}`);
  console.log('\n주제 분포:');
  [...topicCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log('\n사건유형 분포:');
  [...eventCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
