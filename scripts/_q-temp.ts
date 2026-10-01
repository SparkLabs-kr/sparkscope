import './_env';
import OpenAI from 'openai';
import { prisma } from '../src/lib/prisma';
import { loadSendArticles } from '../src/lib/sparkscope/runner';
import { buildClusteredPool, rankTop3Pool } from '../src/lib/sparkscope/digest';
import { buildDigestKeyMap, buildDigestContextMap, passesDigestGuard } from '../src/lib/sparkscope/review';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const SYS = `당신은 스파크랩 다이제스트 메일의 최종 검수자입니다.
아래 각 기사 제목이 대괄호로 표시된 회사/주제에 대한 "진짜" 보도인지 판단하세요.
무효(invalid) 처리 기준 — 다음 중 하나라도 확실히 해당하면 invalid:
- 광고·홍보성 문구, 스포츠·연예 기사, 사진 캡션
- 명시된 회사와 이름만 같고 실제로는 무관한 대상(동명이인 등)
- 여러 기관을 나열하는 문장에서 그 회사가 주어가 아닌 단순 언급
애매하면(진짜 관련 있어 보이면) valid로 판단하세요 — 확실한 근거가 있을 때만 invalid 처리.
응답은 반드시 valid JSON 배열로만, 다른 설명 없이: [{"index": 0, "valid": true}, ...]`;

async function verify(batch: any[], temp?: number): Promise<string> {
  const user = batch.map((c, i) => `${i}. [${c.category}/${c.matchedKeyword}] ${c.title}`).join('\n');
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini', max_tokens: 500,
    ...(temp !== undefined ? { temperature: temp } : {}),
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
  });
  const t = (r.choices[0]?.message?.content ?? '').replace(/```json\n?|```/g, '').trim();
  const p = JSON.parse(t) as { index: number; valid: boolean }[];
  return batch.map((_, i) => (p.find(x => x.index === i)?.valid ?? true) ? 'O' : 'X').join('');
}

(async () => {
  const raw = await loadSendArticles();
  const analyzed = (raw as any[]).map(a => ({ ...a, relatedCompanies: typeof a.relatedCompanies === 'string' ? JSON.parse(a.relatedCompanies) : (a.relatedCompanies ?? []) }));
  const t = await prisma.monitoringTarget.findMany({ where: { category: { in: ['portfolio_company','sparklabs_self'] }, status: 'ACTIVE' }, select: { primaryKeyword:true, name:true, englishName:true, helperKeywords:true, contextWords:true } });
  const ready = analyzed.filter(a => passesDigestGuard(a, buildDigestKeyMap(t), buildDigestContextMap(t)));
  const scrapped = await prisma.article.findMany({ where: { isScrapped: true }, select: { link: true } });
  const pool = rankTop3Pool(buildClusteredPool(ready), new Set(scrapped.map(s=>s.link))).slice(0, 8);
  console.log('검증 후보 8건:');
  pool.forEach((c:any,i:number)=>console.log(`  ${i} [${c.category}] ${c.title.slice(0,52)}`));

  for (const [label, temp] of [['현재 (temperature 미지정)', undefined], ['temperature: 0', 0]] as const) {
    const runs: string[] = [];
    for (let i = 0; i < 5; i++) runs.push(await verify(pool, temp));
    const uniq = new Set(runs);
    console.log(`\n${label}  5회: ${runs.join(' ')}`);
    console.log(`  서로 다른 결과 ${uniq.size}가지 → ${uniq.size === 1 ? '매번 같음' : '실행마다 달라짐'}`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error(String(e).slice(0,500)); process.exit(1); });
