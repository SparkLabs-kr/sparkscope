/**
 * 노이즈 신고 시 AI가 재발 방지용 문맥어/제외어를 제안 — NoiseSuggestion에 대기(PENDING)로만
 * 저장하고 바로 적용하지 않는다. 신고 1건만 보고 자동 적용하면 그 기사 하나 막으려다 진짜
 * 관련기사까지 막는 과적합 위험이 있어서(2026-08 946건 소급판정 사고에서 배운 교훈),
 * 관리자가 화면에서 한 번 보고 승인해야 MonitoringTarget에 반영된다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = 'gpt-4o-mini'; // 분류급 저비용 작업 — 2026-08-05 비교에서 확인된 최저단가 모델

const SYSTEM = `당신은 SparkScope 뉴스 모니터링 시스템의 오탐(노이즈) 필터 튜닝 어시스턴트입니다.
관리자가 "이 기사는 노이즈다"라고 신고한 기사 1건과, 그 감시대상의 현재 설정(제외어·문맥어)을 보고,
같은 유형의 오탐이 재발하지 않도록 무엇을 추가하면 좋을지 제안합니다.

원칙:
- excludeWords(제외어)는 이 기사를 오탐시킨 "구체적인 무관한 주제/단어"만 짧게 제안합니다
  (예: 화장품 프라이머 기사면 "화장품", "메이크업" — "제품" 같은 너무 넓은 말은 금지).
- contextWords(문맥어)는 회사 관련 기사에 실제로 자주 나오는 구체적 단어를 제안합니다.
- 이미 있는 제외어/문맥어와 중복되는 제안은 하지 않습니다.
- **이 기사 하나만 보고 확신이 안 서면, 억지로 제안하지 말고 relevant_fix: false로 답하세요.**
  기존 excludeWords/contextWords 설정으로 이미 막을 수 있었어야 할 사례이거나, 단발성이라
  일반화하기 애매하면 제안하지 않는 게 맞습니다.

응답은 반드시 valid JSON 객체로, 추가 설명 없이.`;

function buildUserPrompt(
  companyName: string,
  primaryKeyword: string,
  currentExclude: string | null,
  currentContext: string | null,
  articleTitle: string,
): string {
  return `감시대상: ${companyName} (검색 키워드: ${primaryKeyword})
현재 제외어(excludeWords): ${currentExclude || '(없음)'}
현재 문맥어(contextWords): ${currentContext || '(없음)'}

노이즈로 신고된 기사 제목: "${articleTitle}"

출력 스키마:
{
  "relevant_fix": true|false,
  "field": "excludeWords"|"contextWords"|null,
  "addition": "추가할 단어(콤마 구분 가능, 짧게)"|null,
  "reason": "이렇게 제안하는 이유 한 줄"|null
}
relevant_fix가 false면 field/addition/reason은 전부 null.
JSON 객체만 반환:`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

/** 노이즈 신고 직후 호출 — 실패해도 절대 throw하지 않음(신고 자체는 이미 끝난 동작). */
export async function suggestNoiseFilterFix(articleId: string): Promise<void> {
  try {
    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article) return;

    const target = await prisma.monitoringTarget.findFirst({ where: { primaryKeyword: article.matchedKeyword } });
    if (!target) return;

    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(target.name, target.primaryKeyword, target.excludeWords, target.contextWords, article.title) },
      ],
    });
    const parsed = JSON.parse(extractJson(resp.choices[0]?.message?.content ?? '{}'));
    if (!parsed?.relevant_fix) return;

    const field = parsed.field;
    const addition = typeof parsed.addition === 'string' ? parsed.addition.trim() : '';
    if (!['excludeWords', 'contextWords'].includes(field) || !addition) return;

    const currentValue = field === 'excludeWords' ? target.excludeWords : target.contextWords;

    await prisma.noiseSuggestion.create({
      data: {
        articleId,
        targetName: target.name,
        field,
        currentValue,
        addition,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      },
    });
  } catch (e: any) {
    console.error('[noise-suggestion] 생성 실패:', e?.message ?? e);
  }
}
