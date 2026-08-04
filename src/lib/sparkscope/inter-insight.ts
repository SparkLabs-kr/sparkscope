// Inter(해외 트렌드) 탭 — 섹터 배지("긴급"/"모니터링"/"기회") 사유 한 줄 요약.
// analyzer.ts의 summarizeCrisisCause와 동일한 OpenAI 호출 패턴(gpt-4o-mini, JSON 스키마, 실패 시 null).

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MODEL = 'gpt-4o-mini';

const BADGE_URGENCY_SYSTEM =
  '너는 스타트업 액셀러레이터의 해외 트렌드 분석가다. 주어진 분야의 실제 집계 지표와 최근 기사 제목을 보고, ' +
  '이 분야에서 지금 무슨 일이 일어나고 있는지를 한국어 한 문장으로 설명한다. ' +
  '문장은 반드시 "~습니다/~합니다"로 끝나는 존댓말 종결형으로 쓴다 — "늘었다", "부각됐다" 같은 ' +
  '평서형(~다) 종결은 쓰지 않는다(예: "투자가 늘었다"가 아니라 "투자가 늘었습니다"). ' +
  '주어진 지표와 제목에 없는 사실을 만들어내지 마라. 반드시 JSON 객체 하나만 반환한다.';

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

/**
 * 섹터 한 줄 요약.
 *
 * 예전엔 배지 라벨("긴급"/"모니터링")만 넘기고 "왜 이 배지인지 설명하라"고 시켰는데,
 * 그 배지 자체가 배열 인덱스로 정해진 가짜였다(inter-sample-data.ts 주석 참고).
 * 결과적으로 모델이 없는 근거를 지어내고 있었다. 지금은 실제 집계 지표(metricsLine)를
 * 함께 넘기고, 그 숫자와 제목 범위 안에서만 서술하게 한다.
 */
export async function summarizeSectorBadgeReason(
  sectorName: string,
  badgeLabel: string,
  metricsLine: string,
  titles: string[]
): Promise<string | null> {
  if (titles.length === 0) return null;
  try {
    const userContent = `분야: ${sectorName}
이 분야의 실제 집계 지표: ${metricsLine}
시스템이 이 지표로 매긴 상태 라벨: ${badgeLabel}
최근 기사 제목들:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

위 지표와 제목만 근거로, 이 분야에서 지금 무슨 흐름이 보이는지 한국어 한 문장(70자 이내)으로 요약해주세요.
· 기사 제목에 실제로 등장하는 주제·기업·기술을 구체적으로 언급하세요.
· 지표에 없는 숫자나 제목에 없는 사실을 추가하지 마세요.
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
