/**
 * 같은 사건을 다룬 기사 묶기 — 상위 후보만 LLM이 판정한다.
 *
 * 왜 필요한가: 원래는 제목의 단어 겹침으로 묶었다(4글자 이상 단어 3개 이상 겹치고
 * 짧은 쪽의 45% 이상). 매체마다 헤드라인 어휘가 달라 같은 사건이 안 묶인다.
 * 2026-09-08 실측:
 *
 *   "French AI company Mistral hits $24 billion valuation in funding round" (Reuters)
 *   "Mistral raises record €3bn as Europe strains to keep pace in AI"       (FT)
 *   → 겹치는 단어 1개(mistral), 비율 0.14 → 다른 사건으로 판정
 *
 * 유럽 최대 AI 조달인데 표가 셋으로 쪼개져 상위 12칸을 세 칸 먹고,
 * "여러 매체가 함께 다뤘다"는 중요도 신호도 생기지 않았다.
 *
 * ⚠️ 제목 임베딩 코사인으로 먼저 시도했고, 안 된다는 것을 실측으로 확인했다.
 *    text-embedding-3-small(512차원) 기준:
 *
 *      붙어야 함   0.597  "Introducing GPT-6 Astra" ↔ "OpenAI begins rolling out Astra model"
 *                  0.623  Mistral $24bn ↔ Mistral €3bn
 *                  0.804  "Introducing GPT-6 Astra" ↔ "GPT‑6 Astra"
 *      떨어져야 함  0.616  "Astra 출시" ↔ "OpenAI, 사이버방어에 10억 달러"
 *                  0.500  "OpenAI 피소" ↔ "OpenAI 사이버 투자"
 *
 *    떨어져야 하는 쌍(0.616)이 붙어야 하는 쌍(0.597)보다 높다. 두 분포가 겹치므로
 *    임계값을 어디에 둬도 한쪽은 틀린다 — 둘 다 "OpenAI가 큰일을 했다"라서
 *    제목만으로는 사건 단위 구분이 안 된다.
 *
 * 그래서 LLM에게 직접 묻는다. "이 헤드라인들이 같은 사건인가"는 사람이 쉽게 하는
 * 판단이고 모델도 잘한다. 대신 후보 전체(100건 이상)에 쓰면 비싸고 부정확하므로,
 * 중요도 상위 몇십 건 — 실제로 화면·메일에 들어갈 것들 — 에만 적용한다.
 */
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const MODEL = 'gpt-4o-mini';

const SYSTEM = [
  '뉴스 헤드라인 목록을 보고 같은 사건을 다룬 것끼리 묶습니다.',
  '',
  '같은 사건의 기준:',
  '- 같은 회사의 같은 발표·거래·소송·출시를 다룬 것. 표현이 달라도 같은 사건입니다.',
  '  예: "Mistral hits $24 billion valuation" 과 "Mistral raises record €3bn" → 같은 사건',
  '  예: "Introducing GPT-6 Astra" 와 "OpenAI begins rolling out Astra model" → 같은 사건',
  '',
  '다른 사건의 기준:',
  '- 같은 회사라도 사안이 다르면 다른 사건입니다.',
  '  예: "OpenAI가 피소됐다" 와 "OpenAI가 사이버방어에 투자한다" → 다른 사건',
  '  예: "구글이 모델을 냈다" 와 "구글이 데이터센터를 짓는다" → 다른 사건',
  '- 같은 분야의 다른 회사 이야기는 다른 사건입니다.',
  '- 애매하면 묶지 않습니다. 잘못 묶으면 서로 다른 소식이 하나로 사라집니다.',
  '',
  '출력은 JSON 객체 하나입니다: {"groups":[[0,4],[1],[2,7,9], ...]}',
  '- 각 배열이 하나의 사건이고, 숫자는 입력에 준 번호입니다.',
  '- 모든 번호가 정확히 한 번씩 나타나야 합니다. 혼자인 것도 [3]처럼 배열로 넣습니다.',
].join('\n');

/**
 * @param items 대표 제목 목록(순서 유지)
 * @returns 같은 사건끼리 묶은 인덱스 배열. 실패하면 전부 홀로 둔다 —
 *          병합에 실패해서 중복이 보이는 것이, 잘못 병합해서 소식이 사라지는 것보다 낫다.
 */
export async function groupSameStory(items: { title: string }[]): Promise<number[][]> {
  const alone = () => items.map((_, i) => [i]);
  if (items.length <= 1) return alone();

  const listing = items.map((it, i) => `${i}. ${it.title}`).join('\n');
  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: listing }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { groups?: number[][] };
    const groups = parsed.groups;
    if (!Array.isArray(groups)) return alone();

    // 응답을 그대로 믿지 않는다 — 번호가 빠지거나 중복되면 기사가 사라지거나 두 번 나온다.
    const seen = new Set<number>();
    const out: number[][] = [];
    for (const g of groups) {
      const clean = (Array.isArray(g) ? g : [])
        .filter(n => Number.isInteger(n) && n >= 0 && n < items.length && !seen.has(n));
      clean.forEach(n => seen.add(n));
      if (clean.length > 0) out.push(clean);
    }
    // 빠뜨린 번호는 홀로 추가한다.
    for (let i = 0; i < items.length; i++) if (!seen.has(i)) out.push([i]);
    return out;
  } catch (e) {
    console.error('[news-cluster] 사건 묶기 실패 — 병합 없이 진행합니다:', e);
    return alone();
  }
}
