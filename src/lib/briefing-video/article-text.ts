/**
 * 대본 재료용 기사 본문 발췌 — 3분 개편안(2026-10-07)은 기사마다 숫자·맥락을 요구하는데, 저장된 건 제목과
 * AI 한 줄 요약뿐이라 금액·지분·배경이 대본에 들어갈 수 없었다. 원문 페이지의 문단(<p>)을 앞에서부터
 * 1,500자 정도 읽어 온다. 실패하면 빈 문자열 — 그때는 제목·요약만으로 쓴다(대본이 사실을 지어내지 않게).
 */
import { resolveGoogleNewsUrl } from '../sparkscope/google-news-resolver';

const ENT = { nbsp: ' ', quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', hellip: '…', ndash: '–', mdash: '—' };
const strip = (s: string) => s
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(nbsp|quot|apos|amp|lt|gt|lsquo|rsquo|ldquo|rdquo|middot|hellip|ndash|mdash);/g, (_, e) => ENT[e as keyof typeof ENT])
  .replace(/\s+/g, ' ').trim();

/**
 * 기사 본문 영역만 잘라낸다 — 페이지 전체의 <p>를 모으면 옆의 "많이 본 뉴스" 문단까지 섞여, 스카이랩스 기사 자리에
 * 로지스팟 대본이 나왔다(2026-10-07 초안). 국내 언론 CMS가 쓰는 본문 표시(itemprop=articleBody, article-view-content-div,
 * <article> 등)를 먼저 찾고, 없을 때만 페이지 전체를 본다.
 */
function bodyRegion(html: string): string {
  const marks = [
    /itemprop=["']articleBody["']/i, /id=["']article-view-content-div["']/i, /id=["']articleBody["']/i,
    /id=["']articeBody["']/i, /class=["'][^"']*(article[-_]body|news[-_]body|article_txt|view_cont|news_view)[^"']*["']/i, /<article[\s>]/i,
  ];
  for (const m of marks) {
    const i = html.search(m);
    if (i >= 0) return html.slice(i, i + 60_000);
  }
  return html;
}

/** 제목의 핵심 낱말(회사·고유명사)이 본문에 2개 이상 나오는가 — 엉뚱한 기사를 대본 재료로 쓰지 않게. */
function matchesTitle(text: string, title: string, strict = false): boolean {
  const words = [...new Set(title.replace(/[^0-9a-zA-Z가-힣\s]/g, ' ').split(/\s+/)
    .filter(w => (/[가-힣]/.test(w) ? w.length >= 2 : w.length >= 3)))];
  if (words.length === 0) return true;
  const hit = words.filter(w => text.includes(w)).length;
  // 다른 매체에서 찾은 기사는 같은 회사의 다른 소식일 수 있어(스파크랩 기사는 매일 여러 건) 낱말 절반 이상이 맞아야 한다.
  return hit >= (strict ? Math.max(2, Math.ceil(words.length / 2)) : Math.min(2, words.length));
}

/** 한 페이지에서 본문 문단을 읽는다. 150자 미만이면(로그인·구독 벽, 자바스크립트로만 그리는 페이지) 실패로 본다. */
async function readPage(url: string, max: number, title = '', strict = false): Promise<string> {
  if (!/^https?:\/\//.test(url)) return '';
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(7000) });
    const full = (await r.text()).slice(0, 600_000);
    return extract(bodyRegion(full), max, title, strict) || extract(full, max, title, strict);
  } catch {
    return '';
  }
}

function extract(html: string, max: number, title: string, strict: boolean): string {
  {
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => strip(m[1]));
    // <p>가 없는 CMS(줄바꿈 <br>만 쓰는 곳)는 영역 텍스트 전체를 쓴다
    const blocks = paras.length >= 2 ? paras : strip(html.slice(0, 20_000)).split(/(?<=[.다])\s+/);
    let out = '';
    for (const p of blocks.filter(t => t.length >= 40 && !/무단\s*전재|재배포|저작권|Copyright|@[a-z0-9.-]+\.[a-z]{2,}/i.test(t))) {
      if (out.length + p.length > max) break;
      out += (out ? ' ' : '') + p;
    }
    if (out.length < 150) return '';
    return !title || matchesTitle(out, title, strict) ? out.slice(0, max) : '';
  }
}

// 구독 벽·봇 차단으로 본문을 못 주는 매체 — 바로 다른 보도로 넘어간다(2026-10-07 실측: Reuters 401, Nature 빈 페이지)
const WALLED = /reuters\.com|nytimes\.com|ft\.com|bloomberg\.com|wsj\.com|nature\.com|economist\.com|theinformation\.com/;

/** 같은 소식을 다룬 다른 매체 기사 — 구글 뉴스에서 제목으로 찾아 열리는 첫 기사(최대 4곳 시도). */
async function otherCoverage(title: string, max: number): Promise<string> {
  const q = title.replace(/[‘’“”"'…·|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const korean = /[가-힣]/.test(q);
  const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${korean ? 'hl=ko&gl=KR&ceid=KR:ko' : 'hl=en-US&gl=US&ceid=US:en'}`;
  try {
    const xml = await (await fetch(rss, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) })).text();
    const links = [...xml.matchAll(/<link>(https:\/\/news\.google\.com\/rss\/articles\/[^<]+)<\/link>/g)].map(m => m[1]).slice(0, 6);
    let tried = 0;
    for (const g of links) {
      if (tried >= 4) break;
      const real = await resolveGoogleNewsUrl(g).catch(() => null);
      if (!real || WALLED.test(real)) continue;
      tried++;
      const text = await readPage(real, max, title, true);
      if (text) return text;
    }
  } catch { /* 검색 실패 — 빈 문자열 */ }
  return '';
}

/**
 * 기사 본문 발췌. 순서: 원문(구글 중계 주소면 먼저 풀어서) → 막혀 있으면 같은 소식을 다룬 다른 매체.
 * 2026-10-07 소윤: "스카이랩스처럼 각 뉴스가 이 정도로 길어야" — 재료가 없으면 대본이 한 줄로 끝나서 넓혀 찾는다.
 */
export async function articleExcerpt(url: string, title = '', max = 1800): Promise<string> {
  let real = url;
  if (url.includes('news.google.com')) real = (await resolveGoogleNewsUrl(url).catch(() => null)) ?? '';
  const direct = real && !WALLED.test(real) ? await readPage(real, max, title) : '';
  if (direct) return direct;
  return title ? otherCoverage(title, max) : '';
}
