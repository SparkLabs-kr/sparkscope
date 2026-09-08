/**
 * 뉴스 다이제스트 — 신뢰할 수 있는 매체들이 지금 다루는 것을 모아 한 줄로 줄세운다.
 *
 * 왜 "몇 개 매체가 다뤘나"로 순위를 매기나:
 *   RSS는 조회수·좋아요 같은 참여도를 주지 않는다. 커뮤니티 소스라면 업보트로 인기를
 *   잴 수 있지만 여기는 그런 값이 없다. 대신 같은 사안을 여러 매체가 동시에 다루면
 *   그 자체가 중요도 신호다 — 실측으로도 FT·Reuters가 같은 날 엔비디아–허깅페이스 건을,
 *   CNBC·Reuters가 팔로알토 실적을 나란히 다뤘다.
 *   (커뮤니티 소스에서는 이 중복이 0건이라 쓸 수 없었다. 매체는 다르다.)
 *
 * 순위 = 다룬 매체 수 → 매체 등급 → 최신순.
 */
import { FEEDS, DOMAIN_KEYWORDS, type Feed } from './news-feeds';
import { scoreImportance, type Importance } from './news-importance';
import { groupSameStory } from './news-cluster';
import { collectPopular } from './news-popular';

export type NewsDomain = 'ai' | 'bio';

export interface DigestItem {
  title: string;
  url: string;
  source: string;
  independent: boolean;
  publishedAt: string;      // YYYY-MM-DD
  tier: number;
  /** 같은 사안을 다룬 다른 매체들 (대표 기사 제외). */
  alsoIn: { source: string; url: string }[];
  /** 화면에 보여줄 짧은 매체 설명. */
  blurb: string | null;
  /** 업계에 얼마나 큰 일인가 1~5 (news-importance.ts). 순위의 1순위 기준. */
  importance: Importance | null;
  /** 매체가 집계한 인기기사 등수(1부터). RSS에 없는 실측 참여도 신호다.
   *  없으면 null — 인기 목록에 오르지 않았다는 뜻이고 감점 사유는 아니다. */
  popularRank: number | null;
  /**
   * 요약을 만들 때만 쓰는 원문 발췌. 화면에는 내보내지 않는다(라우트에서 지운다) —
   * 매체 본문을 그대로 싣는 것은 이용약관 문제이고, 클라이언트 페이로드도 커진다.
   */
  sourceText?: string | null;
  /**
   * 근거가 얼마나 두터운가. 유료 매체는 RSS에 티저만 실어서(FT는 100자 안팎)
   * 요약이 제목과 일반 배경에 많이 기댄다. 그 사실을 화면에 밝히기 위한 값이다.
   * 'full' 원문 상당 부분 · 'partial' 일부 · 'headline' 사실상 제목뿐.
   */
  grounding: 'full' | 'partial' | 'headline';
  /**
   * 이 뉴스가 영향을 줄 만한 포트폴리오사와 그 이유.
   * null은 "아직 판정 전", 빈 배열은 "판정했고 해당 없음" — 둘을 구분해야
   * 판정이 실패한 건지 정말 관계가 없는 건지 화면에서 구분할 수 있다.
   */
  portfolio?: { company: string; reason: string }[] | null;
  /** 쉬운 말 요약(짧게/길게 × 한국어/영어). 채우기 전에는 null — 지어내지 않는다. */
  summary: { titleKo: string; ko: string; en: string; koLong: string[]; enLong: string[] } | null;
}

const UA = 'Mozilla/5.0 (compatible; SparkScope/1.0; +https://sparkscope.sparklabs.co.kr)';

/**
 * 피드 하나를 읽되 앞부분만 가져온다.
 *
 * 일부 뉴스레터 피드는 본문 전체를 실어서 매우 크다 — Substack의
 * magazine.sebastianraschka.com이 2.7MB, oneusefulthing.org가 0.9MB다(2026-09-08 실측).
 * Next의 데이터 캐시는 2MB를 넘는 응답을 저장하지 못해서, 그 피드는 캐시에 못 들어가고
 * 30분마다 2.7MB를 통째로 다시 받으며 로그에 오류를 남기고 있었다
 * ("Failed to set Next.js data cache, items over 2MB can not be cached").
 *
 * 우리에게 필요한 것은 최근 항목의 제목·날짜·짧은 소개뿐이고, RSS는 최신 항목이
 * 앞에 온다. 그래서 앞에서부터 읽다가 상한에 닿으면 끊는다. 마지막 항목이 잘려도
 * 파싱은 <item>…</item> 블록 단위 정규식이라 그 조각만 버려지고 나머지는 멀쩡하다.
 *
 * ⚠️ next: { revalidate }를 같이 쓰면 안 된다. Next의 데이터 캐시는 우리가 스트림을
 *    읽기 전에 본문 전체를 버퍼링하므로, 아래 상한이 적용되지 않고 2MB 초과 오류도
 *    그대로 난다(실측으로 확인). cache: 'no-store'로 그 계층을 빼고, 대신 이 함수를
 *    부르는 라우트가 이미 응답 단위로 30분 캐시한다(/api/inter/digest의 revalidate).
 */
const FEED_MAX_BYTES = 1_500_000;

async function getFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status}`);

  // Content-Length가 있으면 그것만 보고 판단할 수도 있지만, 없는 피드가 많아
  // 실제로 읽으면서 센다.
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < FEED_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  // 상한에 걸려 중간에 멈췄으면 남은 연결을 붙들고 있지 않는다.
  await reader.cancel().catch(() => {});

  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.length; }
  return new TextDecoder('utf-8').decode(buf);
}

function unescapeXml(s: string): string {
  // 순서가 중요하다. 예전에는 태그를 먼저 지우고 엔티티를 나중에 풀었는데,
  // 피드가 본문을 &lt;a href=...&gt; 처럼 이스케이프해 보내면(Google News RSS가 그렇다)
  // 태그 제거 단계에서는 아직 텍스트라 살아남고, 그 뒤 엔티티가 풀리면서
  // 화면과 LLM 입력에 <a href="..."> 가 그대로 들어갔다.
  // 그래서 CDATA → 엔티티 해제 → 태그 제거 → 공백 정리 순으로 간다.
  const decodeOnce = (x: string) => x
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
  // 두 번 돌린다. 일부 피드는 &amp;nbsp; 처럼 이중 인코딩해 보내서,
  // 한 번만 풀면 &nbsp; 라는 글자가 화면에 그대로 남는다.
  const decoded = decodeOnce(decodeOnce(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')));
  return decoded
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** RSS(item)와 Atom(entry)을 한 함수로 읽는다 — 피드마다 형식이 다르다. */
type Entry = { title: string; url: string; date: Date | null; blurb: string | null; sourceText: string | null };

function parseFeed(xml: string): Entry[] {
  const out: Entry[] = [];
  for (const block of xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) ?? []) {
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    // RSS는 <link>텍스트</link>, Atom은 <link href="...">
    const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1]
      ?? block.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1];
    const dateRaw = block.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/)?.[2];
    // 본문 후보를 모두 보고 가장 긴 것을 고른다.
    //
    // 예전에는 정규식이 먼저 걸리는 태그 하나만 읽고 400자에서 잘랐다. 그런데 피드마다
    // 어느 태그에 알맹이를 넣는지가 다르다 — Substack 계열(Interconnects)과 Simon Willison은
    // content:encoded/summary에 글 전문을 싣고(6,000~14,000자), STAT도 content:encoded가
    // description보다 열 배 길다. 짧은 쪽만 읽고 "피드가 설명을 별로 안 준다"고 판단했었다.
    const candidates: string[] = [];
    for (const tag of ['content:encoded', 'content', 'summary', 'description']) {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (m) candidates.push(unescapeXml(m[1]));
    }
    const longest = candidates.sort((a, b) => b.length - a.length)[0] ?? '';
    if (!title || !link) continue;
    const d = dateRaw ? new Date(unescapeXml(dateRaw)) : null;
    out.push({
      title: unescapeXml(title),
      url: unescapeXml(link),
      date: d && !Number.isNaN(d.getTime()) ? d : null,
      // 화면용은 짧게. 문장 중간에서 끊기지 않도록 마침표 뒤에서 자른다.
      blurb: longest.length >= 20 ? trimToSentence(longest, 300) : null,
      // 요약용은 넉넉히. 4,000자면 대부분의 기사 앞부분을 담고 토큰도 감당된다.
      sourceText: longest.length >= 20 ? longest.slice(0, 4000) : null,
    });
  }
  return out;
}

/** 마지막 문장 끝에서 자른다 — 화면에 반쪽 문장이 남지 않게. */
function trimToSentence(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('다. '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut).trim() + '…';
}

const STOP = new Set(('the a an and or but for of to in on at by with from as is are was were be been it its this that ' +
  'how why what new now more than then into over after about you your we our they says said will can could would not ' +
  'has have had do does did get gets us first two one their his her out up down off all been being').split(' '));

function tokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 4 && !STOP.has(w)),
  );
}

/** 같은 사안인가 — 제목의 특징 단어가 충분히 겹치는가. */
function sameStory(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 3 || b.size < 3) return false;
  let ov = 0;
  for (const w of a) if (b.has(w)) ov++;
  return ov >= 3 && ov / Math.min(a.size, b.size) >= 0.45;
}

/** 그룹의 중요도 — 최고값. 같은 사건인데 한 매체 제목이 모호해 낮게 채점된 것
 *  때문에 사건 전체가 강등되면 안 된다. */
function groupImportance(group: { importance: Importance | null }[]): Importance | null {
  let best = 0;
  for (const g of group) if ((g.importance ?? 0) > best) best = g.importance ?? 0;
  return best > 0 ? (best as Importance) : null;
}

export async function collectDigest(domain: NewsDomain, days = 7, limit = 12): Promise<{
  items: DigestItem[];
  feeds: { name: string; ok: boolean; count: number }[];
}> {
  const cutoff = Date.now() - days * 86_400_000;

  const results = await Promise.all(FEEDS.map(async (f: Feed) => {
    try {
      const entries = parseFeed(await getFeed(f.url));
      const kept = entries.filter(e => {
        if (e.date && e.date.getTime() < cutoff) return false;
        // 종합지는 글마다 분야를 가른다. 전용 피드는 그대로 통과.
        if (f.domain === 'general') return DOMAIN_KEYWORDS[domain].test(e.title);
        return f.domain === domain;
      });
      return { feed: f, entries: kept, ok: true };
    } catch (e) {
      console.error('[news-digest] 피드 실패:', f.name, e);
      return { feed: f, entries: [], ok: false };
    }
  }));

  // 평평하게 펴고 최신순으로 — 뒤에서 클러스터의 대표를 고를 때 최신이 앞에 오게.
  const flat = results.flatMap(r => r.entries.map(e => ({ ...e, feed: r.feed })));
  flat.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  // 같은 사안끼리 묶는다. 대표는 등급이 높은 쪽, 같으면 최신.
  type Cluster = { rep: (typeof flat)[number]; repToks: Set<string>; members: (typeof flat)[number][] };
  const clusters: Cluster[] = [];
  for (const a of flat) {
    const t = tokens(a.title);
    const hit = clusters.find(c => sameStory(c.repToks, t));
    if (hit) {
      hit.members.push(a);
      if (a.feed.tier < hit.rep.feed.tier) { hit.rep = a; hit.repToks = t; }
    } else {
      clusters.push({ rep: a, repToks: t, members: [a] });
    }
  }

  const items: DigestItem[] = clusters
    .map(c => {
      const outlets = new Map<string, string>();
      for (const m of c.members) if (m.feed.name !== c.rep.feed.name) outlets.set(m.feed.name, m.url);
      return {
        title: c.rep.title,
        url: c.rep.url,
        source: c.rep.feed.name,
        independent: !!c.rep.feed.independent,
        publishedAt: (c.rep.date ?? new Date()).toISOString().slice(0, 10),
        tier: c.rep.feed.tier,
        alsoIn: [...outlets.entries()].map(([source, url]) => ({ source, url })),
        // 대표 기사에 설명이 없으면 같은 사안을 다룬 다른 기사의 것을 빌린다.
        blurb: c.rep.blurb ?? c.members.find(m => m.blurb)?.blurb ?? null,
        // 같은 사안을 다룬 기사들의 본문을 함께 넘긴다 — 매체마다 강조점이 달라
        // 한 곳만 볼 때보다 근거가 두터워진다.
        sourceText: c.members.map(m => m.sourceText).filter(Boolean).slice(0, 3).join('\n\n---\n\n') || null,
        grounding: ((n: number): DigestItem['grounding'] =>
          n >= 800 ? 'full' : n >= 200 ? 'partial' : 'headline'
        )(c.members.map(m => m.sourceText).filter(Boolean).join('').length),
        portfolio: null,
        summary: null,
        importance: null,
        popularRank: null,
      };
    })
    .sort((a, b) =>
      b.alsoIn.length - a.alsoIn.length ||
      a.tier - b.tier ||
      b.publishedAt.localeCompare(a.publishedAt));

  // 매체가 집계한 인기기사를 후보에 합친다.
  //
  // 두 가지를 동시에 메운다(news-popular.ts 주석 참고):
  //  · RSS 창이 좁아 며칠 지난 큰 뉴스가 후보에 아예 없었다. aitimes.com RSS는 최신
  //    50건 = 약 24시간치라, 9월 3일에 나온 "GPT-6 아스트라 전격 공개"가 빠져 있었다.
  //  · RSS에는 참여도가 없다. 매체가 낸 인기 순위가 우리가 가진 유일한 실측 신호다.
  //
  // 이미 RSS로 들어온 기사면 등수만 붙이고, 없던 기사면 후보로 추가한다.
  const popular = await collectPopular(domain).catch(e => {
    console.error('[news-digest] 인기기사 수집 실패(무시):', e);
    return [] as Awaited<ReturnType<typeof collectPopular>>;
  });

  if (popular.length > 0) {
    const byUrl = new Map(items.map(i => [i.url, i] as const));
    // 제목으로도 찾는다 — 목록 페이지 URL에 view_type 같은 파라미터가 붙어 RSS와 다를 수 있다.
    const byTitle = new Map(items.map(i => [i.title.trim(), i] as const));
    for (const p of popular) {
      const hit = byUrl.get(p.url) ?? byTitle.get(p.title.trim());
      if (hit) {
        // 여러 매체 인기 목록에 오르면 더 높은 등수를 남긴다.
        hit.popularRank = Math.min(hit.popularRank ?? 99, p.rank);
        continue;
      }
      items.push({
        title: p.title,
        url: p.url,
        source: p.source,
        independent: false,
        // 인기 목록은 발행일을 주지 않는다. 날짜 필터는 이미 지난 단계이므로
        // 오늘로 두되, 이 값이 순위의 마지막 tiebreak에만 쓰인다는 점을 감안한 것이다.
        publishedAt: new Date().toISOString().slice(0, 10),
        tier: 2,
        alsoIn: [],
        blurb: null,
        sourceText: null,
        grounding: 'headline',
        portfolio: null,
        summary: null,
        importance: null,
        popularRank: p.rank,
      });
    }
  }

  // 순서: ① 중요도 채점 → ② 상위 후보만 사건 단위로 병합 → ③ 최종 정렬.
  //
  // 왜 채점을 먼저 하나: 병합 판정은 LLM 호출이라 후보 전체(100건 이상)에 쓰면 비싸고
  // 부정확하다. 화면·메일에 실제로 들어갈 것들만 병합하면 되므로, 먼저 점수로 줄을
  // 세워 상위만 넘긴다.
  //
  // 점수를 못 받은 항목(호출 실패·상한 초과)은 3점으로 둔다 — 0으로 두면 채점 실패가
  // 곧 강등이 되어, 오류가 조용히 순위를 망친다.
  // 채점 순서 — 인기 목록에 오른 것을 먼저 넘긴다.
  //
  // scoreImportance에는 상한(MAX_CANDIDATES)이 있어 넘치는 만큼 잘린다. 인기기사는
  // items 뒤쪽에 추가되므로 그대로 넘기면 정확히 그것들이 잘려 나가고, 점수를 못 받아
  // 기본값 3으로 가라앉는다 — 실제로 그렇게 됐다(2026-09-08: AI타임스코리아
  // 인기 1~4위인 GPT-6 아스트라·제미나이 3.8·페이블 5.1이 전부 목록에 안 떴다).
  // 가장 확실한 신호를 가진 것부터 채점한다.
  const forScoring = [
    ...items.filter(i => i.popularRank != null),
    ...items.filter(i => i.popularRank == null),
  ];

  const scores = await scoreImportance(forScoring).catch(e => {
    console.error('[news-digest] 중요도 산정 실패 — 예전 기준으로 정렬합니다:', e);
    return new Map<string, Importance>();
  });

  // 인기 등수는 중요도 바로 다음 기준이다. 매체가 실제 조회수로 매긴 값이라
  // "여러 매체가 다뤘나"보다 신뢰도가 높다 — 후자는 우리 병합 정확도에 의존한다.
  // 목록에 없는 기사는 큰 값으로 둬서 뒤로 가되, 중요도가 높으면 여전히 위에 온다.
  const rank = (it: { popularRank: number | null }) => it.popularRank ?? 99;

  const scored = items
    .map(it => ({ ...it, importance: scores.get(it.url) ?? null }))
    .sort((a, b) =>
      (b.importance ?? 3) - (a.importance ?? 3) ||
      rank(a) - rank(b) ||
      b.alsoIn.length - a.alsoIn.length ||
      a.tier - b.tier ||
      b.publishedAt.localeCompare(a.publishedAt));

  // 병합 대상 — 최종 노출 수의 세 배 정도만. 같은 사건이 셋으로 쪼개져도 이 안에 든다.
  const shortlist = scored.slice(0, Math.max(limit * 3, 20));
  const rest = scored.slice(shortlist.length);

  const buckets = await groupSameStory(shortlist).catch(e => {
    console.error('[news-digest] 사건 병합 실패 — 병합 없이 진행합니다:', e);
    return shortlist.map((_, i) => [i]);
  });

  const merged: DigestItem[] = buckets.map(idx => {
    const group = idx.map(i => shortlist[i]);
    // 대표는 등급이 높은 쪽, 같으면 최신. 중요도는 그룹 최고값을 쓴다 —
    // 같은 사건인데 한 매체 제목이 모호해 낮게 채점된 것 때문에 강등되면 안 된다.
    const rep = group.reduce((best, cur) =>
      cur.tier < best.tier || (cur.tier === best.tier && cur.publishedAt > best.publishedAt) ? cur : best);
    const outlets = new Map<string, string>();
    for (const g of group) {
      if (g.source !== rep.source) outlets.set(g.source, g.url);
      for (const a of g.alsoIn) if (a.source !== rep.source) outlets.set(a.source, a.url);
    }
    return {
      ...rep,
      importance: groupImportance(group),
      // 그룹 안에서 가장 높은 등수를 쓴다 — 같은 사건인데 한 매체에서만 인기 목록에
      // 올랐다면 그 사건이 인기라는 뜻이다.
      popularRank: group.reduce<number | null>(
        (m, g) => (g.popularRank == null ? m : m == null ? g.popularRank : Math.min(m, g.popularRank)), null),
      alsoIn: [...outlets.entries()].map(([source, url]) => ({ source, url })),
      // 요약 근거도 합친다 — 매체마다 강조점이 달라 한 곳만 볼 때보다 두터워진다.
      sourceText: group.map(g => g.sourceText).filter(Boolean).slice(0, 3).join('\n\n---\n\n') || null,
      blurb: rep.blurb ?? group.find(g => g.blurb)?.blurb ?? null,
    };
  });

  // 병합으로 자리가 비면 뒤쪽 후보가 올라온다.
  const ordered = [...merged, ...rest]
    .sort((a, b) =>
      (b.importance ?? 3) - (a.importance ?? 3) ||
      rank(a) - rank(b) ||
      b.alsoIn.length - a.alsoIn.length ||
      a.tier - b.tier ||
      b.publishedAt.localeCompare(a.publishedAt));

  // 한 매체가 목록을 독점하지 못하게 상한을 둔다.
  //
  // Reuters 피드는 공식 RSS가 아니라 구글 뉴스 검색(site:reuters.com …)이라 유입량이
  // 압도적이다 — 2026-09-08 실측으로 전체 후보 149건 중 59건(40%)이 Reuters였고,
  // 상위 12칸을 Reuters·FT가 전부 채운 적이 있다. 그러면 "여러 곳을 훑는다"는 취지가
  // 무의미해지고, 그날 Reuters가 무엇을 많이 냈는지에 목록이 좌우된다.
  //
  // 정렬을 건드리지 않고 순서대로 담으면서 매체별 개수만 제한한다 — 상한에 걸린
  // 매체의 다음 기사는 밀리고, 그 자리에 다른 매체의 다음 순위가 들어온다.
  const perOutlet = Math.max(2, Math.ceil(limit / 3));
  const used = new Map<string, number>();
  const ranked: DigestItem[] = [];
  const overflow: DigestItem[] = [];
  for (const it of ordered) {
    const n = used.get(it.source) ?? 0;
    if (n < perOutlet) { used.set(it.source, n + 1); ranked.push(it); }
    else overflow.push(it);
    if (ranked.length >= limit) break;
  }
  // 상한 때문에 자리를 못 채웠으면(매체가 적은 날) 밀어둔 것으로 메운다 —
  // 다양성 때문에 목록이 비는 것은 본말이 전도된 것이다.
  for (const it of overflow) {
    if (ranked.length >= limit) break;
    ranked.push(it);
  }

  return {
    items: ranked,
    feeds: results.map(r => ({ name: r.feed.name, ok: r.ok, count: r.entries.length })),
  };
}
