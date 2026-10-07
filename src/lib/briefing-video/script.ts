/**
 * 데일리 브리핑 대본 — 헤드라인 스냅샷(briefing.ts)을 2~3분 분량의 한국어 낭독 대본으로.
 *
 * 인사·마무리는 고정 문구다. AI가 매번 다르게 쓰면 "오늘은 어떤 인사로 시작하나"가 흔들리고,
 * 날짜·요일을 틀릴 수도 있다. AI는 기사별 2~3문장만 쓴다.
 *
 * 사실은 제목·요약에 있는 것만 쓴다 — 음성은 되돌려 확인하기 어려워서, 틀린 숫자 하나가
 * 글보다 더 오래 남는다.
 */
import OpenAI from 'openai';
import type { BriefingHeadline, BriefingSnapshot } from '../sparkscope/briefing';
import { articleExcerpt } from './article-text';

const MODEL = 'gpt-4.1';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ScriptSegment {
  kind: 'intro' | 'item' | 'outro';
  text: string;
  /** item일 때 스냅샷 헤드라인 순번(0부터) */
  index?: number;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-09-30" → "9월 30일 수요일" */
export function spokenDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 ${wd}요일`;
}

/**
 * 섹션 전환 멘트 — "첫 번째 소식입니다" 순번 대신, 섹션이 바뀌는 첫 기사에만 붙인다(2026-10-07 소윤, 3분 개편안).
 * 섹션은 헤드라인 라벨로 정한다: 스파크랩 · 국내 포트폴리오 · 해외 포트폴리오(대만·글로벌) · AI · 스타트업계.
 */
type Section = 'S' | 'P' | 'O' | 'A' | 'T';
function sectionOf(h: BriefingHeadline): Section {
  if (/스파크랩/.test(h.label)) return 'S';
  if (/포트폴리오사 · (대만|글로벌)/.test(h.label)) return 'O';
  if (/포트폴리오/.test(h.label)) return 'P';
  if (/AI|트렌드|해외/.test(h.label) || h.kind === 'trend' || h.kind === 'inter') return 'A';
  return 'T';
}
const SECTION_LEAD: Record<Section, [string, string]> = {
  // [맨 처음일 때, 중간에 바뀔 때]
  S: ['먼저 스파크랩 소식입니다.', '스파크랩 소식입니다.'],
  P: ['먼저 포트폴리오 소식입니다.', '포트폴리오 소식입니다.'],
  O: ['먼저 해외 포트폴리오 소식입니다.', '해외 포트폴리오 소식도 있습니다.'],
  A: ['먼저 AI 쪽 소식입니다.', 'AI 쪽 소식입니다.'],
  T: ['먼저 스타트업계 소식입니다.', '스타트업계 소식입니다.'],
};
// 스파크랩과 국내 포트폴리오는 이어서 한 덩어리로 듣기 좋아서, 스파크랩 다음 국내 포폴은 "이어서 포트폴리오 소식입니다".

/**
 * 말투·구성 기준 — 2026-10-07 「3분 개편안」(소윤). 9/30 수정본 예시를 대체한다.
 * 요점: 상투적인 마무리("주목할 만합니다") 대신 "그래서 누구에게 무엇이 달라지나", 기사마다 숫자,
 * 중요도에 따라 길이를 다르게(핵심 2 · 표준 3 · 단신 3, 합계 약 3분).
 * 예시는 개편안 샘플에서 사실 확인이 필요한 부분을 뺀 것 — 내용이 아니라 구조를 참고하게 한다.
 */
const STYLE_EXAMPLE = `[핵심] 오픈AI가 새 모델을 공개했는데, 성능은 상위 모델 수준이면서 가격은 기존 모델의 절반입니다. 같은 주 앤트로픽도 더 낮은 가격의 새 모델을 내놨습니다. 두 회사가 같은 시기에 가격을 내렸다는 건 경쟁의 축이 성능에서 가격으로 옮겨가고 있다는 신호입니다. AI를 쓰는 포트폴리오사 입장에선 API 원가가 줄어 마진이 개선될 여지가 생기고, 반대로 모델 위에 기능만 얇게 얹은 서비스는 차별화 압박이 커집니다.
[표준] 위베어소프트는 티맥스소프트와 인증서 자동화 협력에 나섰습니다. 티맥스의 공공·금융 고객망이 그대로 위베어의 영업 채널이 된다는 점이 이번 협력의 핵심입니다.
[단신] ○○벤처스가 300억 원 규모의 신규 펀드를 결성했습니다.`;

const SYSTEM = `당신은 VC 스파크랩의 데일리 브리핑 작가입니다. 청자는 투자심사역과 파트너입니다.
기사마다 소리 내어 읽을 대본을 씁니다. 인사·마무리·섹션 전환 멘트(\"먼저 포트폴리오 소식입니다\" 등)는 따로 붙이니 쓰지 마세요.

[등급] 기사를 중요도에 따라 세 등급으로 나눕니다. 기사가 8개면 핵심 2 · 표준 3 · 단신 3, 적으면 비율대로 줄입니다(핵심은 최대 2).
 - 핵심(약 200자): ① 팩트+숫자(누가, 무엇을, 얼마에) → ② 맥락(왜 지금인가) → ③ 우리 시각(포트폴리오사·투자 테제·스타트업 생태계에 어떤 의미인지, 대상을 구체적으로) → ④ 변수(앞으로 지켜볼 것)
 - 표준(약 100자): 팩트+숫자 → 우리 시각 또는 변수 중 하나
 - 단신(약 55자): 숫자가 들어간 한 문장. 해석은 넣지 않습니다.
 - 핵심 기준: 포트폴리오사의 큰 이벤트(M&A·투자 유치·대형 계약), 또는 투자 테제에 직접 영향을 주는 시장 변화.
 - 전체 대본(모든 기사 합계)은 약 900~1,000자.

[필수]
 - 숫자(금액·지분·가격·비율·기간)는 원문에 있으면 반드시 넣습니다. 원문에 숫자가 없으면 그 기사는 단신이나 표준으로 내립니다.
 - 제목·요약·본문 발췌에 있는 사실만 씁니다. 숫자·이름·날짜·평가·원인을 지어내지 마세요. 본문 발췌가 없으면 제목·요약 범위 안에서만 씁니다.
 - 해석에는 반드시 "누구에게"를 밝힙니다(예: "포트폴리오사 입장에선 ~", "~라는 점에서 ○○에게 유리합니다").
 - 연관된 기사가 있으면 "앞 소식과 이어서 보면 ~" 식으로 한 문장 연결합니다.

[금지]
 - "주목할 만합니다", "주목됩니다", "의미가 있습니다", "기대됩니다", "~할 전망입니다"로 끝나는 해석 문장
 - 대상 없는 일반론("AI 활용 기회가 확장된다" 등)
 - 홍보성·과장·감탄 표현, 괄호·기호(귀로 듣는 대본)
 - "우리"라는 말 — 포트폴리오사는 "포트폴리오사 ○○"라고 부릅니다.

[톤] 전문적이지만 사람이 말하듯 자연스럽게. "~했습니다"로 모든 문장이 끝나지 않게 종결 표현을 섞습니다.

[표기] 고유명사는 공식 한글 표기(티맥스소프트, 앤트로픽, 오픈AI, 오퍼스). 영문 약어는 처음 나올 때 풀어 씁니다.
제목의 약칭 한자는 풀어서 씁니다(日증시 → 일본 증시, 美中 → 미국과 중국).

아래는 등급별 예시입니다. 내용이 아니라 구조·길이·해석 방식을 참고하세요.
${STYLE_EXAMPLE}

JSON으로만 답하세요: {"items":[{"index":0,"tier":"핵심|표준|단신","text":"..."}, ...]}`;

function describe(h: BriefingHeadline, i: number, body: string): string {
  const extra = h.companies?.length ? ` / 연결된 포트폴리오사: ${h.companies.join(', ')}` : '';
  return `${i}. [${h.label}] 제목: ${h.title} / 요약: ${h.summary} / 출처: ${h.source}${extra}${body ? `\n   본문 발췌: ${body}` : ''}`;
}

/** 인사·마무리 문구 — 데일리가 기본, 뉴스데스크(newsdesk.ts)는 자기 문구를 넘긴다. */
export interface ScriptFrame { intro: string; outro: string }

export async function writeBriefingScript(snapshot: BriefingSnapshot, frame?: ScriptFrame): Promise<ScriptSegment[]> {
  const heads = snapshot.headlines;
  // 숫자·맥락 재료 — 원문 본문 앞부분(article-text.ts). 못 읽으면 제목·요약만.
  const bodies = await Promise.all(heads.map(h => articleExcerpt(h.url)));
  const resp = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: heads.map((h, i) => describe(h, i, bodies[i])).join('\n') },
    ],
  });
  const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as { items?: { index: number; text: string }[] };
  const byIndex = new Map((parsed.items ?? []).map(it => [it.index, it.text.trim()]));

  const segments: ScriptSegment[] = [{
    kind: 'intro',
    text: frame?.intro ?? `좋은 아침입니다. ${spokenDate(snapshot.dateKey)}, 스파크스코프 데일리 브리핑입니다.`,
  }];
  let prev: Section | null = null;
  heads.forEach((h, i) => {
    // AI가 빠뜨린 항목은 요약으로라도 채운다 — 화면엔 있는데 말이 없는 슬라이드가 생기지 않게.
    const body = byIndex.get(i) || `${h.title}. ${h.summary}`;
    const sec = sectionOf(h);
    const lead = sec === prev ? '' : prev === 'S' && sec === 'P' ? '이어서 포트폴리오 소식입니다.' : SECTION_LEAD[sec][prev ? 1 : 0];
    prev = sec;
    segments.push({ kind: 'item', index: i, text: lead ? `${lead} ${body}` : body });
  });
  segments.push({
    kind: 'outro',
    text: frame?.outro ?? '오늘 준비한 브리핑은 여기까지입니다. 더 자세한 내용은 스파크스코프 대시보드에서 확인해 주세요!',
  });
  return segments;
}
