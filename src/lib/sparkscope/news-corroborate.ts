/**
 * 한 매체만 다룬 기사에, 같은 사건을 다룬 다른 매체를 찾아 붙인다.
 *
 * 왜 필요한가 — 목록에 올릴 기사인데 "함께 보도한 매체"가 0곳인 경우가 절반을 넘는다
 * (2026-09-09 실측: AI 상위 12건 중 8건). 우리 피드 목록이 유한하고 RSS 창이 좁아서
 * 같은 사건을 다른 매체가 썼는데도 우리 후보 풀에 안 들어온 것이다. 어차피 화면에
 * 올릴 기사라면 다른 매체의 원문도 함께 주는 편이 읽는 사람에게 낫다.
 *
 * 방법: 구글 뉴스 검색 RSS에 제목을 그대로 넣는다. 같은 사건을 다룬 기사를 모으는
 * 일은 구글이 우리보다 잘하고, 무료이며 레이트리밋도 넉넉하다.
 *
 * ── 오탐을 막는 두 겹 ──
 * 검색 결과를 그대로 붙이면 "관련 기사"가 아니라 "제목이 비슷한 아무 기사"가 붙는다.
 * 그래서 두 가지를 확인한다.
 *  ① 제목의 특징 단어가 충분히 겹치는지(아래 overlaps). 구글이 골라 준 것이라도
 *     같은 주제의 다른 사건일 수 있다.
 *  ② 이미 우리가 아는 매체와 같은 곳이 아닌지. 같은 매체를 "함께 보도"로 세면
 *     매체 수가 부풀려진다.
 *
 * 붙인 것은 alsoIn에만 들어간다 — 대표 기사·요약·중요도는 건드리지 않는다.
 * 순위에 쓰이는 alsoIn.length가 늘어나는 것은 의도한 것이다: 실제로 여러 매체가
 * 다룬 사건이면 그만큼 위로 가는 것이 맞다.
 */
import type { DigestItem } from './news-digest';

/**
 * 우리가 추적하는 매체로만 한정하는 방법은 시도했다가 버렸다(2026-09-09).
 *
 * 구글이 "Alabama Political Reporter"·"LatestLY" 같은 곳을 돌려주는 게 거슬려서
 * FEEDS 목록에 있는 매체만 받게 해 봤는데, 수확이 0으로 붕괴했다 — AI 단독 보도
 * 7건 중 0건, 바이오 10건 중 1건. 당연한 결과였다: 우리 목록은 이미 긁은 풀이라
 * 구글이 거기서 새로 찾아 줄 것이 거의 없다. 붙는 것은 대부분 우리 목록 밖의
 * 매체다(인공지능신문·디지털투데이·포춘코리아처럼 멀쩡한 곳들이다).
 *
 * 그래서 열어 두고, 확실히 걸러낼 수 있는 것만 막는다 — 도메인이 이름 자리에 온
 * 경우(looksLikeDomain)와 이미 아는 매체(samePublisher). 그 대가로 이따금
 * 재게시 사이트가 섞인다. 목록을 손으로 관리하는 대신 그 편을 택했다.
 */

/** 검색은 목록에 실제로 올라가는 것만 한다 — 후보 전체에 하면 낭비다. */
const MAX_ITEMS = 12;
/** 한 기사에 붙일 최대 매체 수. 너무 많으면 화면이 링크 줄로 덮인다. */
const MAX_ADDED = 3;

/** 한국어 제목인가. 검색 로케일과 비교 문턱을 가르는 기준이다. */
const isKorean = (s: string) => /[가-힣]/.test(s);

/**
 * 검색 로케일을 제목의 언어에 맞춘다.
 *
 * 처음에는 전부 영어(hl=en-US)로 던졌는데, 한국어 제목으로 영어 검색을 하니 결과가
 * 영어 기사로 와서 단어가 하나도 겹치지 않았다 — 단독 보도 6건 중 1건만 붙었다
 * (2026-09-09). 한국어 제목은 한국어로 찾아야 같은 사건이 나온다.
 */
const localeFor = (title: string) =>
  isKorean(title)
    ? { hl: 'ko', gl: 'KR', ceid: 'KR:ko' }
    : { hl: 'en-US', gl: 'US', ceid: 'US:en' };

/**
 * 구글 뉴스 검색어. 제목을 그대로 넣되 따옴표는 뺀다 —
 * 완전 일치로 묶으면 다른 매체가 다르게 쓴 제목을 못 찾는다.
 */
function queryFor(title: string): string {
  // 제목이 길면 앞쪽만 쓴다. 뒤쪽의 부제·인용은 매체마다 달라서 검색을 좁히기만 한다.
  const head = title.replace(/["'`“”‘’]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  return `${head} when:14d`;
}

/** 제목에서 비교에 쓸 특징 단어. 짧은 낱말과 흔한 기능어는 버린다. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'that', 'this', 'says', 'said',
  'will', 'has', 'have', 'its', 'his', 'her', 'their', 'new', 'more', 'than', 'over', 'after',
  'into', 'about', 'amid', 'could', 'would', 'may', 'can', 'not', 'you', 'your', 'how', 'why',
]);

function tokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9가-힣]+/)) {
    // 한국어는 낱말이 짧고(구글·오픈AI) 조사가 붙어 붙임 단위가 크다 —
    // 영어와 같은 3자 문턱을 걸면 회사 이름부터 걸러진다.
    const min = /[가-힣]/.test(raw) ? 2 : 3;
    if (raw.length < min || STOP.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * 같은 사건이라고 볼 만큼 겹치는가.
 *
 * 문턱을 3개·40%로 잡은 이유: 회사 이름 하나만 겹치는 것으로는 부족하다
 * ("오픈AI"는 하루에 열 건씩 나온다). 반대로 너무 높이면 언어와 표현이 다른
 * 같은 사건을 놓친다. news-digest의 1차 클러스터와 같은 기준이다.
 */
function overlaps(a: Set<string>, b: Set<string>, korean: boolean): boolean {
  if (a.size < 3 || b.size < 3) return false;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  // 한국어는 조사가 붙어 같은 낱말도 다른 토큰이 되므로 겹침이 구조적으로 낮다.
  // 문턱을 낮추는 대신 최소 개수는 유지해 회사 이름 하나로 붙는 것을 막는다.
  return korean ? n >= 2 && n / Math.min(a.size, b.size) >= 0.28
                : n >= 3 && n / Math.min(a.size, b.size) >= 0.4;
}

/**
 * 매체 이름 비교용 키. 이미 아는 매체가 다시 붙는 것을 막는다.
 *
 * 대소문자만 맞춰서는 부족했다 — 구글은 같은 곳을 "STAT"이라고도 "STAT News"라고도
 * 부르고, "Fierce Biotech"와 "FierceBiotech"도 섞여 온다. 그래서 한쪽이 다른 쪽의
 * 앞부분이면 같은 곳으로 본다(2026-09-09 실측: 두 경우 다 중복으로 붙었다).
 */
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const samePublisher = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * 매체명 자리에 도메인이 온 것은 버린다.
 *
 * 구글이 발행처 이름을 모를 때 "finance.biggo.com"처럼 도메인을 그대로 준다.
 * 그런 곳은 대개 기사를 긁어 재게시하는 사이트라 "함께 보도한 매체"로 셀 만하지 않고,
 * 화면에 "finance.biggo.com 원문 보기"라고 뜨는 것도 이상하다.
 */
const looksLikeDomain = (s: string) => /\.[a-z]{2,}$/i.test(s.trim());

/** 구글 뉴스 RSS 제목은 "제목 - 매체명" 형태다. */
function splitTitle(raw: string): { title: string; source: string } | null {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const i = clean.lastIndexOf(' - ');
  if (i < 10) return null;
  return { title: clean.slice(0, i).trim(), source: clean.slice(i + 3).trim() };
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&#39;|&apos;/g, "'")
   .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
   .replace(/&amp;/g, '&');

/**
 * 같은 기사를 한 프로세스 안에서 다시 검색하지 않는다.
 *
 * 사전계산은 창 6개로 돌고, 상위 기사는 대체로 세 창(오늘·이번주·이번달)에 함께
 * 들어온다. 그래서 같은 제목으로 구글 뉴스를 세 번 검색했다(2026-09-10 실측:
 * 검색 4건이 각각 3회씩 반복). 결과가 달라질 이유가 없으니 한 번만 묻는다.
 */
const CORROBORATE_MEMO_MS = 10 * 60_000;
const memo = new Map<string, { at: number; found: { source: string; url: string }[] }>();

async function findOthers(item: DigestItem): Promise<{ source: string; url: string }[]> {
  const cached = memo.get(item.url);
  if (cached && Date.now() - cached.at < CORROBORATE_MEMO_MS) return cached.found;
  const url = 'https://news.google.com/rss/search?' + new URLSearchParams({
    q: queryFor(item.title), ...localeFor(item.title),
  });
  const known = [item.source, ...item.alsoIn.map(a => a.source)].map(nameKey);
  const base = tokens(item.title);
  const korean = isKorean(item.title);
  const out: { source: string; url: string }[] = [];

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparkScope/1.0)' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(String(res.status));
    const xml = await res.text();

    for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const rawTitle = decode(block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? '');
      const link = decode(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '').trim();
      const parsed = splitTitle(rawTitle);
      if (!parsed || !link) continue;
      if (looksLikeDomain(parsed.source)) continue;
      // 같은 매체는 세지 않는다 — 매체 수가 부풀려진다.
      const key = nameKey(parsed.source);
      if (!key || known.some(k => samePublisher(k, key))) continue;
      if (!overlaps(base, tokens(parsed.title), korean)) continue;
      known.push(key);
      out.push({ source: parsed.source, url: link });
      if (out.length >= MAX_ADDED) break;
    }
  } catch (e) {
    console.error('[news-corroborate] 실패(무시):', item.source, e instanceof Error ? e.message : e);
  }
  memo.set(item.url, { at: Date.now(), found: out });
  return out;
}

/**
 * 목록에 오른 기사 중 "함께 보도한 매체 0곳"인 것들만 채운다.
 * 실패해도 목록은 그대로 나간다 — 붙이는 것은 덧붙임이지 필수가 아니다.
 */
export async function corroborate(items: DigestItem[]): Promise<number> {
  const targets = items.slice(0, MAX_ITEMS).filter(it => it.alsoIn.length === 0);
  if (targets.length === 0) return 0;

  // 구글 뉴스는 병렬 조회를 견딘다(Reddit과 달리 레이트리밋이 넉넉하다).
  const found = await Promise.all(targets.map(findOthers));
  let added = 0;
  targets.forEach((it, i) => {
    if (found[i].length === 0) return;
    it.alsoIn = found[i];
    added += found[i].length;
  });
  console.log(`[news-corroborate] 단독 보도 ${targets.length}건 중 ${found.filter(f => f.length > 0).length}건에 매체 ${added}곳을 붙였습니다`);
  return added;
}
