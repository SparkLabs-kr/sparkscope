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
  '항목에 "(발췌: ...)"가 붙어 있으면 그것도 함께 보고 판단합니다 —',
  '제목만으로는 같은 사건인지 알 수 없는 경우가 많습니다.',
  '',
  '같은 사건의 기준:',
  '- 같은 회사의 같은 발표·거래·소송·출시를 다룬 것. 표현이 달라도 같은 사건입니다.',
  '  예: "Mistral hits $24 billion valuation" 과 "Mistral raises record €3bn" → 같은 사건',
  '  예: "Introducing GPT-6 Astra" 와 "OpenAI begins rolling out Astra model" → 같은 사건',
  '- 제목이 서로 완전히 달라도 발췌가 같은 일을 말하면 같은 사건입니다.',
  '  예: "On the Navier–Stokes Millennium Prize Problem" 과',
  '      "Drama swirls around OpenAI\'s legendary mathematical milestone" 과',
  '      "오픈AI, 수학계 난제 해결 발표" → 셋 다 같은 사건',
  '',
  '다른 사건의 기준:',
  '- 같은 회사라도 사안이 다르면 다른 사건입니다.',
  '  예: "OpenAI가 피소됐다" 와 "OpenAI가 사이버방어에 투자한다" → 다른 사건',
  '  예: "구글이 모델을 냈다" 와 "구글이 데이터센터를 짓는다" → 다른 사건',
  '  예: "구글, 제미나이 3.8 플래시 공개" 와 "구글, 웨더넥스트 3 공개" → 다른 사건',
  '      (같은 회사가 같은 날 낸 발표라도 제품이 다르면 다른 사건입니다)',
  '- 같은 제품·모델 이름이 양쪽에 나와도, 벌어진 일이 다르면 다른 사건입니다.',
  '  제품 이름은 사건이 아니라 등장인물입니다. 이걸 특히 조심하세요.',
  '  예: "오픈AI, GPT-6 아스트라 공개" 와',
  '      "오픈AI, 개발자에게 GPT-6 아스트라용 Codex 프롬프트를 줄이라고 안내" 와',
  '      "GPT-6 아스트라 Max, 코드 아레나 웹개발 1위" 와',
  '      "오픈AI, GPT-6 기반 금융 특화 챗GPT 공개" → 넷 다 다른 사건',
  '      (모델 공개 · 사용법 안내 · 벤치마크 순위 · 그 모델로 만든 신제품)',
  '  예: "구글, 제미나이 3.8 플래시 공개" 와 "구글, 제미나이 옴니 1.1 플래시 공개"',
  '      → 다른 사건 (이름이 비슷한 다른 모델입니다)',
  '- 같은 분야의 다른 회사 이야기는 다른 사건입니다.',
  '- 비슷한 종류의 성과라도 주인공이나 대상이 다르면 다른 사건입니다. 이걸 특히 조심하세요.',
  '  예: "오픈AI가 나비에-스토크스 난제를 풀었다" 와',
  '      "앤트로픽 클로드가 페르마의 마지막 정리를 검증했다" → 다른 사건',
  '      (둘 다 "AI가 수학 난제를 해결"이지만 회사도 문제도 다릅니다)',
  '- 애매하면 묶지 않습니다. 잘못 묶으면 서로 다른 소식이 하나로 사라집니다.',
  '',
  '묶기 전에 스스로 확인하세요: 이 묶음을 한 문장으로 "누가 무엇을 했다"라고 말할 수',
  '있습니까? 두 문장이 필요하면 두 사건입니다. 회사 이름이나 모델 이름이 같다는 것은',
  '확인이 되지 않습니다 — 같은 회사가 하루에 여러 발표를 합니다.',
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
/**
 * 발췌를 판단에 쓸 수 있는 모양으로 다듬는다.
 *
 * 두 가지를 반드시 해야 한다(둘 다 실측으로 걸렸다, 2026-09-09):
 *
 * ① 엔티티를 먼저 푼다. 일부 피드는 본문을 이스케이프한 HTML로 싣는다 —
 *    Simon Willison의 발췌는 "&lt;p&gt;&lt;strong&gt;&lt;a href=..."로 시작하는
 *    7,900자였다. 태그를 지우는 것만으로는 지워지지 않는다(아직 태그가 아니다).
 *    그대로 넘기면 앞부분이 전부 마크업이라 무슨 글인지 알 수 없다.
 *
 * ② 넉넉히 남긴다. 200자로 자르던 때 AI타임스 기사에서 "나비에-스토크스"가
 *    딱 그 뒤에 있어서 잘려 나갔고, 같은 사건이 안 묶였다.
 */
const HINT_CHARS = 400;

function cleanHint(raw?: string | null): string {
  if (!raw) return '';
  return raw
    // ① 이스케이프를 먼저 푼다. 그래야 아래 태그 제거가 실제로 태그를 지운다.
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ')
    // URL은 사건을 알아보는 데 도움이 안 되고 자릿수만 먹는다.
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HINT_CHARS);
}

export async function groupSameStory(
  items: { title: string; hint?: string | null }[],
): Promise<number[][]> {
  const alone = () => items.map((_, i) => [i]);
  if (items.length <= 1) return alone();

  // 제목만으로는 안 묶이는 경우가 있어 발췌를 한 줄 함께 넘긴다.
  //
  // 실측(2026-09-09): 오픈AI가 나비에–스토크스 난제를 풀었다는 같은 사건을 세 매체가
  // 각각 이렇게 썼다 —
  //   Simon Willison  "On the Navier–Stokes Millennium Prize Problem"
  //   The Verge       "Drama swirls around OpenAI's legendary mathematical milestone"
  //   AI타임스         "오픈AI, 수학계 난제 해결 발표...NYU·앤트로픽과 '표절' 공방"
  // 공통 단어가 하나도 없다. Verge 제목에는 난제 이름도 회사 이름도 없고, Simon
  // 제목에는 회사 이름이 없다. 그래서 셋이 따로 놀았고 "함께 보도한 매체 0곳"으로
  // 8위에 머물렀다. 발췌가 있으면 무엇에 관한 글인지 드러나 묶인다.
  //
  const listing = items.map((it, i) => {
    const hint = cleanHint(it.hint);
    return hint ? `${i}. ${it.title}\n   (발췌: ${hint})` : `${i}. ${it.title}`;
  }).join('\n');
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
    return verifyGroups(out, items);
  } catch (e) {
    console.error('[news-cluster] 사건 묶기 실패 — 병합 없이 진행합니다:', e);
    return alone();
  }
}

/**
 * 묶음을 하나씩 다시 물어 확인한다 — 긴 목록에서 생기는 과병합을 잡는다.
 *
 * 왜 필요한가: 같은 프롬프트라도 30~40건을 한꺼번에 주면 같은 회사 소식을 뭉친다.
 * 2026-09-14 실측 — "GPT-6 아스트라 공개" · "개발자에게 Codex 프롬프트를 줄이라고
 * 안내" · "아스트라 Max 코드 아레나 1위" · "금융 특화 챗GPT 공개"가 한 묶음이 됐고,
 * 그 결과 1위 카드에 남의 기사 '원문 보기' 링크가 달려 나갔다. 그런데 **그 네 건만
 * 따로 물으면 넷으로 정확히 갈라낸다.** 짧은 목록에서는 모델이 틀리지 않는다.
 *
 * 그래서 1차 결과의 각 묶음을 그 묶음만 떼어 다시 묻는다. 호출은 작고(보통 2~4건)
 * 묶음 수만큼만 늘며, 방향이 한쪽이다 — 쪼개기만 하고 새로 붙이지 않는다. 반대로
 * "더 붙일 것이 없는지" 다시 묻는 방식은 2026-09-11에 넣었다가 엉뚱한 기사를 붙여서
 * 뺐다(news-digest.ts 주석 참고). 놓치면 두 줄로 보일 뿐이지만 잘못 붙이면 거짓이 된다.
 */
async function verifyGroups(
  groups: number[][], items: { title: string; hint?: string | null }[],
): Promise<number[][]> {
  const multi = groups.filter(g => g.length > 1);
  if (multi.length === 0) return groups;

  const split = await Promise.all(multi.map(async g => {
    // 확인 단계에는 발췌를 넣지 않는다 — 제목만 준다.
    //
    // 발췌는 묶을 때 필요하다(표현이 다른 같은 사건을 찾아낸다). 그런데 쪼갤 때는
    // 오히려 방해가 된다. 같은 회사 기사의 본문은 서로 같은 제품·같은 배경을 길게
    // 설명해서 "같은 얘기"처럼 보이게 만든다. 2026-09-14 실측 — 발췌를 함께 주면
    // 'Codex 프롬프트 안내'·'금융 특화 챗GPT'·'코드 아레나 1위'가 한 묶음으로
    // 남았고, 제목만 주면 셋으로 갈라졌다. 제미나이 3.8 vs 제미나이 옴니 1.1도 같다.
    // 순서를 바꿔 두 번 묻고 더 잘게 쪼갠 쪽을 택한다.
    //
    // 온도가 0이어도 항목 순서가 바뀌면 판정이 달라진다 — 앞에 놓인 것을 기준으로
    // 나머지를 견주기 때문이다. 방향이 한쪽으로만 틀리는 문제(과병합)이므로 둘 중
    // 더 쪼갠 쪽을 믿는다. 틀려서 더 쪼개면 같은 사건이 두 줄로 보일 뿐이고,
    // 덜 쪼개면 1위 카드에 남의 기사 링크가 달린다.
    const ask = async (order: number[]) => {
      const listing = order.map((n, k) => `${k}. ${items[n].title}`).join('\n');
      const res = await client().chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: listing }],
        temperature: 0,
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { groups?: number[][] };
      if (!Array.isArray(parsed.groups)) return [order];
      const seen = new Set<number>();
      const out: number[][] = [];
      for (const sub of parsed.groups) {
        const clean = (Array.isArray(sub) ? sub : [])
          .filter(k => Number.isInteger(k) && k >= 0 && k < order.length && !seen.has(k));
        clean.forEach(k => seen.add(k));
        if (clean.length > 0) out.push(clean.map(k => order[k]));
      }
      for (let k = 0; k < order.length; k++) if (!seen.has(k)) out.push([order[k]]);
      return out;
    };
    try {
      const [a, b] = await Promise.all([ask(g), ask([...g].reverse())]);
      return (b.length > a.length ? b : a).flatMap(sub => splitByVersion(sub, items));
    } catch (e) {
      console.error('[news-cluster] 묶음 확인 실패(1차 결과 유지):', e);
      return [g];
    }
  }));

  const before = multi.length;
  const after = split.flat().length;
  if (after > before) console.log(`[news-cluster] 확인 단계에서 ${after - before}개 묶음을 쪼갰습니다`);
  return [...groups.filter(g => g.length === 1), ...split.flat()];
}

/**
 * 버전 번호가 서로 다르면 다른 발표로 본다 — 모델이 끝내 못 가르는 한 가지를 기계가 맡는다.
 *
 * 2026-09-14 실측: "구글, 제미나이 3.8 플래시 공개"와 "Google、動画生成AI「Gemini Omni
 * 1.1 Flash」公開"가 확인 단계를 두 번 거쳐도 한 묶음으로 남았다. 한국어와 일본어라
 * 겹치는 글자가 없고 모델에게는 둘 다 "구글이 플래시 모델을 공개했다"로 보인다.
 * 그런데 사람 눈에는 3.8과 1.1이 다르다는 것이 곧바로 보인다.
 *
 * 그래서 좁게 적용한다 — 양쪽 제목에 버전 번호(1.1·3.8 같은 소수점 숫자)가 **둘 다**
 * 있고 서로 하나도 겹치지 않을 때만 가른다. 한쪽에만 있으면 건드리지 않는다
 * (예: Verge "up to 45 percent cheaper"에는 없고 ITmedia "Claude Fable 5.1"에는
 * 있는데, 둘은 같은 발표다). 금액·지분율은 소수점을 잘 쓰지 않아 걸리지 않는다
 * (Mistral "$24 billion" ↔ "€3bn"은 그대로 묶인다 — 확인함).
 */
export function versionSet(title: string): Set<string> {
  const out = new Set<string>();
  // 'N.N' 형태만 보되 돈·비율은 뺀다 — 금액에도 소수점이 흔하다.
  // ("Nvidia Buys Hugging Face in $12.9 Billion Deal"과 "約1.9兆円"을 버전으로
  //  읽고 같은 인수 기사를 갈라 버린 적이 있다. 2026-09-14)
  const re = /(?<![\d.])(?<![$€£¥₩])\d{1,2}\.\d{1,2}(?![\d.])(?!\s*(?:%|percent|퍼센트|billion|million|trillion|bn|배|점|조|억|兆|億|원|달러))/gi;
  for (const m of title.match(re) ?? []) out.add(m);
  return out;
}
function splitByVersion(group: number[], items: { title: string }[]): number[][] {
  if (group.length < 2) return [group];
  const sets = group.map(n => versionSet(items[n].title));
  const buckets: { key: string; members: number[] }[] = [];
  for (const [k, n] of group.entries()) {
    const v = [...sets[k]].sort().join(',');
    // 버전이 없는 항목은 가르는 근거가 되지 못한다 — 첫 묶음에 딸려 둔다.
    const target = v === ''
      ? buckets[0] ?? null
      : buckets.find(b => b.key === '' || b.key === v || [...sets[k]].some(x => b.key.split(',').includes(x))) ?? null;
    if (target) { target.members.push(n); if (target.key === '' && v !== '') target.key = v; }
    else buckets.push({ key: v, members: [n] });
  }
  return buckets.length > 1 ? buckets.map(b => b.members) : [group];
}

/** 두 제목이 서로 다른 버전 번호를 달고 있는가 — 양쪽에 다 있고 하나도 안 겹칠 때만 true. */
export function differentVersions(a: string, b: string): boolean {
  const va = versionSet(a), vb = versionSet(b);
  if (va.size === 0 || vb.size === 0) return false;
  for (const x of va) if (vb.has(x)) return false;
  return true;
}
