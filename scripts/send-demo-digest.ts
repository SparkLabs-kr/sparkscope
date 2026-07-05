/**
 * 시연용 다이제스트 1통 발송 — 재수집 없이 최근 DB 후보로 구성해 실제 발송.
 *   npx tsx scripts/send-demo-digest.ts <수신이메일>
 * 발신 도메인 미인증 시 DIGEST_FROM_EMAIL 환경변수로 발신주소 오버라이드 가능.
 * (tsx는 .env.local 자동 로드 안 함 — 실행 전 env 주입 필요)
 */
import { prisma } from '../src/lib/prisma';
import { loadDigestCandidates, buildReviewDigest } from '../src/lib/sparkscope/review';
import { generateEditorIntro } from '../src/lib/sparkscope/analyzer';
import { renderDigestHtml } from '../src/lib/sparkscope/digest';
import { sendDigestEmail, buildSubject } from '../src/lib/sparkscope/mailer';

async function countCat(cat: string, fromDays: number, toDays: number): Promise<number> {
  const from = new Date(); from.setDate(from.getDate() - fromDays);
  const to = new Date(); to.setDate(to.getDate() - toDays);
  return prisma.article.count({ where: { category: cat, isNoise: false, pubDate: { gte: from, lt: to } } });
}
function trendStr(now: number, prev: number): string | undefined {
  if (prev <= 0) return now > 0 ? '↑ 신규 노출' : undefined;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return '– 전주와 비슷';
  return pct > 0 ? `↑ 전주 대비 +${pct}%` : `↓ 전주 대비 ${pct}%`;
}

(async () => {
  const to = process.argv[2] || process.env.DIGEST_TEST_RECIPIENT;
  if (!to) { console.error('수신 이메일을 인자로 주세요.'); process.exit(1); }

  const candidates = await loadDigestCandidates();
  const data = buildReviewDigest(candidates, {});

  // 편집자 한 줄 (AI 우선, 키 없으면 fallback)
  data.editorIntro = await generateEditorIntro(data.top3);

  // KPI 전주 대비 트렌드
  const [pNow, pPrev, iNow, iPrev] = await Promise.all([
    countCat('portfolio_company', 7, 0), countCat('portfolio_company', 14, 7),
    countCat('industry_trend', 7, 0), countCat('industry_trend', 14, 7),
  ]);
  data.stats.portfolioTrend = trendStr(pNow, pPrev);
  data.stats.industryTrend = trendStr(iNow, iPrev);

  // 지난 주 흐름 (월요일 발송분 섹션 — 시연을 위해 항상 생성)
  const topCos = data.portfolioArticles.slice(0, 3).map(a => a.matchedKeyword);
  data.weeklyFlow = topCos.length
    ? `지난 주 포트폴리오 중에서는 <strong>${topCos.join('·')}</strong>의 보도가 두드러졌습니다. 이번 주는 후속 보도와 신규 라운드 발표가 이어질 것으로 예상됩니다.`
    : '지난 주는 포트폴리오 관련 보도가 비교적 조용했습니다. 이번 주 업계 동향을 함께 살펴보세요.';

  const baseUrl = process.env.DIGEST_BASE_URL ?? 'https://sparkscope.vercel.app';
  const html = renderDigestHtml(data, baseUrl);
  const subject = buildSubject(data.dateLabel, data.top3[0]?.title);

  // 미리보기 모드: 발송 없이 HTML 파일만 저장
  if (process.env.DIGEST_PREVIEW_FILE) {
    const fs = await import('fs');
    fs.writeFileSync(process.env.DIGEST_PREVIEW_FILE, html, 'utf8');
    console.log(`[send-demo] 미리보기 저장: ${process.env.DIGEST_PREVIEW_FILE} (${html.length} bytes)`);
    console.log(`[send-demo] 제목: ${subject}`);
    console.log(`[send-demo] TOP3: ${data.top3.map(a => a.title.slice(0, 35)).join(' / ')}`);
    process.exit(0);
  }

  console.log(`[send-demo] 후보 ${candidates.length}건 · 수신 ${to} · 발신 ${process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr'}`);
  console.log(`[send-demo] 제목: ${subject}`);
  console.log(`[send-demo] TOP3: ${data.top3.map(a => a.title.slice(0, 30)).join(' / ')}`);
  try {
    const res = await sendDigestEmail({ subject, html, to });
    console.log('[send-demo] ✅ 발송 성공:', JSON.stringify(res));
  } catch (e: any) {
    console.error('[send-demo] ❌ 발송 실패:', String(e?.message ?? e));
    process.exit(1);
  }
  process.exit(0);
})();
