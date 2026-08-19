// 챗봇 회귀 테스트
//
//   npm run test:chat          도구 계층만 (빠름·무료, LLM 안 씀)
//   npm run test:chat -- --e2e 에이전트 end-to-end까지 (느림·질문당 약 $0.003)
//
// 여기 있는 검사는 전부 "실제로 났던 버그"에서 나왔다. 하나하나가 사고 재발 방지용이다.
//
// ★ 고정된 숫자로 검사하지 않는다.
//   DB는 매일 수집으로 바뀌므로 "투자유치 1,249건"처럼 박아두면 내일 바로 깨진다.
//   대신 무엇이 바뀌어도 성립해야 하는 관계(불변식)를 검사한다.
//   예: "투자유치"로 찾은 건수는 제목만 정확히 일치시킨 건수보다 많아야 한다.
import { prisma } from '../src/lib/prisma';
import { spacingVariants, expandTerms } from '../src/lib/sparkscope/term-expand';
import { runChatQuery, dedupeArticles, resolvePeriod } from '../src/lib/sparkscope/chat-query';
import { runSemanticQuery } from '../src/lib/sparkscope/chat-semantic';
import { runInterQuery } from '../src/lib/sparkscope/chat-inter';
import { runCoverageGap, runPitchQuery } from '../src/lib/sparkscope/chat-ops';
import { proposeKeywordFix } from '../src/lib/sparkscope/chat-actions';

type Case = { name: string; why: string; run: () => Promise<string | null> };

const results: { name: string; why: string; ok: boolean; detail: string }[] = [];

async function check(c: Case) {
  try {
    const fail = await c.run();
    results.push({ name: c.name, why: c.why, ok: !fail, detail: fail ?? 'ok' });
  } catch (e: any) {
    results.push({ name: c.name, why: c.why, ok: false, detail: `예외: ${e?.message ?? e}` });
  }
}

// ─────────────────────────── 1) 검색어 표기 변형 ───────────────────────────

const TERM_CASES: Case[] = [
  {
    name: '띄어쓰기 변형 생성',
    why: '"투자유치"만 찾으면 "투자 유치" 기사를 통째로 놓친다(실측 244 vs 1,213건)',
    run: async () => {
      const v = spacingVariants('투자유치');
      if (!v.includes('투자 유치')) return `"투자 유치"가 변형에 없음: ${JSON.stringify(v)}`;
      const v2 = spacingVariants('투자 유치');
      if (!v2.includes('투자유치')) return `역방향 변형 없음: ${JSON.stringify(v2)}`;
      return null;
    },
  },
  {
    name: '한글+영숫자 경계 변형',
    why: '"시리즈A"와 "시리즈 A"는 같은 말인데 LIKE 검색은 다르게 본다',
    run: async () => {
      const v = spacingVariants('시리즈A');
      return v.includes('시리즈 A') ? null : `변형 없음: ${JSON.stringify(v)}`;
    },
  },
  {
    name: '짧은 검색어는 쪼개지 않음',
    why: '2~3자를 쪼개면 조각이 너무 짧아 엉뚱한 기사가 잡힌다',
    run: async () => {
      const v = spacingVariants('노리');
      return v.length === 1 && v[0] === '노리' ? null : `쪼개짐: ${JSON.stringify(v)}`;
    },
  },
  {
    name: '변형 개수 상한',
    why: 'OR 조건이 무한정 늘어나면 조회가 느려진다',
    run: async () => {
      const v = expandTerms(['투자유치', '시리즈A', '프리A', '정부지원사업', '스타트업', '벤처캐피탈']);
      return v.length <= 40 ? null : `변형 ${v.length}개로 상한 초과`;
    },
  },
];

// ─────────────────────────── 2) 검색 동작 ───────────────────────────

const SEARCH_CASES: Case[] = [
  {
    name: '표기 변형이 실제 검색 결과를 늘린다',
    why: '변형 확장이 코드에는 있는데 조회에 안 걸리면 의미가 없다',
    run: async () => {
      const r = await runChatQuery({ question: 'x', period: 'quarter', scopes: [], terms: ['투자유치'] });
      const strict = await prisma.article.count({
        where: {
          isNoise: false,
          pubDate: resolvePeriod('quarter')!,
          title: { contains: '투자유치', mode: 'insensitive' },
        },
      });
      if (r.total <= strict) return `변형 확장 결과(${r.total})가 제목 단독 매칭(${strict})보다 많지 않음`;
      return null;
    },
  },
  {
    name: '부정 톤 필터 단독 사용',
    why: 'only_negative에 주제어를 AND로 얹어 0건을 만들던 사고 — 톤만으로도 잡혀야 한다',
    run: async () => {
      const r = await runChatQuery({
        question: 'x', period: 'quarter', scopes: ['portfolio'], terms: [], onlyNegative: true,
      });
      if (r.total === 0) return '포폴사 부정 기사가 0건 — 필터가 과하게 걸렸을 수 있음';
      const bad = r.articles.filter((a) => a.tone !== 'NEGATIVE' && !a.riskFlag);
      return bad.length ? `부정/위험이 아닌 기사가 섞임: ${bad[0].title.slice(0, 30)}` : null;
    },
  },
  {
    name: '검색 범위(scope)가 실제로 걸린다',
    why: "'해외 트렌드' 칩이 엉뚱한 카테고리를 조회하던 사고",
    run: async () => {
      const r = await runChatQuery({ question: 'x', period: 'quarter', scopes: ['portfolio'], terms: [] });
      const wrong = r.byCategory.filter((c) => c.category !== 'portfolio_company');
      return wrong.length ? `포폴사만 요청했는데 다른 분류 포함: ${JSON.stringify(wrong)}` : null;
    },
  },
  {
    name: '중복 기사 접기',
    why: '통신사 기사를 여러 매체가 받아써서 같은 소식이 6~7건씩 목록을 도배했다',
    run: async () => {
      const rows = [
        { title: '엔씽, 국가기관·대기업·교육까지 전방위 수주', priorityScore: 1 },
        { title: '엔씽, 국가기관·대기업·교육 현장 잇단 수주…농업 AI 확대', priorityScore: 2 },
        { title: '비마이프렌즈, 일본 아뮤즈 투자 유치', priorityScore: 1 },
      ];
      const out = dedupeArticles(rows);
      if (out.length !== 2) return `3건 중 2건이 남아야 하는데 ${out.length}건: ${JSON.stringify(out.map((o) => o.title))}`;
      return null;
    },
  },
  {
    name: '직전 기간 비교 차단(백필 구간)',
    why: '경쟁사·업계동향이 없던 구간과 비교해 +9117% 같은 숫자가 나왔다',
    run: async () => {
      const r = await runChatQuery({ question: 'x', period: 'quarter', scopes: [], terms: [] });
      if (!r.deltaUnavailableReason && !r.deltaCaution) {
        return '3개월 비교가 백필 구간에 걸리는데 경고가 없음';
      }
      return null;
    },
  },
];

// ─────────────────────────── 3) 데이터 소스별 조회 ───────────────────────────

const SOURCE_CASES: Case[] = [
  {
    name: '해외 트렌드는 국내 기사가 아니다',
    why: "'해외 트렌드' 칩이 국내 industry_trend를 조회하던 버그의 재발 방지",
    run: async () => {
      const { result } = await runInterQuery({ period: 'month', limit: 5 });
      if (result.total === 0) return '해외 트렌드 0건 — 수집이 멈췄거나 조회가 깨졌다';
      const domestic = result.articles.filter((a) => /^(portfolio_company|competitor|industry_trend|sparklabs_self)$/.test(a.category));
      return domestic.length ? `국내 기사 분류가 섞임: ${domestic[0].category}` : null;
    },
  },
  {
    name: '해외↔포트폴리오 연결',
    why: 'InterPortfolioMatch 2,000여 건을 챗봇이 아예 안 보고 있었다',
    run: async () => {
      const { result } = await runInterQuery({ period: 'month', portfolioOnly: true, limit: 5 });
      if (result.total === 0) return '포폴사와 엮인 해외 기사가 0건';
      return result.topCompanies.length ? null : '연결된 회사 집계가 비어 있음';
    },
  },
  {
    name: '의미 검색이 키워드 없이 찾는다',
    why: '"해외로 나가는 포폴사" 같은 질문은 제목에 그 글자가 없어 키워드로는 못 찾는다',
    run: async () => {
      const r = await runSemanticQuery({
        meaning: '한국 기업이 해외 시장에 진출하거나 글로벌 사업을 확장한다는 소식',
        period: 'month', scopes: ['portfolio'], limit: 5,
      });
      return r.total > 0 ? null : '의미 검색 0건 — 임베딩이 비었거나 컷이 과함';
    },
  },
  {
    name: '노출 사각지대 = 명단 − 기사 있는 곳',
    why: '"없는 것"은 기사 테이블만 봐서는 못 구한다',
    run: async () => {
      const g = await runCoverageGap({ period: 'month', scopes: ['portfolio'] });
      if (g.totalTargets === 0) return '감시대상이 0곳';
      if (g.silentCount > g.totalTargets) return `무노출(${g.silentCount})이 전체(${g.totalTargets})보다 많음`;
      return null;
    },
  },
  {
    name: '피칭 소재는 점수 하한을 지킨다',
    why: 'pitchScore 27,000여 건이 있는데 챗봇이 한 번도 안 썼다',
    run: async () => {
      const r = await runPitchQuery({ period: 'month', scopes: [], minScore: 80, limit: 5 });
      if (r.total === 0) return '80점 이상 피칭 소재가 0건';
      return null;
    },
  },
  {
    name: '오탐 목록에 판단 재료가 들어 있다',
    why: '건수만 주니 모델이 오탐 원인을 상상해 엉뚱한 제외어를 제안했다',
    run: async () => {
      const r = await runChatQuery({ question: 'x', period: 'quarter', scopes: [], terms: [], withNoise: true });
      const k = r.noisyKeywords?.[0];
      if (!k) return '오탐 키워드가 비었음';
      if (!k.samples?.length) return `${k.name}에 오탐 기사 예시가 없음`;
      if (!k.status) return `${k.name}에 수집 상태가 없음`;
      return null;
    },
  },
];

// ─────────────────────────── 4) 제안 액션 가드레일 ───────────────────────────

const ACTION_CASES: Case[] = [
  {
    name: '반대 필드 충돌 차단',
    why: '문맥어에 있는 단어를 제외어에 넣으면 그 대상이 기사를 하나도 못 잡는다',
    run: async () => {
      const t = await prisma.monitoringTarget.findFirst({
        where: { status: 'ACTIVE', contextWords: { not: null } },
        select: { name: true, contextWords: true },
      });
      if (!t?.contextWords) return null; // 검사할 대상이 없으면 통과
      const word = t.contextWords.split(',')[0].trim();
      const r = await proposeKeywordFix({
        targetName: t.name, field: 'excludeWords', addition: word,
        reason: '회귀 테스트', requestedBy: 'regression-test',
      });
      return r.ok ? `충돌을 못 막음 (${t.name}의 문맥어 "${word}"를 제외어로 등록해버림)` : null;
    },
  },
  {
    name: '멈춘 대상은 이유를 밝히고 거절',
    why: '"못 찾았습니다"로만 답해서 에이전트가 이름이 틀린 줄 알고 헤맸다',
    run: async () => {
      const t = await prisma.monitoringTarget.findFirst({ where: { status: 'PAUSED' }, select: { name: true } });
      if (!t) return null;
      const r = await proposeKeywordFix({
        targetName: t.name, field: 'excludeWords', addition: '회귀테스트단어',
        reason: '회귀 테스트', requestedBy: 'regression-test',
      });
      if (r.ok) return `멈춘 대상(${t.name})에 제안이 등록됨`;
      return r.error.includes('멈춰') ? null : `거절 사유가 불명확: ${r.error}`;
    },
  },
  {
    name: '없는 대상 차단',
    why: '오타나 환각으로 만들어낸 이름에 제안이 등록되면 안 된다',
    run: async () => {
      const r = await proposeKeywordFix({
        targetName: '존재하지않는회사ZZZ', field: 'excludeWords', addition: 'x',
        reason: '회귀 테스트', requestedBy: 'regression-test',
      });
      return r.ok ? '없는 대상에 제안이 등록됨' : null;
    },
  },
  {
    name: '과도하게 긴 제안 차단',
    why: '문단을 통째로 붙여넣으면 설정이 망가진다',
    run: async () => {
      const t = await prisma.monitoringTarget.findFirst({ where: { status: 'ACTIVE' }, select: { name: true } });
      if (!t) return null;
      const r = await proposeKeywordFix({
        targetName: t.name, field: 'excludeWords', addition: '가'.repeat(200),
        reason: '회귀 테스트', requestedBy: 'regression-test',
      });
      return r.ok ? '200자 제안이 통과됨' : null;
    },
  },
];

// ─────────────────────────── 5) 에이전트 end-to-end (--e2e) ───────────────────────────

type E2E = {
  q: string;
  why: string;
  period?: string;
  /** steps 문자열에 이게 들어 있어야 한다 (어떤 도구를 썼는지) */
  expectStep?: string;
  /** 화면 카드 기간이 이거여야 한다 */
  expectPeriodLabel?: string;
  /** 답변에 이 문자열이 들어 있으면 실패 */
  forbid?: string[];
};

const E2E_CASES: E2E[] = [
  {
    q: '해외에서 요즘 뜨는 AI 트렌드 뭐야?',
    why: '해외 질문에 국내 기사를 주던 버그',
    expectStep: 'inter(',
  },
  {
    q: '이번 달 피칭할 만한 기획기사 소재 있어?',
    why: 'pitchScore를 안 쓰고 일반 검색으로 답하던 문제',
    expectStep: 'pitch(',
  },
  {
    q: '기사 하나도 안 난 포폴사 어디야?',
    why: '"없는 것"은 감시 명단과 대조해야 나온다',
    expectStep: 'gap',
  },
  {
    q: '지금 위기인 포폴사 있어?',
    why: '"어느 회사가 문제인가"를 부정 기사 나열로만 답하고 회사 단위로 안 묶어줬다',
    expectStep: '위기감지',
  },
  {
    q: '요즘 시끄러운 데 없나?',
    why: '구어체로 물어도 위기 감지로 가야 한다(only_negative 기사 나열로 새지 않게)',
    expectStep: '위기감지',
  },
  {
    // "시끄러운 데"는 위기 질문이라 crisis_watch로 간다. 화면에서 3개월을 골랐어도
    // 질문에 "지난주"가 명시됐으면 그 기간(7일)으로 좁혀야 한다 — 화면 값을 그대로
    // 쓰면 안 된다는 원래 테스트 의도는 그대로다(2026-08-19에 라우팅이 바뀌면서
    // 기간 라벨이 "이번 주" → "최근 7일"로 바뀌어 기대값을 갱신함).
    q: '지난주 시끄러운 포폴사?',
    why: '명시적 기간 표현은 반대로 존중해야 한다',
    period: 'quarter',
    expectStep: '위기감지(최근 7일)',
  },
  {
    // 저장 기록 조회는 검색으로 흉내낼 수 없다 — 비슷한 기사를 찾아다 주면 오답이다.
    q: '내가 스크랩해둔 기사 다시 보여줘',
    why: '추천 질문에는 있는데 도구가 없어서 답을 못 하던 기능(2026-08-19 추가)',
    expectStep: '저장 기사',
  },
  {
    q: '투자유치 기사 요즘 늘고 있어 줄고 있어?',
    why: '추세 질문에 직전 기간 하나만 비교하면 백필 구간에 왜곡된다',
    expectStep: 'trend',
  },
  {
    q: '이번 주 포폴사 기사 정리해줘',
    why: '내부 도구 이름이 답변에 새어나왔다("coverage_gap 기준으로")',
    forbid: ['search_articles', 'coverage_gap', 'inter_trends', 'pitch_opportunities', 'monthly_trend', '%'],
  },
];

async function runE2E(base: string) {
  console.log('\n━━━ 에이전트 end-to-end ━━━');
  for (const c of E2E_CASES) {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: c.q, period: c.period ?? 'quarter', scopes: [], modes: [] }),
    });
    if (!res.ok || !res.body) {
      results.push({ name: `E2E: ${c.q}`, why: c.why, ok: false, detail: `HTTP ${res.status}` });
      continue;
    }
    const text = await res.text();
    const events = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const done = events.find((e: any) => e.type === 'done');
    const steps = events.filter((e: any) => e.type === 'progress' && e.detail).map((e: any) => e.detail).join(' → ');

    const fails: string[] = [];
    if (!done) fails.push('done 이벤트 없음');
    if (c.expectStep && !steps.includes(c.expectStep)) fails.push(`도구 "${c.expectStep}" 미사용 (실제: ${steps || '없음'})`);
    if (c.expectPeriodLabel && done?.result?.periodLabel !== c.expectPeriodLabel) {
      fails.push(`기간 ${done?.result?.periodLabel} (기대: ${c.expectPeriodLabel})`);
    }
    for (const f of c.forbid ?? []) {
      if ((done?.summary ?? '').includes(f)) fails.push(`답변에 "${f}" 노출`);
    }
    results.push({ name: `E2E: ${c.q}`, why: c.why, ok: !fails.length, detail: fails.join(' / ') || steps || 'ok' });
  }
}

// ─────────────────────────── 실행 ───────────────────────────

async function main() {
  const e2e = process.argv.includes('--e2e');
  const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

  console.log('━━━ 도구 계층 (LLM 안 씀) ━━━');
  for (const c of [...TERM_CASES, ...SEARCH_CASES, ...SOURCE_CASES, ...ACTION_CASES]) await check(c);

  if (e2e) await runE2E(base);

  // 테스트가 만든 제안이 남아 있으면 지운다 (가드레일이 다 막으면 생기지 않지만 안전장치)
  const junk = await prisma.noiseSuggestion.deleteMany({ where: { reason: { contains: 'regression-test' } } });
  if (junk.count) console.log(`\n(정리) 테스트가 만든 제안 ${junk.count}건 삭제`);

  console.log('\n━━━ 결과 ━━━');
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.name}`);
    } else {
      failed++;
      console.log(`  ✗ ${r.name}`);
      console.log(`      이유: ${r.why}`);
      console.log(`      실패: ${r.detail}`);
    }
  }
  console.log(`\n${results.length - failed}/${results.length} 통과${e2e ? '' : '  (에이전트 검사는 --e2e로 실행)'}`);

  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
