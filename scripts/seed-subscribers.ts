/**
 * 다이제스트 구독자 명단 시드.
 *
 * 구글 관리콘솔에서 all@sparklabs.co.kr 그룹 멤버를 내보낸 뒤 이 스크립트로 넣는다.
 * 전원 "전 섹션 수신"으로 들어가므로 시드 직후 받는 메일은 지금 나가는 것과 내용이 같다.
 *
 *   npx tsx --env-file=.env.local scripts/seed-subscribers.ts members.csv --dry
 *   npx tsx --env-file=.env.local scripts/seed-subscribers.ts members.csv
 *
 * 입력은 한 줄에 이메일 하나이거나, 이메일이 들어 있는 CSV면 된다(열 위치는 자동으로 찾는다).
 * 헤더 줄·빈 줄·중복은 알아서 걸러낸다.
 *
 * 이미 있는 사람은 건드리지 않는다 — 다시 돌려도 남이 바꿔 둔 구독 설정이나 수신 거부가
 * 초기화되지 않는다. 그래서 명단을 갱신할 때마다 안심하고 다시 실행할 수 있다.
 */
import './_env';
import { readFileSync } from 'fs';
import { prisma } from '../src/lib/prisma';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function extractEmails(text: string): string[] {
  const found = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    // CSV든 한 줄 하나든, 그 줄에서 이메일처럼 생긴 것 하나만 집는다.
    const m = line.match(EMAIL_RE);
    if (m) found.add(m[0].trim().toLowerCase());
  }
  return [...found];
}

async function main() {
  const file = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (!file) {
    console.error('사용법: npx tsx --env-file=.env.local scripts/seed-subscribers.ts <명단파일> [--dry]');
    process.exit(1);
  }

  const emails = extractEmails(readFileSync(file, 'utf8'));
  if (emails.length === 0) {
    console.error(`[seed] ${file} 에서 이메일을 하나도 찾지 못했습니다.`);
    process.exit(1);
  }

  const existing = new Set(
    (await prisma.digestSubscriber.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    })).map(s => s.email),
  );
  const toAdd = emails.filter(e => !existing.has(e));

  console.log(`[seed] 파일에서 ${emails.length}명 · 이미 등록됨 ${existing.size}명 · 새로 넣을 ${toAdd.length}명`);
  if (toAdd.length > 0) {
    console.log('  ' + toAdd.slice(0, 10).join(', ') + (toAdd.length > 10 ? ` 외 ${toAdd.length - 10}명` : ''));
  }

  if (dry) {
    console.log('[seed] dry-run — 아무것도 저장하지 않았습니다.');
    return;
  }

  if (toAdd.length > 0) {
    // skipDuplicates: 동시에 두 번 돌아도 안전하게.
    const { count } = await prisma.digestSubscriber.createMany({
      data: toAdd.map(email => ({ email })),
      skipDuplicates: true,
    });
    console.log(`[seed] ${count}명 추가 완료`);
  }

  const total = await prisma.digestSubscriber.count({ where: { active: true } });
  console.log(`[seed] 현재 활성 구독자 ${total}명`);
  console.log('[seed] 이제 발송 크론이 그룹 대신 이 명단으로 보냅니다. DIGEST_TO_GROUP은 폴백으로만 쓰입니다.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
