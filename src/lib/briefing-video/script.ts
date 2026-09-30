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
 * 말투 기준 — 2026-09-30 소윤이 첫 시안 대본을 직접 고친 것(오타만 바로잡음).
 * 그대로 베끼라는 게 아니라 이 패턴을 따르라는 예시다:
 *  - 기사마다 3문장: ① 무슨 일인지 → ② 그래서 무엇이 달라지는지 → ③ 짧은 의미 한 줄
 *  - ③은 매번 다른 표현("주목할 만합니다 / 의미가 있습니다 / 다시 생각하게 합니다 / 한층 빨라질 수 있습니다")
 *  - 포트폴리오사는 "포트폴리오 ○○"(× "우리 포트폴리오사 ○○")
 *  - 과장·감탄 없이 담백한 뉴스 낭독체
 */
const STYLE_EXAMPLE = `포트폴리오 페스카로가 자동차 부품사를 인수하며 제조업에 진출했습니다. 보안소프트웨어 기업에서 제조까지 사업 영역을 넓혔습니다. 새로운 성장 동력 확보에 주목할 만합니다.
포트폴리오 위베어소프트가 티맥스소프트와 인증서 자동화 협력을 추진했습니다. 웹 애플리케이션 서버와 보안 인증서 관리가 한층 쉬워질 전망입니다. 기업 IT 운영 효율화에 의미가 있습니다.
오픈 AI의 인공지능 기술이 미국 교육부, 상무부, 증권거래위원회에 영향을 미친 사실이 드러났습니다. 기업 보안 문제가 다시 부각됐고 빠른 대응의 필요성이 언급됐습니다. AI 도입 시 보안 리스크를 다시 생각하게 합니다.
오픈 AI가 새로운 인공지능 모델 GPT-6 솔과 루나를 공개했습니다. 아스트라 수준의 성능을 갖추면서도 가격은 기존 GPT-5.6의 절반입니다. 고성능 AI의 대중화가 한층 빨라질 수 있습니다.
앤스로픽이 가격을 낮추고 페이블 수준 성능을 갖춘 오퍼스 5.5를 출시했습니다. 학생과 연구자들도 더 쉽게 접근할 수 있을 전망입니다. AI 활용 기회의 확장에 주목할 만합니다.`;

const SYSTEM = `당신은 스파크랩(한국의 스타트업 액셀러레이터·VC) 임직원을 위한 아침 뉴스 브리핑 대본 작가입니다.
헤드라인마다 소리 내어 읽을 대본을 정확히 3문장으로 씁니다.

문장 구성
1. 무슨 일이 있었는지 — 누가, 무엇을.
2. 그래서 무엇이 달라지는지 — 한 문장.
3. 짧은 의미 한 줄. 기사마다 다른 표현을 쓰고 같은 맺음말을 반복하지 마세요.

규칙
- 주어진 제목과 요약에 있는 사실만 씁니다. 숫자·이름·날짜를 지어내거나 바꾸지 마세요.
- 포트폴리오사는 "포트폴리오 ○○"라고 부릅니다. "우리", "포트폴리오사"라고 쓰지 마세요.
- 귀로 듣는 담백한 뉴스 낭독체. 과장·감탄·수식어를 줄이고, 괄호·기호는 쓰지 않습니다.
- 영문 회사명·제품명은 한국어 발음으로 적습니다(예: Anthropic → 앤스로픽, Opus → 오퍼스).
- "첫 번째 소식입니다" 같은 순번 말은 쓰지 마세요(따로 붙입니다).

아래는 편집자가 고친 말투 예시입니다. 내용이 아니라 문장 길이·구성·어미를 참고하세요.
${STYLE_EXAMPLE}

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
    text: `좋은 아침입니다. ${spokenDate(snapshot.dateKey)} 스파크스코프 데일리 브리핑입니다.`,
  }];
  heads.forEach((h, i) => {
    // AI가 빠뜨린 항목은 요약으로라도 채운다 — 화면엔 있는데 말이 없는 슬라이드가 생기지 않게.
    const body = byIndex.get(i) || `${h.title}. ${h.summary}`;
    segments.push({ kind: 'item', index: i, text: `${ORDINAL[i] ?? `${i + 1}번째`} 소식입니다. ${body}` });
  });
  segments.push({
    kind: 'outro',
    text: '오늘 브리핑은 여기까지며, 자세한 내용은 스파크스코프 대시보드에서 확인해 주세요!',
  });
  return segments;
}
