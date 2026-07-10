const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.+)$/);
  if (!match) continue;
  const key = match[1].trim();
  let val = match[2].trim();
  if (val.startsWith('"')) val = val.slice(1, -1);
  if (key.startsWith('POSTGRES') || key.startsWith('DATABASE')) {
    process.env[key] = val;
  }
}

(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  console.log('\n[sparklabs_self → industry_trend 재분류]\n');

  // 모든 sparklabs_self 기사 조회
  const allSparklabsSelf = await prisma.article.findMany({
    where: { category: 'sparklabs_self' },
    select: { id: true, title: true },
  });

  console.log(`전체 sparklabs_self: ${allSparklabsSelf.length}건\n`);

  let misclassified = [];
  let correctly = [];

  for (const a of allSparklabsSelf) {
    const hasSparkLabs = a.title.includes('스파크랩') || a.title.includes('SparkLabs');
    
    if (hasSparkLabs) {
      correctly.push(a);
    } else {
      misclassified.push(a);
    }
  }

  console.log(`✅ 정확한 분류: ${correctly.length}건`);
  console.log(`❌ 오분류: ${misclassified.length}건\n`);

  // 오분류 기사를 industry_trend로 변경
  if (misclassified.length > 0) {
    console.log('오분류 기사 샘플 (처음 5개):');
    for (let i = 0; i < Math.min(5, misclassified.length); i++) {
      console.log(`  - ${misclassified[i].title.substring(0, 60)}`);
    }
    console.log(`  ... 외 ${Math.max(0, misclassified.length - 5)}건\n`);

    // DB 업데이트
    for (const a of misclassified) {
      await prisma.article.update({
        where: { id: a.id },
        data: { category: 'industry_trend' },
      });
    }
    console.log(`✅ ${misclassified.length}건 industry_trend로 이동 완료\n`);
  }

  // [2] 모니터링 타겟 수정: "데모데이" 제거
  console.log('[모니터링 타겟 수정]\n');
  const sparkLabsTarget = await prisma.monitoringTarget.findFirst({
    where: { name: '스파크랩' },
  });

  const oldHelpers = sparkLabsTarget.helperKeywords.split(',').map(k => k.trim());
  console.log(`이전 보조 키워드: ${oldHelpers.join(', ')}`);

  const newHelpers = oldHelpers.filter(k => k !== '데모데이');
  console.log(`수정된 보조 키워드: ${newHelpers.join(', ')}\n`);

  await prisma.monitoringTarget.update({
    where: { id: sparkLabsTarget.id },
    data: {
      helperKeywords: newHelpers.join(','),
      excludeWords: sparkLabsTarget.excludeWords + ',데모데이,IR,투자유치,브릿지',
    },
  });

  console.log('✅ 모니터링 타겟 업데이트 완료\n');
  console.log('[정리]\n');
  console.log(`오분류 건수: ${misclassified.length}건`);
  console.log(`제외 키워드 추가: 데모데이, IR, 투자유치, 브릿지\n`);

  await prisma.$disconnect();
})();
