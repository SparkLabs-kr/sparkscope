// 챗봇의 두뇌 — 도구를 쥐어주고 스스로 여러 번 조회하게 한다.
//
// 예전 구조는 한 방향 파이프라인이었다:
//   질문 → 의도분석 1회 → SQL 1회 → 요약 1회 → 끝
// 0건이 나와도 재시도가 없고, 검색어가 빗나가도 스스로 못 고쳤다. 그래서 조금만
// 비틀어 물어도 빈손으로 답했다.
//
// 지금은 LLM에 조회 도구를 주고 원하는 만큼 부르게 한다. "0건이네 → 검색어 바꿔서 다시 →
// 이번엔 잡혔다 → 답변" 같은 동작이 나온다. 이전 대화도 함께 넘겨 후속 질문을 이해한다.
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { runChatQuery, getCoverageSummary } from './chat-query';
import { PERIOD_LABEL, SCOPE_LABEL, categoryLabel } from './chat-types';
import type { ChatPeriod, ChatScope, ChatQueryResult } from './chat-types';

const MODEL = 'gpt-5.4-mini';
/** 도구 호출 왕복 상한. 넘으면 그때까지 모은 데이터로 답하게 한다. */
const MAX_STEPS = 6;
/** 도구 결과에 실어 보낼 기사 수 — 토큰을 아끼려고 화면에 뿌리는 수보다 적게 준다. */
const ARTICLES_PER_TOOL_RESULT = 18;

export type AgentTurn = { role: 'user' | 'assistant'; text: string };

const PERIODS: ChatPeriod[] = ['today', 'week', 'month', 'quarter', 'all'];
const SCOPES: ChatScope[] = ['portfolio', 'competitor', 'sparklabs', 'inter'];

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_articles',
      description:
        '수집된 기사를 검색한다. 건수·분류·매체·회사 집계와 기사 목록을 돌려준다. ' +
        '결과가 0건이거나 너무 적으면 검색어를 바꿔서 다시 부르는 게 정상이다.',
      parameters: {
        type: 'object',
        properties: {
          terms: {
            type: 'array',
            items: { type: 'string' },
            description:
              '제목·요약·회사명에서 찾을 핵심어(최대 8개). 사용자가 쓴 일상어를 그대로 넣지 말고 ' +
              '"기사에 실제로 어떻게 쓰였을까"로 바꿔서, 같은 뜻의 표현을 여러 개 넣어라. ' +
              '예) "투자 받은 데" → ["투자유치","시리즈A","프리A","시드 투자","라운드"]. ' +
              '띄어쓰기 변형(투자 유치)은 시스템이 자동 처리하니 넣지 마라. ' +
              '주제를 안 가리는 질문이면 빈 배열로 두고 기간·범위로만 조회해라.',
          },
          period: { type: 'string', enum: PERIODS, description: '조회 기간' },
          scopes: {
            type: 'array',
            items: { type: 'string', enum: SCOPES },
            description: '검색 범위. 비우면 전체에서 찾는다.',
          },
          only_negative: {
            type: 'boolean',
            description:
              '위기·리스크 질문일 때 true — 부정 톤이거나 위험 플래그가 달린 기사만 본다. ' +
              '이때는 terms를 비워라. 톤 자체가 이미 필터라서 "논란","소송" 같은 단어를 얹으면 ' +
              'AND로 걸려 대부분 0건이 된다(제목에 그 단어가 그대로 있는 기사만 남는다). ' +
              '먼저 terms 없이 부르고, 결과가 너무 많을 때만 좁혀라.',
          },
        },
        required: ['terms', 'period', 'scopes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'monthly_trend',
      description:
        '최근 6개월 월별 건수를 센다. 추이·증감 질문에 쓴다. ' +
        '검색 결과(건수·기사 목록)도 함께 돌려주므로 같은 조건이면 search_articles를 따로 부를 필요 없다.',
      parameters: {
        type: 'object',
        properties: {
          terms: { type: 'array', items: { type: 'string' } },
          period: { type: 'string', enum: PERIODS, description: '기사 목록·건수를 뽑을 기간' },
          scopes: { type: 'array', items: { type: 'string', enum: SCOPES } },
        },
        required: ['terms', 'period', 'scopes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'noise_report',
      description:
        '오탐(노이즈)으로 걸러진 기사가 많은 수집 키워드를 돌려준다. ' +
        '키워드 설정·오탐 정리 질문에 쓴다.',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: PERIODS } },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'data_coverage',
      description:
        '어느 분류의 기사가 언제부터 수집됐는지, 연도별로 몇 건인지 알려준다. ' +
        '숫자가 이상해 보이거나 기간 비교가 미심쩍을 때, 데이터 현황을 묻는 질문일 때 확인해라.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function systemPrompt(uiPeriod: ChatPeriod, uiScopes: ChatScope[], deep: boolean, asTable: boolean) {
  return `너는 스파크랩(초기투자 VC) 커뮤니케이션 본부의 뉴스 분석 담당이다.
수집된 국내 뉴스 기사 DB를 도구로 조회해서 질문에 답한다.

[데이터]
분류는 넷이다 — 스파크랩(자사), 포트폴리오사(투자한 회사), 경쟁사(VC), 업계동향.
기사마다 제목·매체·발행일·톤(긍정/중립/부정)·위험 플래그·AI 한 줄 요약이 있다.
2026.05부터 매일 정기 수집 중이고, 그 이전은 나중에 소급 수집한 백필 구간이라
스파크랩·포트폴리오사만 있고 훨씬 성기다. 기간 비교가 이상하면 data_coverage로 확인해라.

[화면에서 고른 값]
기간 ${PERIOD_LABEL[uiPeriod]} / 범위 ${uiScopes.length ? uiScopes.map((s) => SCOPE_LABEL[s]).join(', ') : '전체'}
이 값을 함부로 바꾸지 마라. 사용자가 직접 고른 것이다.
질문에 "지난주", "어제", "올해", "이번 달"처럼 기간이 명시됐을 때만 바꿔라.
"요즘", "최근", "요새"처럼 모호한 말은 기간 표현이 아니다 — 화면 값을 그대로 써라.
범위도 마찬가지로, "포폴사만", "경쟁사" 같이 명시됐을 때만 바꾼다.

[도구 사용 원칙]
- 답하기 전에 반드시 도구로 실제 데이터를 확인해라. 추측으로 답하지 마라.
- 조건은 전부 AND로 걸린다. 검색어를 많이 넣을수록 결과가 좁아지는 게 아니라,
  검색어 목록 중 하나라도 걸리는 기사(OR) 중에서 기간·범위·톤을 모두 만족하는 것만 남는다.
- 첫 검색이 0건이거나 눈에 띄게 적으면 그대로 "없다"고 하지 마라.
  이때 가장 먼저 할 일은 검색어를 다른 단어로 바꾸는 게 아니라 아예 비우는 것이다.
  terms를 빼고 기간·범위·톤만으로 조회하면 무엇이 있는지 실제로 보인다. 그 다음에 좁혀라.
  그래도 없으면 기간을 넓히거나 범위를 풀어라.
- 반대로 결과가 수천 건이면 너무 넓은 것이다. 검색어를 좁혀서 다시 불러라.
- 도구는 최대 ${MAX_STEPS}번까지 부를 수 있다. 2~3번 안에 끝내는 게 보통이다.
- "늘었나/줄었나", "추세", "흐름", "언제부터" 같은 질문에는 반드시 monthly_trend를 불러라.
  직전 기간 한 개와의 비교만으로 추세를 말하지 마라 — 백필 구간에 걸려 왜곡되기 쉽다.
- 키워드·오탐·수집 설정을 물으면 noise_report를 써라.

[답변 규칙]
- 한국어 존댓말. 인사말·서론 없이 바로 본론.
- 도구가 돌려준 숫자만 쓴다. 직접 계산하거나 추정하지 마라. 데이터에 없는 사실은 절대 지어내지 마라.
- 퍼센트(%) 증감률은 쓰지 마라. "이번 기간 N건, 직전 기간 M건"처럼 건수로 말한다.
- 굵게(**) 같은 마크다운 강조는 쓰지 마라. 평문으로 쓴다.
- 회사 이름을 말할 땐 무슨 일이 있었는지까지 붙인다. 나열만 하지 마라.
- 같은 사안을 여러 매체가 받아쓴 경우 그 사실을 짚어라(건수가 부풀어 보인다).
- 표본 경고(sampled)가 있으면 그 집계를 전체인 것처럼 말하지 마라.
- 기간 비교가 백필 구간에 걸리면 증감을 단정하지 말고 그 사실을 한 줄로 알려라.
- 검색을 여러 번 바꿔서 시도했는데도 결과가 없으면, 무엇을 어떻게 찾아봤는지 밝히고
  검색 조건을 어떻게 바꾸면 좋을지 제안해라.
${deep
      ? '- [심층 분석 켜짐] 6~10문장으로 길게. 기사들을 주제별로 묶고, 왜 이런 흐름인지 원인·맥락까지 짚고, 본부가 무엇을 해야 하는지로 마무리한다.'
      : '- 3~5문장으로 간결하게. 무엇이 잡혔는지와 눈에 띄는 건만 짚는다.'}
${asTable ? '- [표로 정리 켜짐] 핵심 내용을 마크다운 표로 정리해서 함께 보여준다.' : ''}`;
}

/** 도구 결과를 모델에 돌려줄 때 쓰는 압축 형태 — 링크·id 같은 화면 전용 필드는 뺀다. */
function compactResult(r: ChatQueryResult) {
  return {
    total: r.total,
    prevTotal: r.prevTotal,
    prevPeriodWarning: r.deltaUnavailableReason ?? r.deltaCaution ?? null,
    sampled: r.sampled ?? false,
    negativeCount: r.negativeCount,
    riskCount: r.riskCount,
    byCategory: r.byCategory.map((c) => ({ name: categoryLabel(c.category), count: c.count })),
    topCompanies: r.topCompanies,
    topSources: r.topSources,
    articles: r.articles.slice(0, ARTICLES_PER_TOOL_RESULT).map((a) => ({
      title: a.title,
      summary: a.oneLiner ?? null,
      company: a.matchedKeyword,
      source: a.source,
      date: a.pubDate.slice(0, 10),
      tone: a.tone,
      risk: a.riskFlag ? true : undefined,
    })),
  };
}

const asPeriod = (v: any, fb: ChatPeriod): ChatPeriod => (PERIODS.includes(v) ? v : fb);
const asScopes = (v: any): ChatScope[] => (Array.isArray(v) ? v.filter((s) => SCOPES.includes(s)) : []);
const asTerms = (v: any): string[] =>
  Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim().length >= 2).map((t) => t.trim()).slice(0, 8) : [];

export type AgentOutcome = {
  summary: string | null;
  result: ChatQueryResult | null;
  /** 어떤 조회를 몇 번 했는지 — 로그·디버깅용 */
  steps: string[];
};

export async function runChatAgent(opts: {
  question: string;
  history: AgentTurn[];
  period: ChatPeriod;
  scopes: ChatScope[];
  deep: boolean;
  asTable: boolean;
}): Promise<AgentOutcome> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const steps: string[] = [];

  // 화면 카드에 뿌릴 조회 결과. 여러 번 검색하면 "건수가 잡힌 마지막 검색"을 쓴다.
  let uiResult: ChatQueryResult | null = null;
  let monthly: ChatQueryResult['monthly'] = null;
  let noisyKeywords: ChatQueryResult['noisyKeywords'] = null;

  /** 화면 카드용 결과에 월별 추이·오탐 키워드를 얹어 마무리한다. */
  const finish = (summary: string | null): AgentOutcome => ({
    summary,
    result: uiResult
      ? { ...uiResult, monthly: monthly ?? uiResult.monthly, noisyKeywords: noisyKeywords ?? uiResult.noisyKeywords }
      : null,
    steps,
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(opts.period, opts.scopes, opts.deep, opts.asTable) },
    // 이전 대화 — 후속 질문("그중 부정적인 것만")을 이해하려면 필요하다. 최근 6턴만.
    ...opts.history.slice(-6).map((t) => ({ role: t.role, content: t.text }) as ChatCompletionMessageParam),
    { role: 'user', content: opts.question },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2000,
      tools: TOOLS,
      messages,
    });

    const msg = resp.choices[0]?.message;
    if (!msg) break;
    messages.push(msg as ChatCompletionMessageParam);

    const calls = msg.tool_calls ?? [];
    if (!calls.length) return finish(msg.content?.trim() || null);

    for (const call of calls) {
      if (call.type !== 'function') continue;
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        /* 인자가 깨지면 빈 객체로 두고 기본값으로 조회한다 */
      }

      let payload: unknown;
      try {
        switch (call.function.name) {
          case 'search_articles': {
            const terms = asTerms(args.terms);
            const r = await runChatQuery({
              question: opts.question,
              period: asPeriod(args.period, opts.period),
              scopes: asScopes(args.scopes),
              terms,
              onlyNegative: args.only_negative === true,
              limit: 30,
            });
            steps.push(`search(${terms.join('|') || '전체'}) → ${r.total}건`);
            if (!uiResult || r.total > 0) uiResult = r;
            payload = compactResult(r);
            break;
          }
          case 'monthly_trend': {
            // 월별 추이는 기간과 무관하게 최근 6개월을 세지만, 같은 호출로 기간 내
            // 건수·기사 목록도 함께 나온다. 화면 카드가 비지 않도록 그 결과도 받아둔다.
            const r = await runChatQuery({
              question: opts.question,
              period: asPeriod(args.period, opts.period),
              scopes: asScopes(args.scopes),
              terms: asTerms(args.terms),
              withTrend: true,
              limit: 30,
            });
            monthly = r.monthly;
            steps.push(`trend(${r.monthly?.length ?? 0}개월) → ${r.total}건`);
            if (!uiResult || r.total > 0) uiResult = r;
            payload = { monthly: r.monthly, ...compactResult(r) };
            break;
          }
          case 'noise_report': {
            const r = await runChatQuery({
              question: opts.question,
              period: asPeriod(args.period, opts.period),
              scopes: [],
              terms: [],
              withNoise: true,
              limit: 1,
            });
            noisyKeywords = r.noisyKeywords;
            steps.push(`noise → ${r.noisyKeywords?.length ?? 0}개 키워드`);
            payload = { noisyKeywords: r.noisyKeywords };
            break;
          }
          case 'data_coverage': {
            payload = await getCoverageSummary();
            steps.push('coverage');
            break;
          }
          default:
            payload = { error: `알 수 없는 도구: ${call.function.name}` };
        }
      } catch (e) {
        console.error('[chat-agent] 도구 실행 실패', call.function.name, e);
        payload = { error: '조회에 실패했습니다. 다른 조건으로 시도해 보세요.' };
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(payload),
      });
    }
  }

  // 상한까지 도구만 부르고 안 끝났다 — 모은 데이터로 마무리하게 한 번 더 부른다(도구 없이).
  const final = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 1600,
    messages: [
      ...messages,
      { role: 'user', content: '더 조회하지 말고, 지금까지 확인한 데이터만으로 답변을 완성해라.' },
    ],
  });

  return finish(final.choices[0]?.message?.content?.trim() || null);
}
