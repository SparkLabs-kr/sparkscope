/**
 * 구독 조합별로 메일에 어떤 섹션이 실제로 들어가는지 확인한다(발송은 하지 않는다).
 * 임시 스크래치 파일(커밋 대상 아님).
 */
import './_env';
import { loadDigestCandidates, buildReviewDigest } from '../src/lib/sparkscope/review';
import { renderDigestHtml } from '../src/lib/sparkscope/digest';
import { attachInterDigest } from '../src/lib/sparkscope/inter-digest';
import { attachAiSignals } from '../src/lib/sparkscope/signal-digest';
import { applySubscription, ALL_SECTIONS, type SectionPrefs } from '../src/lib/sparkscope/subscription';

const MARKERS: [string, string][] = [
  ['오늘의 핵심', 'TOP3'],
  ['스파크랩 직접 언급', '스파크랩'],
  ['포트폴리오 하이라이트', '포트폴리오'],
  ['해외 주요 트렌드 Topic', '해외띠'],
  ['글로벌 트렌드 × 스파크랩', '해외카드'],
  ['이번 주 AI 트렌드', 'AI트렌드'],
  ['이번 주 바이오 트렌드', '바이오트렌드'],
  ['AC·VC 업계 동향', 'AC·VC'],
  ['스타트업계 뉴스', '업계뉴스'],
  ['구독 설정 바꾸기', '설정링크'],
];

function sectionsIn(html: string): string[] {
  const body = html.split('</style>')[1] ?? html;
  return MARKERS.filter(([m]) => body.includes(m)).map(([, label]) => label);
}

const CASES: { name: string; prefs: SectionPrefs }[] = [
  { name: '전체 구독(기본)', prefs: { ...ALL_SECTIONS } },
  { name: '포트폴리오만', prefs: { ...ALL_SECTIONS, sparklabs: false, inter: false, aiSignals: false, competitor: false, industry: false } },
  { name: '해외 트렌드 + AI만(바이오 끔)', prefs: { ...ALL_SECTIONS, sparklabs: false, portfolio: false, bioSignals: false, competitor: false, industry: false } },
  { name: '바이오만', prefs: { ...ALL_SECTIONS, sparklabs: false, portfolio: false, inter: false, aiSignals: false, competitor: false, industry: false } },
  { name: '스파크랩 + 포트폴리오만', prefs: { ...ALL_SECTIONS, inter: false, aiSignals: false, competitor: false, industry: false } },
  { name: '전부 해제', prefs: Object.fromEntries(Object.keys(ALL_SECTIONS).map(k => [k, false])) as SectionPrefs },
];

async function main() {
  const candidates = await loadDigestCandidates();
  const data = await attachAiSignals(await attachInterDigest(buildReviewDigest(candidates)));

  console.log('구독 조합별 메일 구성\n' + '='.repeat(86));
  for (const c of CASES) {
    const scoped = applySubscription(data, c.prefs);
    const html = renderDigestHtml(scoped, 'https://sparkscope.vercel.app', {
      prefs: c.prefs,
      subscriberToken: 'TESTTOKEN',
    });
    const secs = sectionsIn(html);
    console.log(`\n■ ${c.name}  (${(html.length / 1024).toFixed(1)}KB)`);
    console.log(`   TOP3 ${scoped.top3.length}건 — ${scoped.top3.map(t => t.category).join(', ') || '없음'}`);
    console.log(`   섹션: ${secs.join(' · ') || '(본문 없음)'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
