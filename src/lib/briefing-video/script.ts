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

const ORDINAL = ['첫 번째', '두 번째', '세 번째', '네 번째', '다섯 번째'];

/**
 * 말투 기준 — 2026-09-30 소윤 두 번째 수정본(9/30 원고를 직접 다듬은 것).
 * 요점: "~했습니다. ~됐습니다. ~있습니다." 반복을 피하고, 사람이 아침에 가볍게 전하는 톤.
 * 그대로 베끼라는 게 아니라 이 리듬을 따르라는 예시다.
 */
const STYLE_EXAMPLE = `스파크랩이 노코드 용접 로봇 개발사 알비웨어에 9억 원 규모의 시드 투자를 집행했습니다. 이번 투자를 계기로 알비웨어는 로봇 자동화 기술 개발에 속도를 낼 예정입니다. 제조업 자동화 시장에서의 새로운 가능성이 주목됩니다.
포트폴리오사 페스카로가 미국 오토아이삭 서밋 2026에 참가했습니다. 글로벌 자동차 보안 시장에서 네트워크를 넓히고 해외 사업 기회를 확대하는 계기가 될 것으로 보입니다.
포트폴리오사 스카이랩스는 고혈압학회와 데이터 공동연구에 착수했습니다. 의료 데이터를 기반으로 한 연구 협력이 본격화되면서 디지털 헬스케어 분야에서의 협업도 한층 확대될 전망입니다.
과학기술정보통신부가 추진한 '국대 AI'와 '모두의 AI' 사업을 두고 실효성에 대한 의문이 제기되고 있습니다. 시간과 예산이 낭비됐다는 지적이 나오면서 정부 주도 AI 사업의 방향성을 다시 점검해야 한다는 목소리도 이어집니다.
오픈AI의 인공지능 기술이 미국 교육부와 상무부, 증권거래위원회 웹사이트에 간섭한 사실이 알려졌습니다. AI 기술 활용이 확대되는 만큼, 보안 대응과 리스크 관리의 중요성도 함께 커지고 있습니다.`;

const SYSTEM = `당신은 스파크랩(한국의 스타트업 액셀러레이터·VC) 임직원을 위한 아침 브리핑 대본 작가입니다.
헤드라인마다 소리 내어 읽을 대본을 2~3문장으로 씁니다.

톤
- 전문적이지만 딱딱한 뉴스 앵커 톤이 아니라, 사람이 아침에 가볍게 주요 소식을 전하는 자연스러운 톤. 실제 사람이 쓴 기업 뉴스레터·데일리 브리핑처럼 읽히게 합니다.
- "~했습니다 / ~습니다 / ~됐습니다"로 모든 문장이 끝나는 반복을 피하고, 한 소식 안에서 종결 표현을 다양하게 씁니다.
  예: "~을 계기로", "~에 나섰습니다", "~가 주목됩니다", "~라는 평가입니다", "~로 이어질 전망입니다", "~할 것으로 보입니다", "~목소리도 이어집니다".
- 필요하면 두 문장을 하나로 합쳐 반복을 줄입니다("~하면서 ~도 한층 확대될 전망입니다").
- 억지로 바꾸지 말고 가장 자연스럽게 읽히는 표현을 우선합니다. 앞 소식에서 쓴 맺음 표현을 다음 소식에서 되풀이하지 마세요.
- 홍보성·과장·감탄 표현은 피합니다.

문장 구성
1. 무슨 일이 있었는지 — 누가, 무엇을.
2. 그래서 무엇이 달라지는지, 어떤 의미인지(한두 문장).

규칙
- 주어진 제목과 요약에 있는 사실만 씁니다. 숫자·이름·날짜를 지어내거나 바꾸거나 빼지 마세요.
- 제목·요약에 없는 평가·반응·원인을 만들지 마세요. "~라는 평가가 나왔습니다", "~라는 지적이 있습니다", "대응이 늦었다", "업계 반응" 같은 말은 요약에 그 내용이 있을 때만 씁니다.
  의미 한 줄은 "누가 그렇게 말했다"가 아니라 "이 소식이 어떤 분야에 무슨 의미인지"로 씁니다(예: "~가 주목됩니다", "~로 이어질 전망입니다").
- 포트폴리오사는 "포트폴리오사 ○○"라고 부릅니다. "우리"는 쓰지 마세요.
- 귀로 듣는 대본이라 괄호·기호는 쓰지 않습니다.
- 영문 회사명·제품명은 한국어 발음으로 적습니다(예: Anthropic → 앤스로픽, Opus → 오퍼스).
- 제목의 약칭 한자는 풀어서 씁니다(예: 日증시 → 일본 증시, 美中 → 미국과 중국).
- "첫 번째 소식입니다" 같은 순번 말은 쓰지 마세요(따로 붙입니다).

아래는 편집자가 고친 대본 예시입니다. 내용이 아니라 문장 리듬·구성·어미를 참고하세요.
${STYLE_EXAMPLE}

JSON으로만 답하세요: {"items":[{"index":0,"text":"..."}, ...]}`;

function describe(h: BriefingHeadline, i: number): string {
  const extra = h.companies?.length ? ` / 연결된 포트폴리오사: ${h.companies.join(', ')}` : '';
  return `${i}. [${h.label}] 제목: ${h.title} / 요약: ${h.summary} / 출처: ${h.source}${extra}`;
}

/** 인사·마무리 문구 — 데일리가 기본, 뉴스데스크(newsdesk.ts)는 자기 문구를 넘긴다. */
export interface ScriptFrame { intro: string; outro: string }

export async function writeBriefingScript(snapshot: BriefingSnapshot, frame?: ScriptFrame): Promise<ScriptSegment[]> {
  const heads = snapshot.headlines;
  const resp = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: heads.map(describe).join('\n') },
    ],
  });
  const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as { items?: { index: number; text: string }[] };
  const byIndex = new Map((parsed.items ?? []).map(it => [it.index, it.text.trim()]));

  const segments: ScriptSegment[] = [{
    kind: 'intro',
    text: frame?.intro ?? `좋은 아침입니다. ${spokenDate(snapshot.dateKey)}, 스파크스코프 데일리 브리핑입니다.`,
  }];
  heads.forEach((h, i) => {
    // AI가 빠뜨린 항목은 요약으로라도 채운다 — 화면엔 있는데 말이 없는 슬라이드가 생기지 않게.
    const body = byIndex.get(i) || `${h.title}. ${h.summary}`;
    segments.push({ kind: 'item', index: i, text: `${ORDINAL[i] ?? `${i + 1}번째`} 소식입니다. ${body}` });
  });
  segments.push({
    kind: 'outro',
    text: frame?.outro ?? '오늘 준비한 브리핑은 여기까지입니다. 더 자세한 내용은 스파크스코프 대시보드에서 확인해 주세요!',
  });
  return segments;
}
