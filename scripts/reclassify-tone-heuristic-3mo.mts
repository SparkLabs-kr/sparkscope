// 최근 3개월 기사 중 tone=NEUTRAL(또는 null)인 것만 새 휴리스틱(crisis 키워드 연동 +
// 확충된 부정 키워드 리스트)으로 재검사해서, 실제로는 부정인데 예전 로직이 놓친 기사를 NEGATIVE로 갱신.
// LLM 호출 없음(비용 0) — analyzer.ts의 heuristicTone을 그대로 재사용해 제목만으로 판단.
// 이미 POSITIVE/NEGATIVE로 판정된 기사, isNoise 기사는 건드리지 않음(기존 판단 보존).
//
// 실행: npx tsx scripts/reclassify-tone-heuristic-3mo.mts [--dry-run]
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  // .env.local이 CRLF일 수 있음 — JS 정규식의 '.'은 \r을 매치하지 않아 줄 끝의 \r을
  // 먼저 제거하지 않으면 값 전체가 매치 실패해서 환경변수가 조용히 비어버린다.
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n').map(l => l.replace(/\r$/, ''));
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  // OPENAI_API_KEY가 없으면 analyzer.ts 모듈 로드 시 OpenAI 클라이언트 생성이 터지므로 먼저 가드.
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY가 없습니다 (.env.local 확인). analyzer.ts import에 필요합니다.');
    process.exit(1);
  }
  const { heuristicTone } = await import('../src/lib/sparkscope/analyzer');
  const prisma = new PrismaClient();

  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const targets = await prisma.article.findMany({
    where: {
      pubDate: { gte: threeMonthsAgo },
      isNoise: false,
      category: { in: ['sparklabs_self', 'portfolio_company'] },
      OR: [{ tone: 'NEUTRAL' }, { tone: null }],
    },
    select: { id: true, title: true, tone: true, source: true, category: true },
  });

  console.log(`대상(최근 3개월, sparklabs_self/portfolio_company, NEUTRAL/null, isNoise=false): ${targets.length}건`);

  let changed = 0;
  const samples: string[] = [];
  for (const a of targets) {
    const newTone = heuristicTone(a.title);
    if (newTone === 'NEGATIVE') {
      changed++;
      if (samples.length < 40) samples.push(`  - [${a.category}/${a.source}] ${a.title}`);
      if (!DRY_RUN) {
        await prisma.article.update({ where: { id: a.id }, data: { tone: 'NEGATIVE' } });
      }
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}NEUTRAL → NEGATIVE로 바뀔 기사: ${changed}건`);
  if (samples.length) {
    console.log('\n샘플:');
    console.log(samples.join('\n'));
  }
  if (DRY_RUN) console.log('\n--dry-run 모드라 실제 DB는 변경되지 않았습니다. 확인 후 --dry-run 없이 재실행하세요.');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
