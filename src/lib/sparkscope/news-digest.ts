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
 * 그리고 "몇 개 매체가 1면에 걸었나"는 그보다 더 강한 신호다. 단순히 기사를 냈다가
 * 아니라 편집국이 그날의 머리기사로 골랐다는 뜻이고, 경쟁 매체 여럿이 동시에 그렇게
 * 했다면 업계가 그 사안을 큰일로 본다는 독립적인 합의다. 그 값(headlineOutlets)을
 * 중요도 바로 다음 기준으로 쓰고, 둘 이상이면 중요도에 바닥을 깔아준다.
 *
 * 순위 = 중요도 → 헤드라인 매체 수 → 헤드라인 자리 → 지표 소스 수 → 인기 등수
 *        → 다룬 매체 수 → 등급 → 최신순.
 */
import { FEEDS, INDICATOR_FEEDS, DOMAIN_KEYWORDS, type Feed } from './news-feeds';
import { scoreImportance, type Importance, type Verdict } from './news-importance';
import { groupSameStory } from './news-cluster';
import { collectPopular } from './news-popular';
import { readPopular, savePopular } from './news-popular-store';
import { extractTrendKeywords, type TrendKeyword } from './news-keywords';
import { corroborate } from './news-corroborate';

export type NewsDomain = 'ai' | 'bio';

export interface DigestItem {
  title: string;
  /** EN 화면용 제목. 원문이 한국어일 때만 채운다(news-summary.ensureTitleEn). */
  titleEn?: string | null;
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
   * 이 사안을 헤드라인(1면)으로 걸어 둔 매체 수. 0이면 아무도 안 걸었다는 뜻.
   *
   * 조회수와 다른 신호다 — 조회수는 "많이 클릭됐다"이고 이건 "편집국이 오늘 가장
   * 중요하다고 판단했다"다. 서로 경쟁하는 매체 둘 이상이 같은 사안을 동시에 1면에
   * 걸면 업계 합의로 본다(아래 HEADLINE_CONSENSUS).
   */
  headlineOutlets: number;
  /** 그중 가장 위쪽 자리(1 = 히어로). 없으면 null. */
  headlineRank: number | null;
  /**
   * 그 자리를 준 매체. 대표 기사의 매체와 다를 수 있다 — 사건 병합 뒤 대표는 등급으로
   * 고르는데(STAT tier1 > Fierce tier2), 1면에 건 곳은 다른 매체일 수 있기 때문이다.
   * 실제로 그랬다: AZ COPD 건의 대표는 STAT인데 머리기사로 건 곳은 FierceBiotech여서
   * 화면에 "STAT News 머리기사"라는 틀린 문구가 나갔다.
   */
  headlineSource: string | null;
  /**
   * 지표 소스(컨설팅 리포트·벤더 블로그·큐레이션 뉴스레터) 중 이 사안을 다룬 곳 수.
   * 지표 소스 자체는 절대 화면에 뜨지 않는다 — 기사가 아니라 오피니언·발표이므로
   * "뉴스"로 띄우면 안 된다는 판단(2026-09-08). 대신 우리가 가진 기사와 같은
   * 사안이면 그 기사가 지금 업계 의제라는 근거가 된다.
   */
  indicatorOutlets: number;
  /** 어느 지표 소스가 다뤘나 — 근거를 화면에 밝히기 위한 값. */
  indicators: { source: string; title: string; url: string }[];
  /**
   * 이 항목 자체가 지표 소스인가. 내부 표시일 뿐이고, 결과에 true인 항목은 없다 —
   * 사건 병합 뒤에 전부 걸러낸다. 사실상 collectDigest 안에서만 산다.
   */
  indicator?: boolean;
  /** 국내(한국) 업계·정책 소식인가. 한국 매체가 보도한 해외 소식은 false다. */
  domestic: boolean;
  /**
   * 한국 매체가 아닌 곳도 이 사안을 다뤘는가.
   *
   * "국내 소식은 큰 것만"의 판정 기준이다. 우리가 직접 "삼성·SK하이닉스는 글로벌,
   * KAIST·중소 제약사는 국내"라고 목록을 관리하면 금방 낡는다. 대신 해외 매체가
   * 함께 다뤘는지를 본다 — 실제로 글로벌한 사안이면 로이터·FT가 쓰고, 국내에서만
   * 의미 있는 사안이면 한국 매체만 쓴다. 목록을 유지할 필요가 없고 자동으로 맞는다.
   */
  foreignCoverage: boolean;
  /** 이 기사를 낸 곳이 한국 매체인가. foreignCoverage 계산에만 쓴다. */
  fromKorean?: boolean;
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
  // companyEn/reasonEn 은 EN 화면용 — news-portfolio.ensurePortfolioHitsEn 이 채운다.
  // (여기에 인라인으로 두는 건 news-portfolio 와의 순환 import 를 피하기 위해서다.)
  portfolio?: { company: string; reason: string; companyEn?: string | null; reasonEn?: string | null }[] | null;
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

/**
 * 한 프로세스 안에서 같은 피드를 다시 긁지 않게 잠깐 들고 있는다.
 *
 * 왜 필요한가 — collectDigest는 사전계산 한 번에 창 6개(도메인 2 × 기간 3)로 불리고,
 * 그때마다 피드 40곳을 처음부터 다시 긁었다. 매시간 도니까 하루 40×6×24 = 5,760번
 * 매체를 때린 셈이다(2026-09-10 확인). 돈이 드는 건 아니지만 남의 서버를 축내고,
 * 우리가 이미 Cloudflare 차단·429를 겪고 있는 상황에서 스스로 위험을 키우는 일이다.
 *
 * 같은 실행 안에서는 창이 달라도 피드 내용이 같아야 맞으므로, 캐시가 오히려 창 간
 * 일관성을 높인다.
 *
 * Next의 데이터 캐시(next: { revalidate })를 쓰지 않는 이유는 그대로다 — 그쪽은 본문을
 * 전부 버퍼에 담아서 아래 스트림 절단이 무의미해지고 2MB 제한에 걸린다. 여기서는
 * 이미 잘라 낸 문자열만 들고 있는다.
 */
const FEED_MEMO_MS = 10 * 60_000;
/**
 * 크기 제한은 두지 않는다 — 본문은 이미 FEED_MAX_BYTES에서 잘려 들어오므로
 * 한 항목이 커질 수 있는 한계가 정해져 있고, 항목 수도 아래에서 제한한다.
 * 40곳 전부 담아도 메모리는 약 7MB다(중위 46KB, 큰 것은 1.5MB에서 절단).
 *
 * 크기 조건을 두었다가 두 번 헛돌았다:
 *  · 500KB로 잡으니 큰 피드 5곳(TechNode 11MB·Ahead of AI 2.8MB 등)이 빠져 절감이
 *    절반에 그쳤다(144→68건).
 *  · FEED_MAX_BYTES와 같게 올려도 여전히 빠졌다. 읽기 루프가 상한을 넘길 때까지
 *    청크를 통째로 붙이므로 total이 1,500,000을 조금 넘기고, 그래서 조건에서 탈락했다.
 *    경계를 맞추는 대신 조건 자체를 없앴다.
 */
const FEED_MEMO_MAX_ENTRIES = 60;
const feedMemo = new Map<string, { at: number; body: string }>();

/**
 * 실패도 잠깐 기억한다.
 *
 * 성공만 기억했더니 실패한 피드는 창마다 다시 시도돼서 절감이 62건에서 멈췄다
 * (2026-09-10 실측: 창당 7곳이 재시도됐다). 그 7곳은 Fierce 403·BioCentury 503처럼
 * 지금 막혀 있거나 죽은 곳이다 — 같은 실행 안에서 여섯 번 더 두드려도 결과는 같고,
 * 차단된 호스트를 더 두드리는 것은 상황을 나쁘게만 만든다.
 *
 * 성공보다 짧게 잡는다. 일시적 오류(503)라면 다음 실행에서 다시 시도하는 편이 낫다.
 */
const FEED_FAIL_MEMO_MS = 3 * 60_000;
const feedFailMemo = new Map<string, { at: number; err: string }>();

async function getFeed(url: string): Promise<string> {
  const hit = feedMemo.get(url);
  if (hit && Date.now() - hit.at < FEED_MEMO_MS) return hit.body;
  const failed = feedFailMemo.get(url);
  if (failed && Date.now() - failed.at < FEED_FAIL_MEMO_MS) throw new Error(failed.err);

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8' },
    cache: 'no-store',
  });
  if (!res.ok) {
    feedFailMemo.set(url, { at: Date.now(), err: String(res.status) });
    throw new Error(`${res.status}`);
  }

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
  const body = new TextDecoder('utf-8').decode(buf);

  // 오래된 항목부터 지운다 — Map은 삽입 순서를 지키므로 첫 키가 가장 오래된 것이다.
  if (feedMemo.size >= FEED_MEMO_MAX_ENTRIES) {
    const oldest = feedMemo.keys().next().value;
    if (oldest) feedMemo.delete(oldest);
  }
  feedMemo.set(url, { at: Date.now(), body });
  return body;
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

/**
 * 몇 개 매체가 1면에 걸어야 "업계 합의"로 볼지. 둘이면 충분하다 —
 * 서로 경쟁하는 매체가 같은 날 같은 사안을 머리기사로 고르는 것은 우연이 아니다.
 */
const HEADLINE_CONSENSUS = 2;

/**
 * 한 매체의 최상단 자리만으로는 중요도 바닥을 주지 않는다(2026-09-10에 되돌림).
 *
 * 아래 원래 이유는 "최상단 한 자리는 편집국이 오늘 이게 제일 큰일이라고 말한 것"이었다.
 * 그런데 그 전제가 매체마다 성립하지 않는다 — TechCrunch AI 카테고리 페이지는
 * 편집 순서가 아니라 최신순이었다(1→3→4→5시간 전으로 실측). 그 결과 "1시간 전에
 * 올라온 기사"가 머리기사로 인정되어 중요도 5점 바닥을 받고 1위로 올라왔다.
 *
 * 이제 바닥은 두 곳 이상이 함께 1면에 걸었을 때만 준다. 한 곳의 자리는 순위의
 * tiebreak로만 쓴다(byRank의 hrank). 아래 옛 근거는 기록으로 남긴다.
 *
 * ── 옛 근거(2026-09-09) ──
 * 합의가 없어도 최상단 머리기사 하나는 그 자체로 충분한 근거로 본다.
 *
 * 처음에는 "두 곳 이상"만 인정했는데, 그러면 매체 한 곳이 막히는 순간 기준이 무너진다.
 * 실제로 그랬다 — FierceBiotech는 내 맥에서 200인데 Vercel 서버리스에서는 403이다
 * (데이터센터 IP 차단, 2026-09-08 프로덕션 로그로 확인). 그래서 로컬에서는 노바티스
 * Phase 3 실패가 Fierce·Endpoints 두 곳 헤드라인으로 1위였는데, 프로덕션에서는
 * Endpoints 한 곳만 읽혀 문턱에 못 미치고 4위로 내려갔다.
 *
 * 지금 헤드라인을 읽을 수 있는 곳이 두세 곳뿐이니 "2곳 중 2곳 일치"는 너무 빡빡하다.
 * 그리고 어차피 최상단 한 자리는 편집국이 "오늘은 이게 제일 큰일이다"라고 말한 것이라,
 * 한 곳이어도 근거로 충분하다. 두 번째 자리까지 넓히면 매체마다 두 건씩 올라와
 * 상위가 헤드라인으로만 채워지므로 1위 자리에서 끊는다.
 */
const isConsensus = (outlets: number, _rank: number | null) =>
  outlets >= HEADLINE_CONSENSUS;

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

/**
 * 지표 소스 수집 — 항목으로는 쓰지 않고, 사건 병합에만 끼워 넣는다.
 *
 * 왜 토큰 클러스터가 아니라 LLM 병합 단계에 넣나: 지표는 대부분 영어고 우리 기사는
 * 한국어가 섞여 있어서 제목 단어가 겹치지 않는다("OpenAI's generational leap with
 * GPT-6 Astra" vs "세계 최고 AI 모델 'GPT-6 아스트라' 전격 공개"의 공통 토큰은 0이다).
 * LLM 병합은 언어를 넘어 같은 사안을 알아보므로 거기서만 쓸모가 있다.
 */
const INDICATOR_MAX = 20;

async function collectIndicators(domain: NewsDomain, cutoff: number): Promise<DigestItem[]> {
  const results = await Promise.all(INDICATOR_FEEDS.map(async (f: Feed) => {
    try {
      const entries = parseFeed(await getFeed(f.url));
      return entries.filter(e => {
        if (e.date && e.date.getTime() < cutoff) return false;
        if (f.domain === 'general') return DOMAIN_KEYWORDS[domain].test(e.title);
        return f.domain === domain;
      }).map(e => ({ ...e, feed: f }));
    } catch (e) {
      console.error('[news-digest] 지표 피드 실패:', f.name, e);
      return [];
    }
  }));

  return results.flat()
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    // 상한을 둔다 — 병합 프롬프트에 들어가는 양이 곧 비용이고, 오래된 리포트는
    // "지금 의제"를 말해 주지 않는다.
    .slice(0, INDICATOR_MAX)
    .map<DigestItem>(e => ({
      title: e.title,
      url: e.url,
      source: e.feed.name,
      independent: !!e.feed.independent,
      publishedAt: (e.date ?? new Date()).toISOString().slice(0, 10),
      tier: e.feed.tier,
      alsoIn: [],
      blurb: null,
      sourceText: null,
      grounding: 'headline',
      portfolio: null,
      summary: null,
      // 지표는 채점하지 않는다. 자기 점수로 목록에 오를 일이 없기 때문이다.
      importance: null,
      popularRank: null,
      headlineOutlets: 0,
      headlineRank: null,
      headlineSource: null,
      indicatorOutlets: 0,
      indicators: [],
      foreignCoverage: false,
      fromKorean: !!e.feed.korean,
      indicator: true,
      domestic: false,
    }));
}

export async function collectDigest(domain: NewsDomain, days = 7, limit = 12): Promise<{
  items: DigestItem[];
  feeds: { name: string; ok: boolean; count: number }[];
  /** 여러 매체가 함께 말한 이름 (news-keywords.ts). 실패하면 빈 배열. */
  keywords: TrendKeyword[];
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
        headlineOutlets: 0,
        headlineRank: null,
        headlineSource: null,
        indicatorOutlets: 0,
        indicators: [],
        domestic: false,
        // 이 단계의 클러스터는 제목 단어가 겹치는 것끼리라 같은 언어끼리 묶인다.
        // 언어를 넘는 병합은 뒤의 LLM 단계에서 되므로 거기서 다시 계산한다.
        foreignCoverage: c.members.some(m => !m.feed.korean),
        fromKorean: !!c.rep.feed.korean,
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
  //
  // DB에 쌓아 둔 관측을 읽는다 — 매체 홈페이지는 "지금 이 순간" 1면만 보여주므로
  // 조회할 때마다 긁으면 어제 1면을 휩쓴 사안이 오늘은 신호 0이 된다(실제로 노바티스
  // Phase 3 실패가 하루 만에 사라졌다). 2시간마다 도는 크론이 채운다.
  // 1면 기사의 날짜는 하루 단위라 같은 단위로 견줘야 한다(아래 필터 주석 참고).
  const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
  const popular = await readPopular(domain, cutoff).then(async rows => {
    if (rows.length > 0) return rows;
    // 첫 채움 — 크론이 아직 안 돌았거나 소스를 새로 추가한 직후. 화면이 비는 것보다 낫다.
    console.log(`[news-digest] ${domain} 헤드라인 기록 없음 — 즉석 수집 후 저장`);
    const fresh = await collectPopular(domain);
    await savePopular(domain, fresh).catch(e => console.error('[news-digest] 저장 실패(무시):', e));
    return fresh;
  }).catch(e => {
    console.error('[news-digest] 인기기사 조회 실패(무시):', e);
    return [] as Awaited<ReturnType<typeof collectPopular>>;
  });

  if (popular.length > 0) {
    const byUrl = new Map(items.map(i => [i.url, i] as const));
    // 제목으로도 찾는다 — 목록 페이지 URL에 view_type 같은 파라미터가 붙어 RSS와 다를 수 있다.
    const byTitle = new Map(items.map(i => [i.title.trim(), i] as const));
    for (const p of popular) {
      // 기간 밖 기사는 1면에 걸려 있어도 넣지 않는다.
      //
      // 예전에는 발행일을 몰라 전부 '오늘'로 적었고, 그래서 '오늘' 탭에 9월 8일
      // NYT 기사가 2026-09-11로 떴다(2026-09-11 지적).
      //
      // 날짜'만' 비교한다(시각이 아니라). 1면 기사의 날짜는 URL에서 뽑은 것이라
      // 그 날 자정으로 잡히는데, 시각까지 비교하면 어제 저녁 기사가 24시간 창을
      // 40시간 벗어난 것으로 계산돼 1면 신호가 통째로 사라진다(실측: 12건 전부 1면0).
      if (p.date && p.date.toISOString().slice(0, 10) < cutoffDay) continue;
      const hit = byUrl.get(p.url) ?? byTitle.get(p.title.trim());
      if (hit) {
        if (p.headlineRank != null) {
          // 같은 기사가 여러 곳 헤드라인에 걸릴 수는 없다(URL이 매체마다 다르다).
          // 여기서 세는 것은 "이 URL이 헤드라인이었나"까지고, 매체 수를 합치는 것은
          // 사건 병합 뒤에 한다 — 그때가 되어야 서로 다른 매체의 같은 사안이 한 줄이 된다.
          if (p.headlineRank < (hit.headlineRank ?? 99)) hit.headlineSource = p.source;
          hit.headlineRank = Math.min(hit.headlineRank ?? 99, p.headlineRank);
          hit.headlineOutlets = Math.max(hit.headlineOutlets, 1);
        } else {
          // 여러 매체 인기 목록에 오르면 더 높은 등수를 남긴다.
          hit.popularRank = Math.min(hit.popularRank ?? 99, p.rank);
        }
        continue;
      }
      items.push({
        title: p.title,
        url: p.url,
        source: p.source,
        independent: false,
        publishedAt: (p.date ?? new Date()).toISOString().slice(0, 10),
        tier: 2,
        alsoIn: [],
        blurb: null,
        sourceText: null,
        grounding: 'headline',
        portfolio: null,
        summary: null,
        importance: null,
        popularRank: p.headlineRank != null ? null : p.rank,
        headlineRank: p.headlineRank ?? null,
        headlineSource: p.headlineRank != null ? p.source : null,
        headlineOutlets: p.headlineRank != null ? 1 : 0,
        indicatorOutlets: 0,
        indicators: [],
        domestic: !!p.domestic,
        foreignCoverage: false,
        // 인기 목록의 domestic 표시가 곧 한국 매체 여부다(바이오인 집계는 전부 국내 매체).
        fromKorean: !!p.domestic,
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
  // 헤드라인 > 인기 목록 > 나머지. 헤드라인이 가장 강한 신호이므로 상한에 잘리면 안 된다.
  const forScoring = [
    ...items.filter(i => i.headlineRank != null),
    ...items.filter(i => i.headlineRank == null && i.popularRank != null),
    ...items.filter(i => i.headlineRank == null && i.popularRank == null),
  ];

  const verdicts = await scoreImportance(forScoring).catch(e => {
    console.error('[news-digest] 중요도 산정 실패 — 예전 기준으로 정렬합니다:', e);
    return new Map<string, Verdict>();
  });

  // 인기 등수는 중요도 바로 다음 기준이다. 매체가 실제 조회수로 매긴 값이라
  // "여러 매체가 다뤘나"보다 신뢰도가 높다 — 후자는 우리 병합 정확도에 의존한다.
  // 목록에 없는 기사는 큰 값으로 둬서 뒤로 가되, 중요도가 높으면 여전히 위에 온다.
  const rank = (it: { popularRank: number | null }) => it.popularRank ?? 99;
  const hrank = (it: { headlineRank: number | null }) => it.headlineRank ?? 99;

  /**
   * 최종 순위 기준. 두 군데(병합 전·후)에서 같은 순서를 써야 하므로 한 곳에 둔다 —
   * 예전에 두 정렬식이 따로 있어 한쪽만 고쳐지는 일이 있었다.
   *
   * 헤드라인 매체 수를 중요도 바로 다음에 둔다. 인기 등수(조회수)보다 앞이다 —
   * 조회수는 한 매체 독자들의 클릭이고, 헤드라인 합의는 서로 경쟁하는 편집국들의
   * 독립적인 판단이라 업계 중요도에 더 가깝다.
   */
  const byRank = (a: DigestItem, b: DigestItem) =>
    (b.importance ?? 3) - (a.importance ?? 3) ||
    b.headlineOutlets - a.headlineOutlets ||
    // 몇 매체가 이 사안을 다뤘나. 한 매체 안에서의 자리(hrank)보다 앞이다.
    //
    // 순서를 바꾼 이유(2026-09-10): 큰 사건은 여러 매체가 한꺼번에 다룬다 —
    // 속보가 터지면 KBS·MBC·JTBC가 동시에 보도하는 것과 같다. 반면 한 매체
    // 목록의 맨 위는 그 매체가 방금 올렸다는 뜻일 수도 있다. 실제로 TechCrunch
    // AI 카테고리는 편집 순서가 아니라 최신순이었고(1→3→4→5시간 전으로 확인),
    // 그 페이지 1위를 근거로 "1시간 전 기사"가 1면 톱으로 올라왔다.
    b.alsoIn.length - a.alsoIn.length ||
    hrank(a) - hrank(b) ||
    rank(a) - rank(b) ||
    // 지표(리포트·벤더 블로그·뉴스레터)는 여기까지 다 같을 때만 본다.
    //
    // 처음에는 인기 등수보다 앞에 뒀는데 그게 틀렸다(2026-09-09). 벤더 블로그는
    // 제품을 낼 때마다 반드시 쓰므로 선별적인 신호가 아니다 — "딥마인드가 블로그에
    // 썼다"는 사실은 구글이 뭔가를 냈다는 것 이상을 말해 주지 않는다. 반면 인기
    // 1위와 "다른 매체 2곳도 보도"는 누군가가 실제로 골랐다는 뜻이다.
    //
    // 그 순서 때문에 실제로 이런 일이 났다: '제미나이 3.8 플래시'(지표1·인기2위·함께0)가
    // 'GPT-6 아스트라'(지표0·인기1위·함께2)를 제치고 1위로 올라왔다. 더 약한 근거가
    // 더 강한 근거를 이긴 것이다.
    b.indicatorOutlets - a.indicatorOutlets ||
    // 다른 게 같으면 해외 매체를 먼저 둔다. 이 화면은 해외 트렌드를 보는 자리이고,
    // 국내 매체가 전한 해외 소식은 원 매체가 쓴 것보다 한 다리 건넌 것이다.
    // 강한 기준은 아니다 — 신호가 확실하면(GPT-6 아스트라처럼 인기 1위 + 여러 매체)
    // 국내 매체 기사도 그대로 1위로 온다.
    Number(!!a.fromKorean) - Number(!!b.fromKorean) ||
    a.tier - b.tier ||
    b.publishedAt.localeCompare(a.publishedAt);

  const scored = items
    .map(it => {
      const v = verdicts.get(it.url);
      // 국내 여부는 채점 결과를 우선한다 — 수집 경로(국내 매체)가 아니라 기사 주제가 기준이다.
      // 한국 매체가 보도한 오픈AI 소식은 국내 소식이 아니다.
      return { ...it, importance: v?.score ?? null, domestic: v ? v.domestic : it.domestic };
    })
    .sort(byRank);

  // 국내 소식은 문턱을 높인다.
  //
  // 이 화면의 목적은 해외 트렌드를 보는 것이고, 국내 업계 동향은 Intra 탭이 따로 다룬다.
  // 국내 집계판(bioin 등)을 넣으면 R&D 예산·기관 통합·인사 같은 기사가 조회수만으로
  // 상위를 채우는데, 그건 여기서 볼 것이 아니다. "우리나라 뉴스는 엄청 큰 이슈만"이라는
  // 기준(2026-09-08 합의)을 4점 이상으로 옮겼다.
  //
  // 해외 소식은 그대로 3점까지 통과한다 — 국내만 기준이 다르다.
  const DOMESTIC_MIN: Importance = 4;
  // 헤드라인에 걸린 것은 문턱을 면제한다 — 어느 매체 편집국이 1면에 걸었다면
  // 이미 "큰 이슈"라는 판단이 들어간 것이고, 우리 채점이 그것보다 정확하지 않다.
  const passable = scored.filter(
    it => !it.domestic || it.headlineRank != null || (it.importance ?? 0) >= DOMESTIC_MIN);

  // 병합 대상 — 최종 노출 수의 세 배 정도만. 같은 사건이 셋으로 쪼개져도 이 안에 든다.
  const news = passable.slice(0, Math.max(limit * 3, 20));
  const rest = passable.slice(news.length);

  // 지표를 여기서 합친다. 점수와 무관하게 무조건 넣는다 — 지표는 채점하지 않으므로
  // 점수로 줄을 세우면 전부 뒤로 밀려 병합 대상에 들지 못한다.
  const indicators = await collectIndicators(domain, cutoff).catch(e => {
    console.error('[news-digest] 지표 수집 실패(무시):', e);
    return [] as DigestItem[];
  });
  const shortlist = [...news, ...indicators];

  // 발췌를 함께 넘긴다 — 제목이 서로 완전히 다른 같은 사건을 묶으려면 필요하다
  // (news-cluster.ts의 나비에–스토크스 사례). sourceText가 없는 항목은 매체 설명으로
  // 대신하고, 그것도 없으면 제목만 넘어간다.
  const ask = (list: { title: string; hint: string | null }[]) =>
    groupSameStory(list).catch(e => {
      console.error('[news-digest] 사건 병합 실패 — 병합 없이 진행합니다:', e);
      return list.map((_, i) => [i]);
    });
  const brief = (it: DigestItem) => ({ title: it.title, hint: it.sourceText ?? it.blurb ?? null });

  // 두 번 묻는다. 한 번으로는 놓친다.
  //
  // 목록이 30건을 넘으면 어휘가 거의 겹치지 않는 같은 사건 쌍을 빠뜨린다 — 2026-09-11
  // 실측: "Chinese AI labs secretly used millions of Claude exchanges"(CNBC)와
  // "Anthropic details distillation campaigns from Alibaba, Moonshot AI, and DeepSeek"
  // (TechCrunch)가 안 묶여 같은 사건이 10위와 12위에 따로 올랐다. 둘만 떼어 물으면
  // 정확히 묶는다. 그래서 1차 묶음의 대표만 모아 한 번 더 묻는다 — 목록이 짧아져
  // 놓친 쌍이 드러난다. 호출 한 번(gpt-4o-mini, 20건 내외)이 더 들 뿐이다.
  let groups = (await ask(shortlist.map(brief))).map(idx => idx.map(i => shortlist[i]));
  if (groups.length > 1) {
    const second = await ask(groups.map(g => brief(g[0])));
    if (second.length < groups.length) {
      const before = groups;
      groups = second.map(idx => idx.flatMap(i => before[i]));
      console.log(`[news-digest] 2차 병합에서 ${before.length - groups.length}건을 더 묶었습니다`);
    }
  }

  const merged: DigestItem[] = groups.flatMap(all => {
    // 지표는 대표가 될 수 없고 "함께 보도"에도 세지 않는다 — 기사가 아니니까.
    const group = all.filter(g => !g.indicator);
    const ind = all.filter(g => g.indicator);
    // 지표만 모인 그룹은 통째로 버린다. 맥킨지 리포트가 단독으로 목록에 오르는 일은 없다.
    if (group.length === 0) return [];

    // 대표는 등급이 높은 쪽, 같으면 최신. 중요도는 그룹 최고값을 쓴다 —
    // 같은 사건인데 한 매체 제목이 모호해 낮게 채점된 것 때문에 강등되면 안 된다.
    const rep = group.reduce((best, cur) =>
      cur.tier < best.tier || (cur.tier === best.tier && cur.publishedAt > best.publishedAt) ? cur : best);
    const outlets = new Map<string, string>();
    for (const g of group) {
      if (g.source !== rep.source) outlets.set(g.source, g.url);
      for (const a of g.alsoIn) if (a.source !== rep.source) outlets.set(a.source, a.url);
    }
    // 서로 다른 매체가 같은 사안을 1면에 걸었는지는 여기서만 알 수 있다 —
    // 병합 전에는 URL이 매체마다 달라 각각 별개 항목이었다.
    const headlineOutlets = new Set(
      group.filter(g => g.headlineRank != null).map(g => g.source)).size;
    // 가장 위쪽 자리를 준 매체를 같이 들고 온다 — 대표 매체와 다를 수 있다.
    const lead = group
      .filter(g => g.headlineRank != null)
      .sort((a, b) => (a.headlineRank ?? 99) - (b.headlineRank ?? 99))[0];
    const headlineRank = lead?.headlineRank ?? null;
    const headlineSource = lead?.headlineSource ?? lead?.source ?? null;
    // 한국 매체가 아닌 곳이 하나라도 이 사안을 다뤘는가. 언어를 넘는 병합이 끝난
    // 지금이 이걸 물어볼 수 있는 시점이다.
    const foreignCoverage = group.some(g => !g.fromKorean || g.foreignCoverage);

    return [{
      ...rep,
      headlineOutlets,
      headlineRank,
      headlineSource,
      foreignCoverage,
      indicatorOutlets: new Set(ind.map(g => g.source)).size,
      indicators: ind.map(g => ({ source: g.source, title: g.title, url: g.url })),
      // 대표를 그대로 펼치면 내부 표시가 따라올 수 있다 — 명시적으로 끈다.
      indicator: false,
      // 경쟁 매체 둘 이상이 동시에 1면에 걸었으면 최소 4점을 보장한다.
      //
      // 우리 채점은 제목만 보고 하는 판단이라 업계 맥락을 놓친다 — "Novartis' Phase 3
      // cardiovascular study miss"는 제목만으로는 흔한 임상 실패로 보이지만, 실제로는
      // 120억 달러 인수의 핵심 자산이 무너진 사건이어서 세 매체가 나란히 헤드라인으로
      // 걸었다. 편집국 여럿의 독립적인 합의를 우리 점수보다 신뢰한다.
      //
      // 바닥을 최고점(5)으로 잡는 이유: 4로 두면 5점을 받은 다른 기사들 아래로 밀려
      // 기준을 넣은 의미가 없어진다(실측: 세 매체가 나란히 건 노바티스 건이 국내
      // R&D 예산 기사 아래 4위에 있었다). 5로 올려 동점으로 만들면 그다음 기준인
      // headlineOutlets가 갈라준다 — 합의가 있는 쪽이 위로 온다.
      importance: isConsensus(headlineOutlets, headlineRank)
        ? (Math.max(groupImportance(group) ?? 0, 5) as Importance)
        : groupImportance(group),
      // 그룹 안에서 가장 높은 등수를 쓴다 — 같은 사건인데 한 매체에서만 인기 목록에
      // 올랐다면 그 사건이 인기라는 뜻이다.
      popularRank: group.reduce<number | null>(
        (m, g) => (g.popularRank == null ? m : m == null ? g.popularRank : Math.min(m, g.popularRank)), null),
      alsoIn: [...outlets.entries()].map(([source, url]) => ({ source, url })),
      // 요약 근거도 합친다 — 매체마다 강조점이 달라 한 곳만 볼 때보다 두터워진다.
      //
      // 대표 기사의 본문을 반드시 맨 앞에 둔다. 순서를 안 정해 두면 병합이 조금이라도
      // 틀렸을 때 제목과 요약이 서로 다른 사건을 말한다 — 실제로 '제미나이 3.8 플래시'
      // 제목에 '웨더넥스트 3' 요약이 붙어 나갔다(2026-09-09). 요약이 제목을 배신하는
      // 것은 병합 오류보다 더 나쁘게 읽힌다.
      sourceText: [rep, ...group.filter(g => g !== rep)]
        .map(g => g.sourceText).filter(Boolean).slice(0, 3).join('\n\n---\n\n') || null,
      blurb: rep.blurb ?? group.find(g => g.blurb)?.blurb ?? null,
    }];
  });

  // 국내에서만 다룬 소식은 여기서 뺀다.
  //
  // 이 화면의 목적은 해외 트렌드를 보는 것이고, 국내 업계 동향은 Intra 탭이 따로 다룬다.
  // 앞의 DOMESTIC_MIN(4점)만으로는 부족했다 — R&D 예산·기관 통합·국내 신약 허가·표창
  // 같은 기사가 4~5점을 받아 상위를 채웠다(2026-09-09 실측: 상위 8건 중 4건).
  //
  // 다만 "한국 = 제외"는 틀렸다. 삼성·SK하이닉스처럼 글로벌 사안도 국내 매체가 먼저
  // 쓴다. 그래서 회사 목록을 관리하는 대신 해외 매체가 함께 다뤘는지를 본다 —
  // 실제로 글로벌한 사안이면 로이터·FT가 쓰고, 국내에서만 의미 있으면 한국 매체만 쓴다.
  // 목록을 유지할 필요가 없고 매체 구성이 바뀌어도 자동으로 맞는다.
  const domesticOnly = (it: DigestItem) => it.domestic && !it.foreignCoverage;
  const globalish = [...merged, ...rest].filter(it => !domesticOnly(it));

  // 병합으로 자리가 비면 뒤쪽 후보가 올라온다.
  const ordered = globalish
    .sort(byRank);

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

  // 목록에 올린 기사 중 한 매체만 다룬 것은 다른 매체를 찾아 붙인다.
  // 어차피 화면에 올릴 기사라면 다른 매체의 원문도 함께 주는 편이 낫다.
  // 순위를 다시 매기지 않는다 — 이미 정해진 목록에 링크를 덧붙이는 것이다.
  await corroborate(ranked).catch(e => console.error('[news-digest] 교차 보도 확인 실패(무시):', e));

  // 기사 단위 순위와 별개로 "여러 매체가 함께 말한 이름"을 뽑는다.
  // 후보 전체(상위 후보 순)를 넘긴다 — 목록에 든 12건만 보면 이미 순위가 걸러낸 것을
  // 다시 세는 꼴이라, 흩어져 있어서 순위에 못 든 사안을 놓친다.
  const keywords = await extractTrendKeywords(
    passable.map(it => ({ url: it.url, title: it.title, source: it.source, importance: it.importance })),
  ).catch(e => {
    console.error('[news-digest] 키워드 추출 실패(무시):', e);
    return [] as TrendKeyword[];
  });

  return {
    items: ranked,
    feeds: results.map(r => ({ name: r.feed.name, ok: r.ok, count: r.entries.length })),
    keywords,
  };
}
