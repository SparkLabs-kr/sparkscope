// Inter(해외 트렌드) 탭 — 섹터 배지("긴급"/"모니터링"/"기회") 사유 한 줄 요약.
// analyzer.ts의 summarizeCrisisCause와 동일한 OpenAI 호출 패턴(gpt-4o-mini, JSON 스키마, 실패 시 null).

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MODEL = 'gpt-4o-mini';

const BADGE_URGENCY_SYSTEM =
  '너는 스타트업 액셀러레이터의 해외 트렌드 분석가다. 주어진 분야명과 최근 기사 제목들, 그리고 이 분야에 매겨진 상태 배지를 보고 ' +
  '왜 그 배지가 매겨졌는지를 한국어 한 문장으로 설명한다. 반드시 JSON 객체 하나만 반환한다.';

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export async function summarizeSectorBadgeReason(
  sectorName: string,
  badgeLabel: string,
  titles: string[]
): Promise<string | null> {
  if (titles.length === 0) return null;
  try {
    const userContent = `분야: ${sectorName}
현재 상태 배지: ${badgeLabel}
최근 기사 제목들:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

이 분야가 왜 "${badgeLabel}" 상태인지 그 근거를 한국어 한 문장(60자 이내)으로 요약해주세요.
"~해서 ${badgeLabel} 상태입니다" 또는 "~로 인해 ~합니다" 형태의 자연스러운 서술을 권장합니다.
출력 스키마: {"reason": "..."}
JSON 객체만 반환:`;
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 150,
      messages: [
        { role: 'system', content: BADGE_URGENCY_SYSTEM },
        { role: 'user', content: userContent },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(extractJson(text));
    const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim() : '';
    return reason.length > 0 ? reason : null;
  } catch (e) {
    console.error('[inter-insight] summarizeSectorBadgeReason failed:', e);
    return null;
  }
}
