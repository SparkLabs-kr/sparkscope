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

async function getFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8' },
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
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
      };
    })
    .sort((a, b) =>
      b.alsoIn.length - a.alsoIn.length ||
      a.tier - b.tier ||
      b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);

  return {
    items,
    feeds: results.map(r => ({ name: r.feed.name, ok: r.ok, count: r.entries.length })),
  };
}
