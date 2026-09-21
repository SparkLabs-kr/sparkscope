/**
 * 발송될 다이제스트 메일을 미리 본다 — 실제 발송과 같은 경로로 만든다.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/preview-digest.ts            # 지금 만들면 나올 메일
 *   npx tsx --env-file=.env.local scripts/preview-digest.ts --sent     # 마지막으로 나간 메일(DB 보관본)
 *   ... --out /tmp/mail.html                                           # 저장 위치 지정
 *
 * 왜 runner의 함수를 그대로 부르나: 예전 미리보기는 검수 콘솔 경로
 * (loadDigestCandidates + buildReviewDigest)로 만들어져서 발송 가드 재검증·TOP3 AI
 * 검증·링크 해석이 빠져 있었고, 그래서 실제 메일과 머리기사가 달랐다(2026-09-21).
 * 재료(loadSendArticles)와 조립(buildDigestForSend)을 발송과 공유해야 다시 안 갈린다.
 *
 * ⚠ TOP 3는 실행마다 달라질 수 있다. pickVerifiedTop3가 LLM 호출이고 temperature를
 * 지정하지 않아서다(기본값 1). 같은 재료로 두 번 돌려도 2·3위가 바뀐 것을 실측했다.
 * 그래서 "정확히 무엇이 나갔는가"를 봐야 하면 --sent 로 보관본을 읽는다.
 *
 * DB에 쓰지 않는다 — 발송 경로의 Digest 저장·파트너 피드 발행은 부르지 않는다.
 */
import './_env';
import { writeFileSync } from 'fs';
import { prisma } from '../src/lib/prisma';
import { loadSendArticles, buildDigestForSend } from '../src/lib/sparkscope/runner';
import { renderDigestHtml } from '../src/lib/sparkscope/digest';
import { buildSubject } from '../src/lib/sparkscope/mailer';
import type { AnalyzedArticle } from '../src/lib/sparkscope/types';

const BASE = process.env.NEXTAUTH_URL ?? 'https://sparkscope.vercel.app';

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function showSent(out: string) {
  const d = await prisma.digest.findFirst({
    where: { sentAt: { not: null } },
    orderBy: { date: 'desc' },
    select: { date: true, subject: true, sentAt: true, recipients: true, errorMsg: true, htmlBody: true },
  });
  if (!d) { console.log('발송 기록이 없습니다.'); return; }
  writeFileSync(out, d.htmlBody ?? '');
  console.log(`마지막 발송본 — ${d.date.toISOString().slice(0, 10)}`);
  console.log(`  제목   ${d.subject}`);
  console.log(`  발송   ${d.sentAt?.toISOString()} · 수신 ${d.recipients ?? '-'} · 오류 ${d.errorMsg ?? '없음'}`);
  console.log(`  저장   ${out} (${((d.htmlBody?.length ?? 0) / 1024).toFixed(1)}KB)`);
  console.log('\n  ⚠ 보관본은 전사 그룹용(토큰 없음) 렌더다. 구독자별로 나간 메일은');
  console.log('    링크에 각자 토큰이 박혀 있어 이 본문과 그 부분만 다르다.');
}

async function buildNow(out: string) {
  const raw = await loadSendArticles();
  // 발송 경로(runner.ts 3단계)가 skipCollect에서 하는 것과 같은 변환이다.
  const analyzed: AnalyzedArticle[] = (raw as any[]).map(a => ({
    ...a,
    relatedCompanies: typeof a.relatedCompanies === 'string'
      ? JSON.parse(a.relatedCompanies) : (a.relatedCompanies ?? []),
  }));

  const data = await buildDigestForSend(analyzed);
  const html = renderDigestHtml(data, BASE);
  writeFileSync(out, html);

  console.log(`재료 ${analyzed.length}건 → 메일 ${(html.length / 1024).toFixed(1)}KB`);
  console.log(`제목: ${buildSubject(data.dateLabel, data.top3[0]?.title)}`);
  console.log(`\nTOP 3 (실행마다 달라질 수 있음)`);
  data.top3.forEach((t, i) => console.log(`  ${i + 1}. ${t.title.slice(0, 64)}`));
  console.log(`\n섹션  스파크랩 ${data.sparklabsArticles.length} · 포폴 ${data.portfolioArticles.length}`
    + ` · 경쟁사 ${data.competitorArticles.length} · 업계 ${data.industryArticles.length}`
    + ` · 해외 ${data.inter ? 'O' : 'X'} · AI ${data.aiSignals ? 'O' : 'X'} · 바이오 ${data.bioSignals ? 'O' : 'X'}`);
  console.log(`구독 설정 섹션: ${html.includes('구독 설정') ? '있음' : '없음'}`);
  console.log(`저장: ${out}`);
}

(async () => {
  const out = argOf('--out') ?? '/tmp/digest-preview.html';
  if (process.argv.includes('--sent')) await showSent(out);
  else await buildNow(out);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
