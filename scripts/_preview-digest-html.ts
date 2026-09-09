/**
 * 오늘 기준 다이제스트 메일 HTML을 파일로 뽑는다 — 발송은 하지 않는다.
 * DB에 이미 있는 것만 읽고 LLM 호출도 없다(수집·요약 크론을 돌리지 않음).
 * 임시 스크래치 파일(커밋 대상 아님).
 */
import './_env';
import { writeFileSync } from 'fs';
import { loadDigestCandidates, buildReviewDigest } from '../src/lib/sparkscope/review';
import { renderDigestHtml } from '../src/lib/sparkscope/digest';
import { attachInterDigest } from '../src/lib/sparkscope/inter-digest';
import { attachAiSignals } from '../src/lib/sparkscope/signal-digest';
import { buildSubject } from '../src/lib/sparkscope/mailer';

async function main() {
  const out = process.argv[2] ?? '/tmp/digest-today.html';
  const candidates = await loadDigestCandidates();
  // 발송 경로(runner.ts)와 같은 순서로 붙인다 — 그래야 초안이 실제 메일과 같다.
  const data = await attachAiSignals(await attachInterDigest(buildReviewDigest(candidates)));
  const html = renderDigestHtml(data, 'https://sparkscope.vercel.app');

  console.log('제목:', buildSubject(data.dateLabel, data.top3[0]?.title));
  console.log('TOP3:', data.top3.length, '· 포트폴리오:', data.portfolioArticles.length);
  if (data.inter) {
    console.log(`Inter: 해외 ${data.inter.total}건 (직전 ${data.inter.prevTotal}, ${data.inter.deltaPct}%)`);
    console.log(`       급증 있음: ${data.inter.hasSurge} · 연결 회사 ${data.inter.companyNames.length}개사 (${data.inter.companyNames.join(', ')})`);
    data.inter.cards.forEach((c, i) =>
      console.log(`       [${i + 1}] ${c.cellLabel} / ${c.badgeLabel} / ${c.media} — ${c.title.slice(0, 46)}`));
  } else {
    console.log('Inter: 블록 없음(null) — 해외 섹션 미표시');
  }
  if (data.aiSignals) {
    console.log(`\nAI 트렌드 TOP ${data.aiSignals.items.length} (${data.aiSignals.generatedAt.slice(0, 16)})`);
    data.aiSignals.items.forEach(i =>
      console.log(`  ${i.rank}. [${i.kind === 'news' ? '뉴스' : i.sourceId}] ${i.source} — ${(i.titleKo || i.title).slice(0, 52)}`));
  } else {
    console.log('\nAI 트렌드: 없음');
  }
  writeFileSync(out, html);
  console.log('\n저장:', out, `(${(html.length / 1024).toFixed(1)}KB)`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
