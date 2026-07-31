/**
 * 인터(해외 트렌드) 탭 AI 도메인 노이즈 필터 — 프로바이더 비교 테스트.
 * 실제 RSS(TechCrunch/Ars Technica/Wired/MIT Tech Review)에서 최신 헤드라인을 가져와
 * "AI 업계 트렌드로 관련 있는지" 분류를 OpenAI(gpt-4o-mini) / Gemini 3.1 Flash-Lite
 * (Vertex AI, 서비스 계정 인증) 두 곳에 동일 프롬프트로 돌려 비교한다.
 * OpenRouter는 더 이상 쓰지 않음 — Gemini는 Vertex AI 직접 호출로 전환.
 *
 * 실행: npx tsx scripts/test-inter-noise-filter.ts
 */
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

for (const raw of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] = v;
}

const FEEDS: Record<string, string> = {
  'TechCrunch': 'https://techcrunch.com/feed/',
  'Ars Technica': 'https://feeds.arstechnica.com/arstechnica/index',
  'Wired': 'https://www.wired.com/feed/rss',
  'MIT Tech Review': 'https://www.technologyreview.com/feed/',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function fetchTitles(name: string, url: string, limit = 6): Promise<Array<{ source: string; title: string }>> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const xml = await res.text();
  const titles = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)]
    .map(m => decodeEntities(m[1].trim()))
    .filter(t => t && t !== name && !/^(TechCrunch|WIRED|Ars Technica|MIT Technology Review)/i.test(t));
  return titles.slice(0, limit).map(title => ({ source: name, title }));
}

const SYSTEM = `당신은 스파크랩 인터(해외 트렌드) 탭의 AI 도메인 노이즈 필터입니다.
수집된 해외 기사 제목이 "글로벌 AI 업계 트렌드"(에이전틱AI, 생성형AI, AI 인프라, AI 규제·정책, AI 투자·산업동향,
주요 AI랩 소식 등)와 실제로 관련 있는지 판단합니다.
쿠폰·할인코드, 무관한 소송·노동 분쟁, AI와 무관한 일반 소비자 리뷰, 지정학/일반 정치 뉴스는 관련 없음(noise)입니다.
응답은 반드시 valid JSON 배열만.`;

function buildUser(batch: Array<{ source: string; title: string }>) {
  return `다음 ${batch.length}개 기사 제목을 판단하세요.

${batch.map((a, i) => `${i + 1}. [${a.source}] ${a.title}`).join('\n')}

출력 스키마: [{ "title": "<제목 그대로>", "relevant": true|false, "reason": "<한 줄 이유>" }]
JSON 배열만 반환:`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('['); const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

type Verdict = { title: string; relevant: boolean; reason: string };

function toVerdicts(text: string, batch: Array<{ source: string; title: string }>): Verdict[] {
  const parsed = JSON.parse(extractJson(text)) as Verdict[];
  // 모델이 title을 살짝 다르게 echo하는 경우가 있어 매칭은 순서(index) 기준으로.
  return batch.map((a, i) => ({ title: a.title, relevant: !!parsed[i]?.relevant, reason: parsed[i]?.reason ?? '(응답 누락)' }));
}

async function classifyOpenAI(client: OpenAI, model: string, batch: Array<{ source: string; title: string }>): Promise<{ verdicts: Verdict[]; ms: number }> {
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUser(batch) },
    ],
  });
  const ms = Date.now() - t0;
  const text = resp.choices[0]?.message?.content ?? '';
  return { verdicts: toVerdicts(text, batch), ms };
}

async function classifyVertex(ai: GoogleGenAI, model: string, batch: Array<{ source: string; title: string }>): Promise<{ verdicts: Verdict[]; ms: number }> {
  const t0 = Date.now();
  const result = await ai.models.generateContent({
    model,
    contents: buildUser(batch),
    config: { systemInstruction: SYSTEM },
  });
  const ms = Date.now() - t0;
  return { verdicts: toVerdicts(result.text ?? '', batch), ms };
}

async function main() {
  console.log('=== RSS 헤드라인 수집 ===');
  const articles: Array<{ source: string; title: string }> = [];
  for (const [name, url] of Object.entries(FEEDS)) {
    try {
      const items = await fetchTitles(name, url);
      console.log(`  ${name}: ${items.length}건`);
      articles.push(...items);
    } catch (e: any) {
      console.log(`  ${name}: 실패(${e.message})`);
    }
  }
  console.log(`총 ${articles.length}건 수집\n`);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  // GOOGLE_APPLICATION_CREDENTIALS(google-service-account.json)를 자동으로 읽어 인증한다.
  // gemini-3.1 계열은 global 리전에서만 서빙됨 (2.5 계열은 us-central1에서도 됐지만 3.1은 global 필수).
  const vertexAI = new GoogleGenAI({ vertexai: true, project: 'communication-504101', location: 'global' });

  const CANDIDATES: Array<
    | { label: string; provider: 'openai'; model: string }
    | { label: string; provider: 'vertex'; model: string }
  > = [
    { label: 'OpenAI gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini' },
    { label: 'Gemini 3.1 Flash-Lite', provider: 'vertex', model: 'gemini-3.1-flash-lite' },
  ];

  const results: Record<string, Verdict[]> = {};
  for (const c of CANDIDATES) {
    try {
      const { verdicts, ms } = c.provider === 'openai'
        ? await classifyOpenAI(openai, c.model, articles)
        : await classifyVertex(vertexAI, c.model, articles);
      results[c.label] = verdicts;
      console.log(`[${c.label}] ${ms}ms · ${verdicts.length}건 응답`);
    } catch (e: any) {
      console.log(`[${c.label}] 오류: ${(e.message || '').split('\n')[0]}`);
      results[c.label] = [];
    }
  }

  console.log('\n=== 비교표 ===');
  articles.forEach((a, i) => {
    const row = CANDIDATES.map(c => {
      const v = results[c.label]?.[i];
      if (!v) return '??';
      return v.relevant ? '✅관련' : '⛔노이즈';
    });
    const agree = new Set(row).size === 1 ? '' : '  ← 의견 갈림';
    console.log(`[${a.source}] ${a.title}`);
    CANDIDATES.forEach((c, ci) => {
      const v = results[c.label]?.[i];
      console.log(`   ${row[ci]} ${c.label.padEnd(24)} ${v ? '· ' + v.reason : ''}`);
    });
    if (agree) console.log(agree.trim());
    console.log('');
  });
}

main().catch(e => { console.error('치명적 오류:', e); process.exitCode = 1; });
