/**
 * 포트폴리오사 섹터 태깅 — Inter(해외 트렌드) 탭의 "포트폴리오 매치" 기반 작업.
 * data/master-keywords.json의 businessContext(→ notes)를 근거로 각 회사를
 * 바이오/AI 도메인 + 세부 섹터로 1회성 분류한다. gpt-4o-mini 사용(저비용 분류 작업).
 *
 * 결과는 DB나 master-keywords.json을 직접 건드리지 않고
 * data/portfolio-sectors-draft.json에 별도로 써서 검토 후 반영하도록 함.
 *
 * 실행:
 *   npx tsx scripts/tag-portfolio-sectors.ts              # 전체(Live + notes 있는 회사)
 *   npx tsx scripts/tag-portfolio-sectors.ts --limit=20    # 소량 테스트
 */
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { COMPANY_BIO_SECTORS, COMPANY_AI_SECTORS, COMPANY_OTHER_SECTORS } from '../src/lib/sparkscope/inter-taxonomy';

// ── env 로드 (tsx는 .env.local 자동 로드 안 함) ──────────────
for (const raw of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] = v;
}

const args = process.argv.slice(2);
const num = (f: string, d: number) => { const a = args.find(x => x.startsWith(`${f}=`)); return a ? parseInt(a.split('=')[1], 10) : d; };
const LIMIT = num('--limit', 0); // 0 = 무제한

const MODEL = 'gpt-4o'; // 경계 판단(도구 vs 상품)이 필요한 태깅이라 mini보다 한 단계 위 사용. 194건 1회성이라 비용 무시 가능.
const AI_BATCH = 10;
const MASTER_PATH = path.resolve(process.cwd(), 'data/master-keywords.json');
const OUT_PATH = path.resolve(process.cwd(), 'data/portfolio-sectors-draft.json');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ── 섹터 택소노미 — src/lib/sparkscope/inter-taxonomy.ts가 단일 소스, 여기선 재사용만 ──
const BIO_SECTORS = COMPANY_BIO_SECTORS;
const AI_SECTORS = COMPANY_AI_SECTORS;
const OTHER_SECTORS = COMPANY_OTHER_SECTORS;

const SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 포트폴리오 분류 애널리스트입니다.
각 회사의 사업 설명(businessContext)만 보고 domain(대분류) + sector(세부분류)를 태깅합니다.
바이오/AI는 인터(해외 트렌드) 탭에서 "글로벌 AI/바이오 업계 뉴스가 이 회사에 실제로 적용되는지" 매칭에 쓰이므로
엄격하게 판단하고, 그 외 모든 회사도 업종 태그가 비어있으면 안 됩니다(전수 태깅).

**판단 우선순위(중요)**
1) 바이오 우선 규칙: 신약·치료제·의료기기·임상 파이프라인이 회사의 최종 산출물이면,
   그 과정에 AI를 기술로 썼더라도 domain="바이오"입니다 (바이오가 AI보다 우선).
   예: "AI로 신약 후보물질을 발굴"하는 회사 → 바이오/신약발굴 (최종 산출물은 치료제).
2) 바이오가 아닌 경우, AI 우선 규칙: 회사 설명에서 AI(인공지능/AI엔진/AI 모델/딥러닝 등)가
   그 회사 솔루션의 핵심 구현 기술로 명시돼 있으면, 적용 산업(핀테크·교통·농업·애드테크·에듀테크 등)에
   관계없이 domain="AI"입니다. "AI가 부가기능이 아니라 그 회사 솔루션의 핵심 동작 원리인가"만 보면 됩니다.
   예: "AI 엔진으로 금융 데이터를 분석하는 핀테크 플랫폼" → AI (핀테크가 아니라 AI).
       "AI 기술로 교통안전 문제를 해결하는 스마트 교통 솔루션" → AI.
       "AI 기후테크 플랫폼으로 농지 데이터를 분석" → AI.
   반대로 설명에 AI 언급이 전혀 없거나 지나가는 말로만 붙어 있고, 실제 핵심은 다른 기술(IoT 하드웨어,
   물류망, 오프라인 매장 등)이면 해당 업종으로 분류합니다.
3) 콘텐츠/서비스 자체가 상품이고 AI는 그 제작 과정에서만 쓰인 경우(예: AI로 만든 콘텐츠를 유통하는
   미디어 앱)는 여전히 그 콘텐츠/서비스 업종으로 분류합니다 — "무엇을 만드는 기술"과 "무엇을 유통·판매하는
   사업"을 구분하되, 2)의 벤치마크는 "AI가 솔루션의 핵심 동작 원리인가"이므로 애매하면 AI 쪽으로 기웁니다.
4) 바이오/AI가 아닌 모든 회사는 sector를 아래 기타 업종 목록에서 가장 가까운 것으로 반드시 하나 고릅니다.
   정말 안 맞으면 "기타"를 씁니다 — null은 허용되지 않습니다.

**참고 예시**
- "포스코 사내벤처 출신 제조 AI 솔루션 기업. 공정 최적화 AI '마이너 리포트' 개발" → AI/AI버티컬 SaaS.
- "도로 라스트마일 교통안전 문제를 AI 기술로 해결하는 스마트 교통 솔루션" → AI/AI버티컬 SaaS (AI가 핵심 동작 원리).
- "올인원 IoT 센서로 농지 데이터를 수집·분석하는 AI 기후테크 플랫폼" → AI/AI버티컬 SaaS.
- "AI 엔진과 데이터 매핑 기술을 활용한 금융 정보 플랫폼" → AI/AI버티컬 SaaS.
- "AI로 신약 후보물질을 발굴"하는 회사 → 바이오/신약발굴 (바이오 우선 규칙이 AI 우선 규칙보다 먼저 적용).
- "IoT 기반 무인 공유창고 관리 시스템"(AI 언급 없음) → 기타산업/프롭테크·공간 (AI가 핵심 기술이 아님).

domain은 다음 중 하나: "바이오" | "AI" | "기타산업"

domain="바이오"면 sector는 다음 중 하나: ${BIO_SECTORS.join(', ')}
domain="AI"면 sector는 다음 중 하나: ${AI_SECTORS.join(', ')}
domain="기타산업"이면 sector는 다음 중 하나(반드시 선택, null 금지): ${OTHER_SECTORS.join(', ')}

응답은 반드시 valid JSON 배열만, 추가 설명 없이.`;

function buildUser(batch: Array<{ name: string; notes: string }>) {
  return `다음 ${batch.length}개 회사를 분류하세요.

${batch.map((c, i) => `${i + 1}. ${c.name}: ${c.notes}`).join('\n')}

출력 스키마(각 회사, 입력 순서대로):
{ "name": "<회사명 그대로>", "domain": "바이오"|"AI"|"기타산업", "sector": "<domain에 맞는 목록 중 하나, null 금지>", "reason": "<판단 근거 한 문장>" }

JSON 배열만 반환:`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('['); const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

type Tagged = { name: string; domain: '바이오' | 'AI' | '기타산업'; sector: string | null; reason: string };

async function tagBatch(batch: Array<{ name: string; notes: string }>): Promise<Tagged[]> {
  const resp = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUser(batch) },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? '';
  return JSON.parse(extractJson(text)) as Tagged[];
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8')) as Array<{
    name: string; category: string; portfolioStatus: string | null; notes: string | null;
  }>;

  const candidates = master
    .filter(c => c.category === 'portfolio_company' && c.portfolioStatus === 'Live' && c.notes && c.notes.trim())
    .map(c => ({ name: c.name, notes: c.notes!.trim() }));

  const targets = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;
  console.log(`=== 포트폴리오 섹터 태깅 · 대상 ${targets.length}개(Live + businessContext 보유) · 모델 ${MODEL} ===`);

  const results: Tagged[] = [];
  let errors = 0;
  for (let i = 0; i < targets.length; i += AI_BATCH) {
    const chunk = targets.slice(i, i + AI_BATCH);
    try {
      const tagged = await tagBatch(chunk);
      const byName = new Map(tagged.map(t => [t.name, t]));
      for (const c of chunk) {
        const t = byName.get(c.name);
        if (!t) { errors++; console.error(`[MISS] ${c.name} (응답 누락)`); continue; }
        results.push(t);
      }
    } catch (e: any) {
      errors += chunk.length;
      console.error(`[ERR] batch(${chunk.map(c => c.name).join(',')}): ${(e.message || '').split('\n')[0]}`);
    }
    process.stdout.write(`\r진행 ${Math.min(i + AI_BATCH, targets.length)}/${targets.length} · 오류 ${errors}   `);
  }
  process.stdout.write('\n');

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), 'utf8');

  // ── 요약 ──
  const byDomain = new Map<string, number>();
  const bySector = new Map<string, number>();
  for (const r of results) {
    byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + 1);
    if (r.sector) bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + 1);
  }
  console.log(`\n완료: ${results.length}개 태깅 · 오류 ${errors} · → ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log('\n[도메인별]');
  for (const [k, v] of byDomain) console.log(`  ${k}: ${v}`);
  console.log('\n[섹터별]');
  for (const [k, v] of [...bySector.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
}

main().catch(e => { console.error('치명적 오류:', e); process.exitCode = 1; });
