/**
 * 기사 재분류 스크립트 — Supabase Article의 category / tone / pitchScore 재산정.
 * 이관된 기사에 옛 판정값이 남아 부정·피칭 카드가 빈 문제를 해소.
 *
 * 실행:
 *   npx tsx scripts/reclassify-articles.ts --dry-run            # 쓰기 없이 미리보기
 *   npx tsx scripts/reclassify-articles.ts --recent             # 최근7일 OR 포트폴리오사 기사만 (권장 우선)
 *   npx tsx scripts/reclassify-articles.ts --recent --limit=50  # 소량 테스트
 *   npx tsx scripts/reclassify-articles.ts --all                # 전체(25k) — 저녁에 필요 시만
 *   (중단됐다 다시 실행하면 이어서 진행. 처음부터: --restart)
 *
 * 옵션: --dry-run  --recent(기본)  --all  --batch=100  --limit=N  --restart
 * ※ tsx는 .env.local 자동 로드 안 함 → 아래에서 직접 주입. DB=Supabase(POSTGRES_PRISMA_URL).
 */
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { crisisKeywordsForPrompt, CRISIS_KEYWORDS_FLAT } from '../src/lib/sparkscope/crisis-keywords';
import { matchesAsToken } from '../src/lib/sparkscope/relevance';

// ── env 로드 ──────────────────────────────────────────────
for (const raw of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] = v;
}

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const num = (f: string, d: number) => { const a = args.find(x => x.startsWith(`${f}=`)); return a ? parseInt(a.split('=')[1], 10) : d; };
const DRY = has('--dry-run');
const ALL = has('--all');
const CRISIS = has('--crisis');   // 노이즈 처리된 포폴 기사 중 위기키워드 매칭분 재심사(숨은 부정 되살리기)
const RECENT = has('--recent') || !ALL;   // 전체는 --all 명시할 때만. 기본은 recent(안전).
const DB_BATCH = num('--batch', 100);
const LIMIT = num('--limit', 0);           // 0 = 무제한
const RESTART = has('--restart');
const AI_BATCH = 10;                        // Claude 1콜당 기사 수
const MODEL = 'claude-sonnet-4-6';          // 심층 판정 티어(오탐 규칙 판단력)
const PROGRESS = path.resolve(process.cwd(), '.reclassify-progress.json');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const db = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_PRISMA_URL! } } });

// ── 재분류 프롬프트 (기존 분류 정의 + 오탐 규칙 반영) ──────────
const SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 뉴스 재분류 애널리스트입니다.
스파크랩은 한국 대표 액셀러레이터로 200여 개 포트폴리오사를 보유합니다.
수집된 한국어 기사를 다시 정확히 분류합니다. 의심스러우면 보수적으로 unrelated 처리.
응답은 반드시 valid JSON 배열만, 추가 설명 없이.`;

function buildUser(batch: Array<{ id: string; title: string; source: string; matchedKeyword: string; category: string }>, universe: string[]) {
  return `다음 ${batch.length}개 기사를 재분류하세요.

우리 포트폴리오사 예시(참조):
${universe.slice(0, 60).join(', ')} 등

기사:
${batch.map(a => JSON.stringify({ id: a.id, title: a.title, source: a.source, matchedKeyword: a.matchedKeyword })).join('\n')}

카테고리: sparklabs_self / portfolio_company / competitor / industry_trend / unrelated
- sparklabs_self: 스파크랩 그룹 법인·임원진(김호민·김유진 등)
- portfolio_company: 스파크랩이 투자한 포트폴리오사
- competitor: 타 AC·VC 업계(경쟁 액셀러레이터·벤처캐피탈)
- industry_trend: 스타트업 생태계·정부·정책 등 업계 전반

오탐 규칙 (엄격):
1) 매칭 키워드(회사명)가 기사의 주어여야 함. 회사명 완전일치 우선, 부분일치는 문맥 확인 → 아니면 unrelated + isNoise.
2) "Spark" 단독은 스파크랩이 아님(NVIDIA DGX Spark, Adobe Spark, Apache Spark 등) → sparklabs_self 금지.
3) 수족관·동물원·의원(병원)·음식점 등 무관 도메인 기사는 unrelated + isNoise(noiseReason="irrelevant") 또는 pitchScore 대폭 감점.
4) 유사 사명 문맥 구분: 케어닥 vs 케어네이션, 노리 vs 동사 '노리다', 리코 vs 인실리코, 비트바이트 vs 바이비트 등 — 실제 주체가 우리 회사가 아니면 unrelated(noiseReason="homonym").
5) 자동생성 시세·주가 기사 → isNoise=true, noiseReason="auto_generated".

tone: 기사 논조 POSITIVE | NEUTRAL | NEGATIVE | MIXED

부정·위기 판정 가이드 (tone=NEGATIVE 가중):
아래 위기 키워드가 "포트폴리오사(또는 스파크랩)가 주어인" 맥락에서 실제 악재로 등장하면 tone=NEGATIVE로 판정하세요.
${crisisKeywordsForPrompt()}
단, 다음은 NEGATIVE 아님(오탐 방지 — 매우 중요):
 - 정치·스포츠·연예 등 무관 도메인(주체가 우리 회사가 아님) → unrelated + isNoise
 - 이미 해소·무혐의·승소·무죄 등 긍정/중립 결말("의혹 벗었다","무혐의","무죄 확정","해소") → POSITIVE 또는 NEUTRAL
 - 제품·서비스의 기능·시장 명칭에 단어만 포함(예: '사기 탐지' 솔루션, '보안사고 대응' 서비스, '장애' 극복) → 악재 아님, 오히려 사업 내용
 - 정치 키워드(조국·민주당 등)만 있는 기사 → isNoise=true, noiseReason="정치"

pitchScore(0~100): 이 주제로 우리 포트폴리오사를 엮어 기획기사 피칭이 성사될 가능성. sparklabs_self/portfolio_company가 아니거나 무관하면 대체로 낮음.

출력 스키마(각 기사):
{ "id": "<입력 id>", "category": "...", "tone": "...", "pitchScore": 0-100, "isNoise": true|false, "noiseReason": null|"homonym"|"auto_generated"|"ad_content"|"irrelevant" }

JSON 배열만 반환:`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('['); const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

async function reclassifyBatch(batch: any[], universe: string[]) {
  const r = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildUser(batch, universe) }],
  });
  const text = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const parsed = JSON.parse(extractJson(text)) as Array<{ id: string; category: string; tone: string; pitchScore: number; isNoise: boolean; noiseReason: string | null }>;
  return parsed;
}

async function main() {
  const t0 = Date.now();
  console.log(`=== 기사 재분류 ${DRY ? '[DRY-RUN]' : '[실제]'} · 범위 ${ALL ? '전체' : '최근7일+포트폴리오'} · 모델 ${MODEL} ===`);

  // 포트폴리오 유니버스(참조용 회사명)
  const targets = await db.monitoringTarget.findMany({ where: { category: 'portfolio_company', status: 'ACTIVE' }, select: { name: true } });
  const universe = targets.map(t => t.name);

  // ── --crisis: 노이즈 처리된 포폴 기사 중 위기키워드 토큰매칭분만 재심사 (숨은 진짜 부정 되살리기) ──
  if (CRISIS) {
    const d90 = new Date(); d90.setMonth(d90.getMonth() - 3);
    const pool = await db.article.findMany({
      where: { category: 'portfolio_company', pubDate: { gte: d90 } },
      select: { id: true, title: true, source: true, matchedKeyword: true, category: true, tone: true, pitchScore: true, isNoise: true, noiseReason: true },
    });
    const cand = pool.filter(a => CRISIS_KEYWORDS_FLAT.some(k => matchesAsToken(a.title, k)));
    console.log(`[--crisis] 최근3개월 포폴 기사 ${pool.length}건 중 위기키워드 토큰매칭 ${cand.length}건 재심사 (모델 ${MODEL})`);
    let rescued = 0, kept = 0, cerr = 0;
    const reNeg: string[] = [];
    for (let i = 0; i < cand.length; i += AI_BATCH) {
      const chunk = cand.slice(i, i + AI_BATCH);
      try {
        const results = await reclassifyBatch(chunk, universe);
        const byId = new Map(results.map(r => [r.id, r]));
        for (const a of chunk) {
          const r = byId.get(a.id);
          if (!r) { cerr++; continue; }
          const nowNoise = !!r.isNoise;
          if (a.isNoise && !nowNoise) rescued++;      // 노이즈 → 되살림
          if (nowNoise) kept++;
          if (r.tone === 'NEGATIVE' && !nowNoise) reNeg.push(`${r.category}/${a.matchedKeyword}: ${a.title.slice(0, 50)}`);
          if (!DRY) {
            await db.article.update({
              where: { id: a.id },
              data: { category: r.category, tone: r.tone, pitchScore: r.pitchScore ?? 0, isNoise: nowNoise, noiseReason: r.noiseReason ?? null, analyzedAt: new Date() },
            }).catch(e => { cerr++; console.error(`[ERR] ${a.id}: ${e.message}`); });
          }
        }
      } catch (e: any) { cerr += chunk.length; console.error(`[ERR] batch: ${(e.message || '').split('\n')[0]}`); }
      process.stdout.write(`\r  진행 ${Math.min(i + AI_BATCH, cand.length)}/${cand.length} · 되살림 ${rescued} · 노이즈유지 ${kept} · 오류 ${cerr}   `);
    }
    process.stdout.write('\n');
    console.log(`\n[--crisis 결과] 되살린(부정 후보) ${rescued}건 · 노이즈 유지 ${kept}건 · 오류 ${cerr}${DRY ? ' (DRY: 미저장)' : ''}`);
    console.log(`비노이즈 + tone=NEGATIVE로 판정된 기사 ${reNeg.length}건:`);
    for (const s of reNeg) console.log('  · ' + s);
    return;
  }

  // 대상 where
  const where: any = { isNoise: false };
  if (RECENT && !ALL) {
    const d7 = new Date(); d7.setDate(d7.getDate() - 7);
    where.OR = [{ pubDate: { gte: d7 } }, { category: 'portfolio_company' }];
  }
  const total = await db.article.count({ where });
  const cap = LIMIT > 0 ? Math.min(LIMIT, total) : total;
  console.log(`대상 ${total.toLocaleString()}건${LIMIT ? ` (이번 실행 상한 ${cap})` : ''}`);

  // 재개(cursor)
  let cursor: string | undefined;
  if (!RESTART && fs.existsSync(PROGRESS)) {
    try { cursor = JSON.parse(fs.readFileSync(PROGRESS, 'utf8')).lastId; if (cursor) console.log(`이어서 진행: lastId=${cursor}`); } catch {}
  }

  let done = 0, changed = 0, errors = 0;
  while (done < cap) {
    const page: any[] = await db.article.findMany({
      where, orderBy: { id: 'asc' }, take: Math.min(DB_BATCH, cap - done),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, title: true, source: true, matchedKeyword: true, category: true, tone: true, pitchScore: true },
    });
    if (page.length === 0) break;

    for (let i = 0; i < page.length; i += AI_BATCH) {
      const chunk = page.slice(i, i + AI_BATCH);
      try {
        const results = await reclassifyBatch(chunk, universe);
        const byId = new Map(results.map(r => [r.id, r]));
        for (const a of chunk) {
          const r = byId.get(a.id);
          if (!r) { errors++; console.error(`[MISS] id=${a.id} (응답 누락)`); continue; }
          const willChange = r.category !== a.category || r.tone !== a.tone || (r.pitchScore ?? 0) !== (a.pitchScore ?? 0);
          if (willChange) changed++;
          if (!DRY) {
            await db.article.update({
              where: { id: a.id },
              data: { category: r.category, tone: r.tone, pitchScore: r.pitchScore ?? 0, isNoise: !!r.isNoise, noiseReason: r.noiseReason ?? null, analyzedAt: new Date() },
            }).catch(e => { errors++; console.error(`[ERR] update id=${a.id}: ${e.message}`); });
          }
        }
      } catch (e: any) {
        errors += chunk.length;
        console.error(`[ERR] batch(${chunk.map(c => c.id).join(',')}): ${(e.message || '').split('\n')[0]}`);
      }
    }

    done += page.length;
    cursor = page[page.length - 1].id;
    if (!DRY) fs.writeFileSync(PROGRESS, JSON.stringify({ lastId: cursor, updatedAt: new Date().toISOString() }));
    const pct = cap ? Math.round((done / cap) * 100) : 100;
    process.stdout.write(`\r진행 ${done}/${cap} (${pct}%) · 변경 ${changed} · 오류 ${errors}   `);
  }
  process.stdout.write('\n');

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`\n완료: ${done}건 처리 · ${changed}건 변경${DRY ? '(예상, 미저장)' : ''} · 오류 ${errors} · ${Math.floor(secs / 60)}분 ${secs % 60}초`);
  if (!DRY && done >= cap && LIMIT === 0) { fs.rmSync(PROGRESS, { force: true }); console.log('전체 완료 → 진행파일 삭제(다음 실행은 처음부터).'); }
}

main().catch(e => { console.error('치명적 오류:', e); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
