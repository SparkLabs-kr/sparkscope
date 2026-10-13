/**
 * 구독자 명단 + 부서 시드 (시트 CSV 기준).
 *
 * 시트 '스파크랩_임직원'을 CSV로 내려받아 실행한다. 열은 이름·이메일·소속·부서·직급을 쓴다(열 위치는 헤더로 찾는다).
 *
 *   npx tsx --env-file=.env.local scripts/seed-subscriber-departments.ts 임직원.csv --dry
 *   npx tsx --env-file=.env.local scripts/seed-subscriber-departments.ts 임직원.csv
 *
 * - 없는 사람은 새로 만든다(전 섹션 수신, 활성).
 * - 있는 사람은 부서·이름만 갱신한다. 수신 설정(섹션·수신 거부)과 토큰은 건드리지 않는다.
 * - 부서 값은 본부 집계 매핑(src/app/api/briefing/stats/route.ts)과 같은 이름으로 저장한다.
 *   시트의 '이노베이션본부'는 '이노베이션팀'으로 바꿔 저장한다.
 */
import './_env';
import { readFileSync } from 'fs';
import { prisma } from '../src/lib/prisma';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// 시트 부서 값 → 저장할 부서 값 (본부 매핑 키와 맞춘다)
const DEPT_RENAME: Record<string, string> = {
  이노베이션본부: '이노베이션팀',
};

type Row = { email: string; name: string | null; department: string | null };

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const idx = (names: string[]) => header.findIndex(h => names.includes(h));
  const iEmail = idx(['이메일', 'email', 'Email', 'EMAIL']);
  const iName = idx(['이름', 'name', 'Name']);
  const iDept = idx(['부서', '부서명', 'department']);
  if (iEmail < 0) throw new Error('CSV 헤더에 "이메일" 열이 없습니다.');

  const seen = new Map<string, Row>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const m = (cells[iEmail] ?? '').match(EMAIL_RE);
    if (!m) continue;
    const email = m[0].toLowerCase();
    const rawDept = iDept >= 0 ? cells[iDept] ?? '' : '';
    seen.set(email, {
      email,
      name: iName >= 0 ? (cells[iName] || null) : null,
      department: rawDept ? (DEPT_RENAME[rawDept] ?? rawDept) : null,
    });
  }
  return [...seen.values()];
}

async function main() {
  const file = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (!file) {
    console.error('사용법: npx tsx --env-file=.env.local scripts/seed-subscriber-departments.ts <CSV파일> [--dry]');
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(file, 'utf8'));
  const existing = new Map(
    (await prisma.digestSubscriber.findMany({
      where: { email: { in: rows.map(r => r.email) } },
      select: { email: true },
    })).map(s => [s.email, true]),
  );
  const toCreate = rows.filter(r => !existing.has(r.email));
  const toUpdate = rows.filter(r => existing.has(r.email));

  const deptCount = new Map<string, number>();
  for (const r of rows) {
    const k = r.department ?? '(부서 없음)';
    deptCount.set(k, (deptCount.get(k) ?? 0) + 1);
  }
  console.log(`[seed] CSV ${rows.length}명 · 새로 만들 ${toCreate.length}명 · 부서만 갱신 ${toUpdate.length}명`);
  console.log('[seed] 부서별 인원:');
  for (const [k, v] of [...deptCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  if (dry) {
    console.log('[seed] dry-run — 아무것도 저장하지 않았습니다.');
    return;
  }

  for (const r of toCreate) {
    await prisma.digestSubscriber.create({ data: { email: r.email, name: r.name, department: r.department } });
  }
  for (const r of toUpdate) {
    await prisma.digestSubscriber.update({
      where: { email: r.email },
      data: { department: r.department, ...(r.name ? { name: r.name } : {}) },
    });
  }

  const total = await prisma.digestSubscriber.count({ where: { active: true } });
  console.log(`[seed] 완료 — 활성 구독자 ${total}명`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
