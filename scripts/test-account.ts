/**
 * 시험용 계정을 만들고 지운다 — 실제 계정을 건드릴 수 없게 만든 도구.
 *
 * 왜 이 스크립트가 있는가:
 *   2026-09-08, 승인 권한을 시험하다가 marketing@sparklabs.co.kr 를 upsert 로
 *   덮어쓰고 정리 단계에서 지웠다. 실재하는 계정이었다. 세션이 날아가 다시
 *   로그인해야 했다. 사람이 조심하는 것으로는 막히지 않는 종류의 실수라서,
 *   도구가 거부하게 만든다.
 *
 * 규칙: 예약 도메인(.example / .invalid / .test)이 아닌 주소는 만들지도, 지우지도
 * 않는다. RFC 2606·6761 이 영구 예약한 도메인이라 실재할 수 없다.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/test-account.ts create <메일> [--company=<회사명>] [--admin]
 *   npx tsx --env-file=.env.local scripts/test-account.ts link   <메일>     # 로그인 링크 발급(메일 안 보냄)
 *   npx tsx --env-file=.env.local scripts/test-account.ts list
 *   npx tsx --env-file=.env.local scripts/test-account.ts remove <메일>
 *   npx tsx --env-file=.env.local scripts/test-account.ts remove --all      # 시험 계정 전부
 */
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 실재할 수 없는 도메인. 여기 없는 주소는 이 스크립트가 손대지 않는다. */
const RESERVED = ['.example', '.invalid', '.test', '.localhost'];

function assertTestEmail(email: string): string {
  const addr = email.trim().toLowerCase();
  if (!addr.includes('@')) throw new Error(`메일 주소가 아니다: ${email}`);
  if (!RESERVED.some(suffix => addr.endsWith(suffix))) {
    throw new Error(
      `거부: ${addr} 는 예약 도메인이 아니다.\n` +
        `  시험 계정은 ${RESERVED.join(' / ')} 로 끝나야 한다 (예: founder@testco.example).\n` +
        `  실재하는 주소를 시험에 쓰면 정리 단계에서 진짜 계정을 지우게 된다.`,
    );
  }
  return addr;
}

async function create(email: string, companyName?: string, admin = false) {
  const addr = assertTestEmail(email);
  let companyId: string | null = null;
  let resolved: string | null = null;
  if (companyName) {
    const t = await prisma.monitoringTarget.findFirst({
      where: { name: companyName, category: { startsWith: 'portfolio_company' } },
      select: { id: true, name: true },
    });
    if (!t) throw new Error(`포트폴리오사를 찾을 수 없다: ${companyName}`);
    companyId = t.id;
    resolved = t.name;
  }
  const user = await prisma.user.upsert({
    where: { email: addr },
    update: { role: admin ? 'ADMIN' : 'PORTFOLIO', companyId, active: true },
    create: {
      email: addr,
      name: '시험계정',
      role: admin ? 'ADMIN' : 'PORTFOLIO',
      companyId,
      active: true,
      invitedBy: 'scripts/test-account.ts',
      invitedAt: new Date(),
    },
    select: { id: true, email: true, role: true, companyId: true },
  });
  console.log(`만들었다: ${user.email}  role=${user.role}  회사=${resolved ?? '없음'}`);
  return user;
}

/**
 * 로그인 링크를 직접 만든다 — 메일을 보내지 않는다.
 * NextAuth EmailProvider 와 같은 방식으로 토큰을 해시해서 넣는다.
 */
async function link(email: string) {
  const addr = assertTestEmail(email);
  const user = await prisma.user.findUnique({ where: { email: addr }, select: { id: true } });
  if (!user) throw new Error(`먼저 create 로 계정을 만들어라: ${addr}`);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET 이 없다');
  const raw = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(`${raw}${secret}`).digest('hex');
  await prisma.verificationToken.deleteMany({ where: { identifier: addr } });
  await prisma.verificationToken.create({
    data: { identifier: addr, token: hashed, expires: new Date(Date.now() + 60 * 60 * 1000) },
  });
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const url =
    `${base}/api/auth/callback/email?token=${raw}` +
    `&email=${encodeURIComponent(addr)}` +
    `&callbackUrl=${encodeURIComponent(`${base}/portfolio`)}`;
  console.log('\n로그인 링크 (1시간 유효, 한 번만 쓸 수 있다):\n');
  console.log(url);
  console.log('');
}

async function list() {
  const users = await prisma.user.findMany({
    select: { email: true, role: true, active: true, company: { select: { name: true } } },
    orderBy: { email: 'asc' },
  });
  const isTest = (e: string) => RESERVED.some(s => e.endsWith(s));
  console.log('시험 계정:');
  const tests = users.filter(u => isTest(u.email));
  if (tests.length === 0) console.log('  (없음)');
  for (const u of tests) {
    console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(10)} ${u.company?.name ?? '-'}`);
  }
  console.log(`\n실제 계정 ${users.length - tests.length}개는 이 스크립트가 건드리지 않는다.`);
}

async function remove(email?: string) {
  let targets: { id: string; email: string }[];
  if (email === '--all') {
    const all = await prisma.user.findMany({ select: { id: true, email: true } });
    targets = all.filter(u => RESERVED.some(s => u.email.endsWith(s)));
    if (targets.length === 0) { console.log('지울 시험 계정이 없다.'); return; }
  } else {
    const addr = assertTestEmail(email ?? '');
    const u = await prisma.user.findUnique({ where: { email: addr }, select: { id: true, email: true } });
    if (!u) { console.log(`없다: ${addr}`); return; }
    targets = [u];
  }
  for (const t of targets) {
    // 한 번 더 확인한다 — findMany 필터를 잘못 써서 실제 계정이 섞여 들어오는 경우를 막는다.
    assertTestEmail(t.email);
    const s = await prisma.session.deleteMany({ where: { userId: t.id } });
    await prisma.verificationToken.deleteMany({ where: { identifier: t.email } });
    await prisma.user.delete({ where: { id: t.id } });
    console.log(`지웠다: ${t.email} (세션 ${s.count}개)`);
  }
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const companyArg = rest.find(a => a.startsWith('--company='))?.split('=')[1];
  const admin = rest.includes('--admin');
  switch (cmd) {
    case 'create': await create(arg, companyArg, admin); break;
    case 'link':   await link(arg); break;
    case 'list':   await list(); break;
    case 'remove': await remove(arg); break;
    default:
      console.log('사용: create <메일> [--company=<회사명>] [--admin] | link <메일> | list | remove <메일>|--all');
      process.exitCode = 1;
  }
}

main()
  .catch(e => { console.error('\n' + String(e.message ?? e) + '\n'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
