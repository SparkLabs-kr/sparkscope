import { prisma } from '../src/lib/prisma';
(async()=>{
  const g=await prisma.socialSignal.groupBy({by:['source'],_count:{_all:true}});
  const nullKo=await prisma.socialSignal.groupBy({by:['source'],where:{titleKo:null},_count:{_all:true}});
  const m=new Map(nullKo.map(r=>[r.source,r._count._all]));
  console.log('source / 전체 / titleKo 없음');
  g.forEach(r=>console.log(`  ${r.source.padEnd(10)} ${String(r._count._all).padStart(4)} ${String(m.get(r.source)??0).padStart(5)}`));
  await prisma.$disconnect();
})();
