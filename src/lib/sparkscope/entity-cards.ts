/**
 * 이름 카드 — "지금 화제인 이름"과 그 이름에 달린 기사·커뮤니티 글.
 *
 * 왜 기사가 아니라 이름을 단위로 묶나:
 *   뉴스와 커뮤니티는 기사 단위로 거의 겹치지 않는다. 실측(2026-09-09)으로 상위 후보
 *   40건 중 커뮤니티와 URL이 겹친 건 0건이었다 — Hacker News가 로이터 기사를 그대로
 *   올리지 않기 때문이다. 그런데 이름 단위로는 겹친다(AI 상위 키워드 8개 중 4개).
 *   그래서 둘을 잇는 열쇠는 URL이 아니라 이름이다.
 *
 * 회사 단위로 묶는다(2026-09-09 결정). 제품·모델 단위가 더 정확하지만 자주 빈다 —
 * AI 상위 6건 중 제품명이 커뮤니티와 맞은 건 1건뿐이었다. 회사 단위면 거의 항상
 * 채워지는 대신 "같은 회사 다른 사건"이 한 카드에 들어온다. 그래서 카드는 이 이름에
 * 대한 기사와 반응을 "모아 보여줄" 뿐, 하나의 사건이라고 말하지 않는다.
 *
 * 커뮤니티 쪽 이름표는 도메인마다 다르다:
 *   · AI  — Hacker News·Reddit·Hugging Face는 사람들의 반응이다.
 *   · BIO — bioRxiv·PubMed·임상등록은 반응이 아니라 1차 자료다. 논문 제목에 회사명이
 *           나올 일이 거의 없어서 실제로 상위 6건 중 0건이 붙었다. 그래서 "반응"이라고
 *           부르지 않고 "새로 등록된 연구·임상"으로 말한다.
 */
import { extractEntities, keyOf, type Entity } from './news-keywords';
import { DOMAIN_KEYWORDS } from './news-feeds';
import type { DigestItem, NewsDomain } from './news-digest';

/** 커뮤니티 글 — 소셜 시그널에서 넘어온다. */
export interface CommunityPost {
  source: string;
  sourceId: string;
  title: string;
  titleKo?: string | null;
  url: string;
  points: number;
  pointsLabel?: string | null;
  blurb?: string | null;
}

export interface EntityCard {
  key: string;
  label: string;
  /** 이 이름을 다룬 서로 다른 매체 수. 카드 순위의 1순위 기준이다. */
  outlets: number;
  /**
   * 이 이름을 다룬 기사. alsoIn은 같은 사안을 함께 보도한 다른 매체다.
   *
   * 이걸 함께 들고 오는 이유: outlets(매체 수)는 함께 보도한 곳까지 세는데 articles는
   * 사건 단위라, 헤더에 "매체 5곳"이라고 써 놓고 기사는 2건만 보이는 일이 생겼다
   * (2026-09-09 실측: 메타 카드의 다섯 매체 중 셋이 Reuters 기사의 alsoIn 안에
   * 숨어 있었다). 숫자와 목록이 어긋나면 숫자를 신뢰할 수 없다.
   */
  articles: { source: string; title: string; url: string; alsoIn: { source: string; url: string }[] }[];
  community: CommunityPost[];
  /** 이 이름이 등장한 전체 항목 수. 회사인지 제품인지를 가르는 데 쓴다 — 회사가 더 넓게 나온다. */
  mentions: number;
  /**
   * 커뮤니티 쪽을 뭐라고 부를지. 'reaction' 사람들의 반응 · 'primary' 새로 등록된 연구·임상.
   * 도메인이 아니라 실제로 담긴 소스로 정한다 — 바이오에도 Hacker News가 있고,
   * 거기 올라온 글은 반응이 맞다.
   */
  communityKind: 'reaction' | 'primary';
}

/** 반응으로 볼 소스 — 점수(업보트·좋아요)가 사람들의 관심을 뜻하는 곳. */
const REACTION_SOURCES = new Set(['hn', 'reddit', 'lobsters', 'hf', 'hf_new']);

/**
 * 기사 없이 커뮤니티만으로 카드가 될 수 있는 소스 — 사람이 글을 읽고 반응한 곳만이다.
 *
 * Hugging Face를 뺀 이유: 점수가 다운로드 수라 단위가 다르고(11만 vs 업보트 1천),
 * 제목이 모델 ID다. 그대로 두면 'Qwopus3.8-27B-Flash-GGUF' 같은 이름이 카드로 올라온다.
 * 그건 화제가 아니라 파일 이름이다.
 */
const DISCUSSION_SOURCES = new Set(['hn', 'reddit', 'lobsters']);

/** 카드에 담을 최대 개수. 카드가 길어지면 훑을 수 없다. */
const MAX_ARTICLES = 4;
const MAX_COMMUNITY = 3;

/**
 * 커뮤니티에만 있고 기사에는 없는 이름도 카드로 만든다.
 *
 * 이게 이 화면에서만 볼 수 있는 것이다 — 커뮤니티가 매체보다 먼저 아는 주제.
 * 실측: CRISPR로 암세포를 선택적으로 파괴한다는 글이 1,002업보트를 받았는데
 * 우리 매체 목록에는 아직 없었다. 기사에 매달아 두면 이런 건 아예 사라진다.
 * 다만 아무 글이나 올리면 잡담이 올라오므로 점수 문턱을 둔다.
 */
const COMMUNITY_ONLY_MIN_POINTS = 300;

/**
 * 회사 아래 딸린 이름을 회사 카드로 접는다.
 *
 * 같은 기사에서 'OpenAI'와 'GPT-6 Astra'가, 'Novartis'와 'Avidity'가 같이 뽑히면
 * 카드가 둘로 갈라져 같은 기사를 두 번 보여준다. 회사 단위로 보기로 했으므로
 * (2026-09-09 결정) 기사 목록이 다른 카드에 완전히 포함되는 카드는 접는다.
 *
 * 접을 때 커뮤니티 글은 버리지 않고 위 카드로 옮긴다 — 오히려 이쪽이 더 정확한
 * 반응인 경우가 많다. 'GPT-6 Astra'로 맞은 HN·Reddit 글이 'OpenAI' 카드로 올라가면,
 * 회사 단위로 보면서도 반응은 그 사건의 것을 보게 된다.
 */
function foldSubEntities(cards: EntityCard[]): EntityCard[] {
  // 언급이 넓은 쪽을 부모로 삼는다. 회사 이름은 여러 기사·글에 걸쳐 나오고 제품 이름은
  // 그 사건에만 나오므로, 이 값이 "회사인가 제품인가"의 실질적인 대리 지표다.
  // (예전에는 매체 수만 봐서 동점이면 임의로 갈렸고, 실제로 '노바티스'가 'Avidity'
  //  밑으로, 'Spyre'가 'IL-23' 밑으로 접히는 일이 있었다.)
  const byOutlets = [...cards].sort((a, b) =>
    b.mentions - a.mentions || b.outlets - a.outlets || b.articles.length - a.articles.length);
  const dropped = new Set<string>();

  for (const sub of byOutlets) {
    if (sub.articles.length === 0) continue; // 커뮤니티 전용 카드는 접지 않는다
    for (const parent of byOutlets) {
      if (parent.key === sub.key || dropped.has(parent.key) || dropped.has(sub.key)) continue;
      if (parent.articles.length < sub.articles.length) continue;
      if (parent.mentions < sub.mentions) continue;
      const urls = new Set(parent.articles.map(a => a.url));
      if (!sub.articles.every(a => urls.has(a.url))) continue;
      // 같은 기사 집합이면 매체 수가 많은 쪽(정렬상 먼저 나온 쪽)을 남긴다.
      for (const c of sub.community) {
        if (parent.community.length >= MAX_COMMUNITY) break;
        if (!parent.community.some(x => x.url === c.url)) parent.community.push(c);
      }
      parent.community.sort((a, b) => b.points - a.points);
      if (parent.community.some(c => REACTION_SOURCES.has(c.sourceId))) parent.communityKind = 'reaction';
      dropped.add(sub.key);
      break;
    }
  }
  // 기사 없는 카드가 다른 카드에 이미 실린 글만 들고 있으면 뺀다 — 같은 글이 두 번
  // 보인다(애플이 오픈AI를 고소한 HN 글이 '오픈AI' 카드와 '애플' 카드에 함께 떴다).
  const kept = cards.filter(c => !dropped.has(c.key));
  const shownElsewhere = new Set(
    kept.filter(c => c.articles.length > 0).flatMap(c => c.community.map(x => x.url)));
  return kept.filter(c =>
    c.articles.length > 0 || c.community.some(x => !shownElsewhere.has(x.url)));
}

export async function buildEntityCards(
  domain: NewsDomain,
  items: DigestItem[],
  posts: CommunityPost[],
  limit = 6,
): Promise<EntityCard[]> {
  if (items.length === 0 && posts.length === 0) return [];

  // 기사와 커뮤니티 글에 같은 추출기를 쓴다 — 그래야 같은 키로 묶인다.
  const [newsEnts, postEnts] = await Promise.all([
    extractEntities(items.map(i => ({ url: i.url, title: i.title, source: i.source }))),
    extractEntities(posts.map(p => ({ url: p.url, title: p.titleKo ?? p.title, source: p.source }))),
  ]);

  type Agg = {
    label: string;
    outlets: Set<string>;
    articles: EntityCard['articles'];
    community: CommunityPost[];
    points: number;
    mentions: number;
  };
  const agg = new Map<string, Agg>();
  const touch = (e: Entity): Agg => {
    // 모회사로 묶는다 — 'ChatGPT'와 'OpenAI'가 따로 집계되면 같은 곳 소식이 카드
    // 둘로 쪼개지고 매체 수도 반으로 나뉜다(2026-09-09 사용자 지적).
    const k = keyOf(e.org || e.en);
    let cur = agg.get(k);
    if (!cur) {
      cur = { label: e.orgKo || e.org || e.ko || e.en, outlets: new Set(), articles: [], community: [], points: 0, mentions: 0 };
      agg.set(k, cur);
    }
    return cur;
  };

  for (const it of items) {
    for (const e of newsEnts.get(it.url) ?? []) {
      const a = touch(e);
      a.mentions++;
      a.outlets.add(it.source);
      for (const x of it.alsoIn) a.outlets.add(x.source);
      if (a.articles.length < MAX_ARTICLES && !a.articles.some(x => x.url === it.url)) {
        a.articles.push({
          source: it.source,
          title: it.summary?.titleKo || it.title,
          url: it.url,
          alsoIn: it.alsoIn,
        });
      }
    }
  }

  for (const p of posts) {
    for (const e of postEnts.get(p.url) ?? []) {
      const a = touch(e);
      a.mentions++;
      // 여기서 상한을 걸면 안 된다. 소스 순서(DOMAIN_SOURCES)대로 채워지므로 앞에 있는
      // HN이 세 칸을 다 먹고, 뒤에 오는 AlphaSignal이 17,394업보트여도 밀려났다
      // (2026-09-10 실측: 카드에 alphasignal 0건). 전부 모아 두고 점수로 고른 뒤 자른다.
      if (!a.community.some(x => x.url === p.url)) {
        a.community.push(p);
        a.points += p.points;
      }
    }
  }

  // AlphaSignal은 매체(뉴스 후보)와 커뮤니티 양쪽에 들어 있다 — 업보트는 반응이고
  // 그 반응이 붙은 기사는 뉴스다. 그래서 같은 URL이 한 카드에 "기사"와 "반응"으로
  // 두 번 뜰 수 있다. 기사 쪽을 남기고 반응 쪽을 뺀다(기사 줄이 제목·요약을 더
  // 많이 보여주고, 업보트 수는 어차피 기사 줄에 인기 등수로 반영된다).
  for (const a of agg.values()) {
    if (a.articles.length === 0) continue;
    const urls = new Set(a.articles.map(x => x.url));
    a.community = a.community.filter(c => !urls.has(c.url));
  }

  const cards: EntityCard[] = [];
  for (const [key, a] of agg) {
    const hasNews = a.articles.length > 0 && a.outlets.size >= 2;
    const discussed = a.community
      .filter(c => DISCUSSION_SOURCES.has(c.sourceId))
      .reduce((n, c) => n + c.points, 0);
    // 기사 없이 올라오는 카드는 분야 확인을 한 번 더 한다. Hacker News 하나로 두
    // 도메인을 같이 긁다 보니 엉뚱한 글이 섞인다 — 실제로 바이오 카드에 "잭 도시,
    // Bluetooth 채팅 앱 삭제 명령"이 올라왔다. 제목(영문 원문)으로 분야를 본다.
    const onTopic = a.community.some(c => DOMAIN_KEYWORDS[domain].test(c.title));
    const communityOnly = a.articles.length === 0 && discussed >= COMMUNITY_ONLY_MIN_POINTS && onTopic;
    // 한 매체만 쓴 이름은 버린다 — "여러 매체가 함께"가 이 화면의 전제다.
    if (!hasNews && !communityOnly) continue;
    cards.push({
      key,
      label: a.label,
      outlets: a.outlets.size,
      mentions: a.mentions,
      articles: a.articles,
      // 점수 순으로 세운 뒤 상한만큼 남긴다 — 소스 순서가 아니라 반응 크기가 기준이다.
      community: a.community.sort((x, y) => y.points - x.points).slice(0, MAX_COMMUNITY),
      // 비어 있으면 도메인 기본값을 쓴다 — AI 카드에 "새로 등록된 연구·임상 없음"이
      // 뜨면 엉뚱하다.
      communityKind: a.community.length === 0
        ? (domain === 'bio' ? 'primary' : 'reaction')
        : a.community.some(c => REACTION_SOURCES.has(c.sourceId)) ? 'reaction' : 'primary',
    });
  }

  return foldSubEntities(cards)
    .sort((x, y) =>
      // 매체 수가 1순위. 같으면 커뮤니티 반응이 큰 쪽 — 기사가 없는 카드는 여기서 올라온다.
      y.outlets - x.outlets ||
      y.community.reduce((n, c) => n + c.points, 0) - x.community.reduce((n, c) => n + c.points, 0) ||
      y.articles.length - x.articles.length)
    // 앞선 카드에 이미 실린 글만 들고 있는 카드는 뺀다. 하나의 화제가 등장인물 수만큼
    // 카드로 갈라지는 것을 막는다("Anthropic의 주장" 글이 Anthropic·Zig 두 카드에 떴다).
    .filter((c, _i, all) => {
      if (c.articles.length > 0) return true;
      const earlier = all.slice(0, all.indexOf(c));
      const shown = new Set(earlier.flatMap(e => e.community.map(x => x.url)));
      return c.community.some(x => !shown.has(x.url));
    })
    .slice(0, limit);
}
