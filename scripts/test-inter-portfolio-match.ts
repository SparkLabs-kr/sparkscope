/**
 * 인터(해외 트렌드) 탭 "포트폴리오 매치" 추론 단계 — 프로바이더 비교 테스트.
 * 실제 글로벌 AI 뉴스 헤드라인 3개 + 실제 AI 도메인 포트폴리오사 45개(사업설명 포함)를 놓고
 * "이 뉴스가 어느 회사에 적용되는지 + 왜 + 얼마나 급한지"를 gpt-5-mini / Gemini 3.5 Flash /
 * Claude Haiku 4.5(전부 OpenRouter 경유)로 동일하게 물어봐서 비교한다.
 *
 * 실행: npx tsx scripts/test-inter-portfolio-match.ts
 */
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

for (const raw of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] = v;
}

// 실제 TechCrunch/MIT Tech Review에서 수집한 헤드라인(2026-07-30 기준, 조작 없음)
const ARTICLES = [
  { source: 'TechCrunch', title: 'Mark Zuckerberg predicts that billions of people will have personal AI agents in five years' },
  { source: 'MIT Tech Review', title: 'The Download: a chip talent battle, and deflating AI hype' },
  { source: 'MIT Tech Review', title: "OpenAI called the Hugging Face attack unprecedented. But we've been here before." },
];

const companies = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-soyun-Desktop-Sparkscope/11a54357-ec85-4749-9053-69798280cf62/scratchpad/ai_companies_for_test.json', 'utf8')) as
  Array<{ name: string; sector: string; business: string }>;

const SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 인터(해외 트렌드) 탭 애널리스트입니다.
글로벌 AI 업계 뉴스 하나와 스파크랩 AI 도메인 포트폴리오사 목록(사업설명 포함)을 받습니다.
이 뉴스가 "실제로" 적용되는 포트폴리오사가 있으면 골라서 이유와 긴급도를 답하세요.
엄격하게 판단하세요 — 회사 3개 이하로 엄선하고, "AI를 다루니까 어떻게든 관련 있어 보인다" 식의
느슨한 연결(간접적·일반적 산업 트렌드 수준)은 배제하세요. 이 뉴스가 아니었으면 나올 수 없는,
그 회사에 구체적이고 직접적인 영향(경쟁·리스크·기회)이 있을 때만 포함합니다.
진짜 관련 있는 회사가 없으면 빈 배열을 반환하는 게 맞습니다.
긴급도: "urgent"(즉각 대응 필요한 위협/경쟁 리스크), "watch"(모니터링 필요), "pos"(기회 시그널) 중 하나.
응답은 반드시 valid JSON만.`;

function buildUser(article: { source: string; title: string }) {
  return `뉴스: [${article.source}] ${article.title}

포트폴리오사 목록:
${companies.map(c => `- ${c.name} (${c.sector}): ${c.business}`).join('\n')}

출력 스키마:
{ "matches": [{ "company": "<회사명>", "urgency": "urgent"|"watch"|"pos", "reason": "<한 문장, 왜 이 회사에 적용되는지>" }] }
매칭 없으면 { "matches": [] }. JSON만 반환:`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

type Match = { company: string; urgency: string; reason: string };

async function matchOne(client: OpenAI, model: string, article: { source: string; title: string }) {
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUser(article) },
    ],
  });
  const ms = Date.now() - t0;
  const text = resp.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(extractJson(text)) as { matches: Match[] };
  return { matches: parsed.matches ?? [], ms };
}

async function main() {
  const openrouter = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY!, baseURL: 'https://openrouter.ai/api/v1' });

  const CANDIDATES = [
    { label: 'GPT-4o', model: 'openai/gpt-4o' },
    { label: 'GPT-5.4-mini', model: 'openai/gpt-5.4-mini' },
    { label: 'Claude Haiku 4.5', model: 'anthropic/claude-haiku-4.5' },
  ];

  console.log(`후보 회사 ${companies.length}개 (AI 도메인, businessContext 포함)\n`);

  for (const article of ARTICLES) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${article.source}] ${article.title}`);
    console.log('='.repeat(70));

    for (const c of CANDIDATES) {
      try {
        const { matches, ms } = await matchOne(openrouter, c.model, article);
        console.log(`\n--- ${c.label} (${ms}ms, 매칭 ${matches.length}건) ---`);
        if (matches.length === 0) console.log('  (매칭 없음)');
        for (const m of matches) console.log(`  [${m.urgency}] ${m.company}: ${m.reason}`);
      } catch (e: any) {
        console.log(`\n--- ${c.label}: 오류 ${(e.message || '').split('\n')[0]} ---`);
      }
    }
  }
}

main().catch(e => { console.error('치명적 오류:', e); process.exitCode = 1; });
