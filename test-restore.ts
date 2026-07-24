import { prisma } from '@/lib/prisma';

async function main() {
  const articles = await prisma.article.findMany({
    where: {
      matchedKeyword: {
        contains: "글로벌모기지"
      }
    },
    select: {
      title: true,
      source: true,
      pubDate: true,
      matchedKeyword: true,
      category: true,
    },
    take: 5,
  });

  console.log(`글로벌모기지그룹 관련 기사: ${articles.length}개`);
  articles.forEach((a, i) => {
    console.log(`\n[${i+1}] ${a.title}`);
    console.log(`    출처: ${a.source} | 발행: ${a.pubDate.toISOString().split('T')[0]}`);
  });

  await prisma.$disconnect();
}

main();
