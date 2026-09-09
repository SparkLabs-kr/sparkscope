import { prisma } from '../src/lib/prisma';
(async()=>{
  const g=await prisma.socialSignal.groupBy({by:['domain','source'],_count:true, _max:{lastSeenAt:true}});
  console.log('domain / source / 행수 / 최근 갱신');
  g.sort((a,b)=>`${a.domain}${a.source}`.localeCompare(`${b.domain}${b.source}`))
   .forEach(r=>console.log(`  ${r.domain}/${r.source.padEnd(10)} ${String(r._count).padStart(4)}  ${r._max.lastSeenAt?.toISOString().slice(0,16)}`));
  const r=await prisma.socialSignal.findMany({where:{domain:'ai',source:'reddit'},orderBy:{points:'desc'},take:5,
    select:{title:true,origin:true,points:true,publishedAt:true}});
  console.log(`\nAI Reddit 저장분 ${r.length}건:`);
  r.forEach(x=>console.log(`  ▲${x.points} [${x.origin}] ${x.title.slice(0,60)}`));
  await prisma.$disconnect();
})();
