// 심층 분석 — DB 조회 결과를 놓고 원인·맥락을 문장으로 정리한다.
// "심층 분석" 토글이 켜졌을 때만 호출된다(끄면 LLM 호출 0회).
import OpenAI from 'openai';
import type { ChatQueryResult } from './chat-types';
import { categoryLabel } from './chat-types';
import type { ChatIntent } from './chat-intent';

const MODEL = 'gpt-5.4-mini';

const SYSTEM = `너는 스파크랩(초기투자 VC) 커뮤니케이션 본부의 뉴스 분석 담당이다.
아래에 주어진 기사 데이터만 근거로 답한다. 데이터에 없는 사실은 절대 지어내지 마라.

규칙:
- 한국어 존댓말, 3~5문장. 불필요한 인사말 금지.
- 숫자는 주어진 값을 그대로 쓴다(임의 계산·추정 금지).
- 기사 제목에서 읽히는 흐름(어떤 주제가 많은지, 어디서 많이 다뤘는지)을 짚어준다.
- 부정 기사가 있으면 무엇 때문인지 제목 근거로 한 줄 덧붙인다.
- 데이터가 0건이면 검색 조건을 어떻게 바꾸면 좋을지 제안한다.`;

function buildPrompt(question: string, r: ChatQueryResult, intent: ChatIntent) {
  const lines: string[] = [];
  lines.push(`[사용자 질문] ${question}`);
  lines.push(`[의도] ${intent.kind}`);
  lines.push(`[기간] ${r.periodLabel}`);
  if (r.terms.length) lines.push(`[검색어] ${r.terms.join(', ')}`);
  lines.push(`[총 건수] ${r.total}건 (그중 부정 톤 ${r.negativeCount}건)`);
  if (r.byCategory.length)
    lines.push(`[분류별] ${r.byCategory.map((c) => `${categoryLabel(c.category)} ${c.count}`).join(', ')}`);
  if (r.topCompanies.length)
    lines.push(`[많이 나온 키워드] ${r.topCompanies.map((c) => `${c.name} ${c.count}`).join(', ')}`);
  if (r.topSources.length)
    lines.push(`[매체] ${r.topSources.map((s) => `${s.name} ${s.count}`).join(', ')}`);
  if (r.articles.length) {
    lines.push('[기사 제목 (최대 25건)]');
    for (const a of r.articles.slice(0, 25)) {
      lines.push(`- ${a.title} (${a.source}${a.tone === 'NEGATIVE' ? ', 부정' : ''})`);
    }
  }
  return lines.join('\n');
}

/** 심층 분석 문장. 실패하면 null을 돌려주고 화면은 집계만 보여준다. */
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
      max_completion_tokens: 700,
      messages: [
        { role: 'system', content: SYSTEM },
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
