/**
 * 손으로 쓴 마이그레이션 SQL을 프로덕션에 적용한다.
 *
 * 왜 prisma migrate/db push가 아닌가:
 *   프로덕션에 schema.prisma가 모르는 컬럼·테이블이 남아 있다(drift). db push는 그것들을
 *   DROP 하려 들고, migrate는 drift를 이유로 리셋을 요구한다. 그래서 이 저장소는
 *   ALTER TABLE ... ADD COLUMN IF NOT EXISTS 형태의 SQL을 직접 실행한다(CLAUDE.md 규칙).
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/apply-migration.ts prisma/migrations/<dir>/migration.sql
 *   npx tsx --env-file=.env.local scripts/apply-migration.ts <경로> --dry
 */
import * as fs from 'fs';
import { prisma } from '../src/lib/prisma';

/** SQL을 문장 단위로 쪼갠다. 줄 주석(--)은 버리고 세미콜론으로 나눈다. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

async function main() {
  const path = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (!path) {
    console.error('사용법: apply-migration.ts <migration.sql 경로> [--dry]');
    process.exit(1);
  }
  const statements = splitStatements(fs.readFileSync(path, 'utf8'));
  console.log(`[apply-migration] ${path} — 문장 ${statements.length}개${dry ? ' (dry-run)' : ''}`);

  let ok = 0;
  for (const [i, st] of statements.entries()) {
    const label = st.replace(/\s+/g, ' ').slice(0, 88);
    if (dry) { console.log(`  ${i + 1}. [skip] ${label}`); continue; }
    try {
      await prisma.$executeRawUnsafe(st);
      console.log(`  ${i + 1}. ✅ ${label}`);
      ok++;
    } catch (e: any) {
      console.error(`  ${i + 1}. ❌ ${label}\n      ${e?.message ?? e}`);
      throw e;
    }
  }
  if (!dry) console.log(`[apply-migration] 완료 — ${ok}/${statements.length}`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
