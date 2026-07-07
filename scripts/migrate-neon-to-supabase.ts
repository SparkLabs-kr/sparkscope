/**
 * Neon → Supabase 데이터 이관 스크립트 (Prisma 방식)
 *
 *   npx tsx scripts/migrate-neon-to-supabase.ts --dry-run   # 읽기만: 테이블·건수·순서 표시
 *   npx tsx scripts/migrate-neon-to-supabase.ts             # 실제 이관 (Neon→Supabase upsert)
 *
 * 동작:
 *  - Neon용/Supabase용 PrismaClient를 각각 datasource url 오버라이드로 생성
 *      읽기(소스)  = NEON_POSTGRES_PRISMA_URL
 *      쓰기(대상)  = POSTGRES_PRISMA_URL (Supabase)
 *  - DMMF로 모든 모델을 자동 감지 → 외래키 의존성 위상정렬(참조 대상 먼저)
 *  - 테이블마다 100건씩 배치로 읽어 unique key 기준 upsert(중복이면 덮어쓰기)
 *  - 진행률 "Article: 1500/2388 (63%)" 표시, 오류는 테이블·ID 로그 후 다음 건 계속
 *
 * 주의: tsx는 .env.local을 자동 로드하지 않으므로 아래에서 직접 읽어 주입한다.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const BATCH = 100;
const DRY_RUN = process.argv.includes('--dry-run');

// ─── .env.local 로드 (주석/따옴표 처리, 활성 줄만) ────────────────────────────
function loadEnvLocal() {
  const p = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val; // 활성 줄만 오므로 마지막 값이 유효
  }
}
loadEnvLocal();

// Supabase 풀러(6543) URL이 pgbouncer 파라미터가 없으면 대량 upsert 시
// "prepared statement already exists" 오류가 날 수 있어 자동 보정.
function normalizeSupabaseUrl(url: string): string {
  if (/:6543\b/.test(url) && !/pgbouncer=/.test(url)) {
    const sep = url.includes('?') ? '&' : '?';
    const fixed = `${url}${sep}pgbouncer=true&connection_limit=1`;
    console.log('[supabase] 풀러 URL에 pgbouncer=true 자동 추가 (안정성)');
    return fixed;
  }
  return url;
}

const NEON_URL = process.env.NEON_POSTGRES_PRISMA_URL;
const SUPA_URL = process.env.POSTGRES_PRISMA_URL;

function fail(msg: string): never { console.error(`❌ ${msg}`); process.exit(1); }
if (!NEON_URL) fail('NEON_POSTGRES_PRISMA_URL 이 .env.local 에 없습니다.');
if (!SUPA_URL) fail('POSTGRES_PRISMA_URL 이 .env.local 에 없습니다.');
if (!/neon\.tech/.test(NEON_URL)) fail(`소스(NEON_POSTGRES_PRISMA_URL)가 Neon이 아닙니다: ${hostOf(NEON_URL)}`);
if (!/supabase/.test(SUPA_URL)) fail(`대상(POSTGRES_PRISMA_URL)이 Supabase가 아닙니다: ${hostOf(SUPA_URL)}`);

function hostOf(u: string): string { const m = u.match(/@([^:/?]+)(:\d+)?/); return m ? m[1] + (m[2] ?? '') : '?'; }

const neon = new PrismaClient({ datasources: { db: { url: NEON_URL } } });
const supa = new PrismaClient({ datasources: { db: { url: normalizeSupabaseUrl(SUPA_URL) } } });

// ─── 모델 메타 (DMMF) ────────────────────────────────────────────────────────
type DModel = (typeof Prisma.dmmf.datamodel.models)[number];
const MODELS = Prisma.dmmf.datamodel.models as unknown as DModel[];
const delegate = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

// FK 의존성 위상정렬: M이 relationFromFields를 가진 관계로 T를 참조하면 T가 먼저.
function orderByFk(models: DModel[]): string[] {
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    const s = new Set<string>();
    for (const f of m.fields as any[]) {
      if (f.kind === 'object' && Array.isArray(f.relationFromFields) && f.relationFromFields.length > 0) {
        if (f.type !== m.name) s.add(f.type); // 자기참조 제외
      }
    }
    deps.set(m.name, s);
  }
  const order: string[] = [];
  const done = new Set<string>();
  const stack = new Set<string>();
  const visit = (n: string) => {
    if (done.has(n) || stack.has(n)) return; // 방문완료/사이클이면 skip
    stack.add(n);
    for (const d of deps.get(n) ?? []) visit(d);
    stack.delete(n);
    done.add(n);
    order.push(n);
  };
  for (const m of models) visit(m.name);
  return order; // 참조 대상이 앞에 옴
}

// upsert용 unique where 생성 (단일 @id → 복합 PK → 복합 유니크 → 단일 유니크)
function uniqueWhere(m: DModel, rec: any): Record<string, any> | null {
  const idField = (m.fields as any[]).find(f => f.isId);
  const pk = (m as any).primaryKey as { fields: string[] } | null;
  if (pk && pk.fields.length > 1) {
    const val: any = {}; for (const f of pk.fields) val[f] = rec[f];
    return { [pk.fields.join('_')]: val };
  }
  if (idField) return { [idField.name]: rec[idField.name] };
  const uniques = (m as any).uniqueFields as string[][] | undefined;
  if (uniques && uniques.length) {
    const uf = uniques[0];
    if (uf.length === 1) return { [uf[0]]: rec[uf[0]] };
    const val: any = {}; for (const f of uf) val[f] = rec[f];
    return { [uf.join('_')]: val };
  }
  const uq = (m.fields as any[]).find(f => f.isUnique);
  if (uq) return { [uq.name]: rec[uq.name] };
  return null;
}

// 안정적 페이지네이션용 정렬 필드
function orderField(m: DModel): string {
  const idField = (m.fields as any[]).find(f => f.isId);
  if (idField) return idField.name;
  const uq = (m.fields as any[]).find(f => f.isUnique);
  if (uq) return uq.name;
  const uniques = (m as any).uniqueFields as string[][] | undefined;
  if (uniques && uniques.length) return uniques[0][0];
  return (m.fields as any[]).find(f => f.kind === 'scalar')?.name ?? 'id';
}

function idLabel(m: DModel, rec: any): string {
  const idField = (m.fields as any[]).find(f => f.isId);
  if (idField) return String(rec[idField.name]);
  const w = uniqueWhere(m, rec);
  return w ? JSON.stringify(w) : '(unknown)';
}

async function main() {
  const t0 = Date.now();
  const order = orderByFk(MODELS);
  const byName = new Map(MODELS.map(m => [m.name, m]));

  console.log(`\n=== Neon → Supabase 이관 ${DRY_RUN ? '[DRY-RUN · 읽기만]' : '[실제 실행]'} ===`);
  console.log(`소스(Neon)     : ${hostOf(NEON_URL!)}`);
  console.log(`대상(Supabase) : ${hostOf(SUPA_URL!)}`);
  console.log(`\n이관 순서 (FK 의존성 정렬):`);
  order.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${n}`));

  // 테이블별 소스 건수
  console.log(`\n테이블별 Neon 건수:`);
  const counts: Record<string, number> = {};
  let grand = 0;
  for (const name of order) {
    try {
      const c = await (neon as any)[delegate(name)].count();
      counts[name] = c; grand += c;
      console.log(`  ${name.padEnd(20)} ${c.toLocaleString()}`);
    } catch (e: any) {
      counts[name] = -1;
      console.log(`  ${name.padEnd(20)} (읽기 실패: ${e.message})`);
    }
  }
  console.log(`  ${''.padEnd(20)} ─────`);
  console.log(`  ${'합계'.padEnd(20)} ${grand.toLocaleString()} 건 · ${order.length}개 테이블`);

  if (DRY_RUN) {
    console.log(`\n✅ DRY-RUN 종료 — 실제 쓰기는 하지 않았습니다.`);
    console.log(`   실제 이관: npx tsx scripts/migrate-neon-to-supabase.ts`);
    return;
  }

  // ─── 실제 이관 ──────────────────────────────────────────────────────────────
  const summary: { table: string; migrated: number; errors: number; skipped?: boolean }[] = [];
  for (const name of order) {
    const m = byName.get(name)!;
    const total = counts[name] ?? 0;
    const del = delegate(name);
    const ordf = orderField(m);

    // upsert 키 확인
    if (!uniqueWhere(m, {})) {
      console.log(`\n[SKIP] ${name}: upsert할 unique key를 찾지 못해 건너뜀`);
      summary.push({ table: name, migrated: 0, errors: 0, skipped: true });
      continue;
    }
    if (total <= 0) { summary.push({ table: name, migrated: 0, errors: 0 }); continue; }

    let migrated = 0, errors = 0;
    for (let offset = 0; offset < total; offset += BATCH) {
      let rows: any[];
      try {
        rows = await (neon as any)[del].findMany({ skip: offset, take: BATCH, orderBy: { [ordf]: 'asc' } });
      } catch (e: any) {
        console.error(`\n[ERROR] ${name} 배치 읽기 실패 (offset ${offset}): ${e.message}`);
        errors += Math.min(BATCH, total - offset);
        continue;
      }
      for (const rec of rows) {
        try {
          await (supa as any)[del].upsert({ where: uniqueWhere(m, rec)!, create: rec, update: rec });
          migrated++;
        } catch (e: any) {
          errors++;
          console.error(`\n[ERROR] ${name} id=${idLabel(m, rec)}: ${e.message}`);
        }
      }
      const doneN = Math.min(offset + rows.length, total);
      const pct = total ? Math.round((doneN / total) * 100) : 100;
      process.stdout.write(`\r${name}: ${doneN}/${total} (${pct}%)   `);
    }
    process.stdout.write(`\n`);
    summary.push({ table: name, migrated, errors });
  }

  console.log(`\n=== 이관 요약 ===`);
  let tm = 0, te = 0;
  for (const s of summary) {
    tm += s.migrated; te += s.errors;
    const tag = s.skipped ? '(skip)' : `${s.migrated} 이관, 오류 ${s.errors}`;
    console.log(`  ${s.table.padEnd(20)} ${tag}`);
  }
  console.log(`  ${'합계'.padEnd(20)} ${tm} 이관, 오류 ${te}`);
  const secs = Math.round((Date.now() - t0) / 1000);
  const mm = Math.floor(secs / 60), ss = secs % 60;
  console.log(`\n총 소요 시간: ${mm}분 ${ss}초 (${secs}s)`);
  console.log(te === 0 ? `✅ 오류 없이 완료` : `⚠ 오류 ${te}건 — 위 로그 확인`);
}

main()
  .catch(e => { console.error('치명적 오류:', e); process.exitCode = 1; })
  .finally(async () => { await neon.$disconnect(); await supa.$disconnect(); });
