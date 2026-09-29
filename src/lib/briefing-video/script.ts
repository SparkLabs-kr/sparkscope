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

const SYSTEM = `당신은 스파크랩(한국의 스타트업 액셀러레이터·VC) 임직원을 위한 아침 뉴스 브리핑 대본 작가입니다.
헤드라인마다 소리 내어 읽을 대본을 2~3문장, 120~180자로 씁니다.

규칙
- 주어진 제목과 요약에 있는 사실만 씁니다. 숫자·이름·날짜를 지어내거나 바꾸지 마세요.
- 귀로 듣는 문장입니다. 짧게, 주어와 서술어를 분명히. 괄호·기호·영문 약어 나열은 피합니다.
- 영문 회사명·제품명은 한국어 발음으로 적습니다(예: OpenAI → 오픈AI, Anthropic → 앤스로픽).
- 스파크랩·포트폴리오사 소식이면 "우리 포트폴리오사 ○○" 처럼 우리와의 관계를 한 번 짚습니다.
- 마지막 문장은 왜 주목할 만한지 한 줄. 과장하지 않습니다.
- "첫 번째 소식입니다" 같은 순번 말은 쓰지 마세요(따로 붙입니다).

JSON으로만 답하세요: {"items":[{"index":0,"text":"..."}, ...]}`;

function describe(h: BriefingHeadline, i: number): string {
  const extra = h.companies?.length ? ` / 연결된 포트폴리오사: ${h.companies.join(', ')}` : '';
  return `${i}. [${h.label}] 제목: ${h.title} / 요약: ${h.summary} / 출처: ${h.source}${extra}`;
}

export async function writeBriefingScript(snapshot: BriefingSnapshot): Promise<ScriptSegment[]> {
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
    text: `좋은 아침입니다. ${spokenDate(snapshot.dateKey)}, 스파크스코프 데일리 브리핑입니다. 오늘은 ${heads.length}개 소식을 전해 드립니다.`,
  }];
  heads.forEach((h, i) => {
    // AI가 빠뜨린 항목은 요약으로라도 채운다 — 화면엔 있는데 말이 없는 슬라이드가 생기지 않게.
    const body = byIndex.get(i) || `${h.title}. ${h.summary}`;
    segments.push({ kind: 'item', index: i, text: `${ORDINAL[i] ?? `${i + 1}번째`} 소식입니다. ${body}` });
  });
  segments.push({
    kind: 'outro',
    text: '오늘 브리핑은 여기까지입니다. 자세한 내용은 스파크스코프에서 확인하세요. 좋은 하루 보내세요.',
  });
  return segments;
}
