// 답변 생성 — 조회 결과를 놓고 "추론"을 붙인다.
//
// 카테고리(의도)마다 물어보는 게 다르므로 지시문도 다르게 준다.
// 검색(search)만 "심층 분석" 토글이 있을 때 돌고, 나머지 의도는 분석 자체가 목적이라 항상 돈다.
import OpenAI from 'openai';
import type { ChatQueryResult } from './chat-types';
import { categoryLabel } from './chat-types';
import type { ChatIntent } from './chat-intent';

const MODEL = 'gpt-5.4-mini';

const BASE = `너는 스파크랩(초기투자 VC) 커뮤니케이션 본부의 뉴스 분석 담당이다.
아래 주어진 데이터만 근거로 답한다. 데이터에 없는 사실은 절대 지어내지 마라.

공통 규칙:
- 한국어 존댓말. 불필요한 인사말·서론 금지.
- 숫자는 주어진 값을 그대로 쓴다. 직접 계산하거나 추정하지 마라.
- 굵게(**) 표시는 쓰지 마라. 평문으로 쓴다.
- 데이터가 0건이면 왜 안 나왔을지 짚고 검색 조건을 어떻게 바꾸면 좋을지 제안한다.`;

/** 의도별 지시문 — 여기가 "버튼별 기능"의 실체다 */
const BY_INTENT: Record<string, string> = {
  search: `[기사 찾기]
3~5문장으로 정리한다.
- 어떤 기사들이 잡혔는지 주제별로 묶어서 설명한다.
- 같은 사안을 여러 매체가 받아쓴 경우 그 사실을 짚는다.
- 질문 의도와 어긋나 보이는 기사가 섞였으면 지적한다.`,

  stats: `[지표·추이]
숫자를 해석하는 게 핵심이다. 4~6문장.
- 이번 기간 건수와 직전 기간 대비 증감을 먼저 말하고, 그 변화가 큰 편인지 판단한다.
- 월별 추이가 주어지면 상승/하락/횡보 중 무엇인지, 튀는 달이 있으면 언제인지 짚는다.
- 보도량 상위 키워드·매체가 무엇을 뜻하는지 한 줄 해석을 붙인다(예: 특정 매체 쏠림).
- 마지막에 이 수치로 무엇을 판단할 수 있는지 한 문장.`,

  risk: `[위기·이슈]
부정 기사만 걸러진 데이터다. 4~6문장.
- 부정 기사가 무엇 때문인지 제목 근거로 원인을 유형별로 묶는다(실적, 규제, 소송, 인력, 제품 등).
- 한 회사에 몰려 있는지, 업계 전반인지 구분한다.
- 직전 기간보다 늘었으면 급증 신호로 볼 수 있는지 판단한다.
- 대응이 필요해 보이는 건이 있으면 마지막에 한 줄로 짚는다. 없으면 없다고 분명히 말한다.`,

  inter: `[해외 트렌드]
4~6문장.
- 어떤 기술·섹터가 반복해서 나오는지 묶어서 설명한다.
- 국내에서 이미 보이는 흐름인지, 아직 앞서가는 흐름인지 구분한다.
- 스파크랩 포트폴리오와 겹칠 만한 영역이 데이터에서 보이면 짚는다(없으면 추측하지 마라).`,

  report: `[리포트 작성]
보고서에 그대로 옮길 수 있는 형태로 쓴다. 아래 세 덩어리를 각각 소제목 없이 문단으로.
1) 핵심 요약 — 기간·건수·증감을 담은 2~3문장
2) 주요 내용 — 눈에 띄는 기사 3~5건을 '- '로 시작하는 줄로, 각 줄 끝에 (매체명)
3) 시사점 — 본부 관점에서 무엇을 해야 하는지 1~2문장`,

  manage: `[키워드·노이즈 점검]
수집 설정을 손봐야 하는지 판단한다. 4~6문장.
- 오탐(노이즈) 건수가 많은 키워드가 주어지면, 통과 건수와 비교해 오탐률이 높은 것부터 지적한다.
- 그 키워드가 왜 오탐이 나는지 추측되는 이유를 쓴다(동명이인, 흔한 단어, 부분 문자열 등).
- 문맥어(contextWords)로 무엇을 넣으면 좋을지 구체적인 단어를 제안한다.
- 데이터로 판단이 안 되면 무엇을 더 봐야 하는지 말한다.`,

  smalltalk: `[사용 안내] 2~3문장으로 무엇을 물어보면 되는지 안내한다.`,
};

function buildPrompt(question: string, r: ChatQueryResult, intent: ChatIntent) {
  const lines: string[] = [];
  lines.push(`[사용자 질문] ${question}`);
  lines.push(`[기간] ${r.periodLabel}`);
  if (r.terms.length) lines.push(`[검색어] ${r.terms.join(', ')}`);
  lines.push(`[총 건수] ${r.total}건 (부정 톤 ${r.negativeCount}건, 위험 플래그 ${r.riskCount}건)`);
  if (r.prevTotal !== null) {
    const d = r.deltaPct === null ? '' : ` (${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct}%)`;
    lines.push(`[직전 같은 기간] ${r.prevTotal}건${d}`);
  }
  if (r.monthly?.length) {
    lines.push(`[월별 추이] ${r.monthly.map((m) => `${m.month} ${m.count}건`).join(', ')}`);
  }
  if (r.noisyKeywords?.length) {
    lines.push(
      `[오탐 많은 키워드] ${r.noisyKeywords
        .map((k) => `${k.name}: 노이즈 ${k.noise}건 / 통과 ${k.kept}건`)
        .join(' | ')}`
    );
  }
  if (r.sampled)
    lines.push('[주의] 아래 분류·키워드·매체 집계는 전체가 아니라 최신 1000건 표본 기준이다. 이 수치를 전체처럼 말하지 마라.');
  if (r.byCategory.length)
    lines.push(`[분류별] ${r.byCategory.map((c) => `${categoryLabel(c.category)} ${c.count}`).join(', ')}`);
  if (r.topCompanies.length)
    lines.push(`[많이 나온 키워드] ${r.topCompanies.map((c) => `${c.name} ${c.count}`).join(', ')}`);
  if (r.topSources.length) lines.push(`[매체] ${r.topSources.map((s) => `${s.name} ${s.count}`).join(', ')}`);
  if (r.articles.length) {
    lines.push('[기사 제목 (최대 25건)]');
    for (const a of r.articles.slice(0, 25)) {
      lines.push(`- ${a.title} (${a.source}${a.tone === 'NEGATIVE' ? ', 부정' : ''}${a.riskFlag ? ', 위험' : ''})`);
    }
  }
  return lines.join('\n');
}

/** 추론 답변. 실패하면 null을 돌려주고 화면은 집계만 보여준다. */
export async function summarizeChatResult(
  question: string,
  result: ChatQueryResult,
  intent: ChatIntent
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1100,
      messages: [
        { role: 'system', content: `${BASE}\n\n${BY_INTENT[intent.kind] ?? BY_INTENT.search}` },
        { role: 'user', content: buildPrompt(question, result, intent) },
      ],
    });
    const text = resp.choices[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.error('[chat-answer] 요약 실패', e);
    return null;
  }
}
