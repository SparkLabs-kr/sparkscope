/**
 * 기사 본문 스크래퍼 — RawArticle.link로 원문 페이지를 요청해 본문 텍스트만 추출.
 * RSS/네이버 검색 API는 title/link만 주기 때문에, 본문이 필요하면 이 모듈로 별도 요청해야 함.
 *
 * 설계 원칙:
 * - 언론사별 맞춤 규칙은 유지보수 부담이 크므로 만들지 않음. 대신 일반적인 본문 후보 셀렉터를
 *   우선순위대로 시도하고, 다 실패하면 "텍스트 밀도가 가장 높은 블록"을 고르는 휴리스틱으로 폴백.
 * - 실패(타임아웃, 404, 페이월, 봇 차단 등)는 예외로 던지지 않고 null 반환 — 본문 스크래핑은
 *   보조 데이터이므로 실패해도 title 기반 분류로 이어지는 나머지 파이프라인이 죽으면 안 됨.
 * - 토큰 비용/LLM 입력 길이를 고려해 본문은 일정 길이로 잘라서 반환.
 */
import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_CHARS = 2_000; // Haiku 입력에 넣을 상한 (약 1,000~1,500 토큰 수준)
const MIN_BODY_CHARS = 80; // 이보다 짧으면 추출 실패로 간주 (본문 대신 에러 메시지 등만 긁혔을 가능성)

// 흔히 쓰이는 본문 컨테이너 셀렉터 (우선순위 순 — 국내 언론사 CMS에서 자주 보이는 패턴 위주)
const BODY_SELECTORS = [
  'article',
  '#dic_area', // 네이버 뉴스 (모바일/PC 공용 캐시 페이지)
  '#articleBodyContents',
  '#articeBody',
  '.article_body',
  '.article-body',
  '.news_end',
  '[itemprop="articleBody"]',
  'main',
];

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer', 'aside',
  '.ad', '.ads', '.advertisement', '.banner',
  '.reporter_area', '.byline', '.copyright',
  'figure', 'figcaption',
];

export interface ScrapedBody {
  text: string;
  truncated: boolean;
}

export async function scrapeArticleBody(link: string): Promise<ScrapedBody | null> {
  const html = await fetchHtml(link);
  if (!html) return null;

  const $ = cheerio.load(html);
  REMOVE_SELECTORS.forEach(sel => $(sel).remove());

  const candidate = pickBodyText($);
  if (!candidate || candidate.length < MIN_BODY_CHARS) return null;

  const truncated = candidate.length > MAX_BODY_CHARS;
  return {
    text: truncated ? candidate.slice(0, MAX_BODY_CHARS) : candidate,
    truncated,
  };
}

async function fetchHtml(link: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(link, {
      headers: { 'User-Agent': 'Mozilla/5.0 SparkScope/0.1' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;
    return await res.text();
  } catch {
    return null; // 타임아웃, 네트워크 오류, 봇 차단 등 — 조용히 실패 처리
  } finally {
    clearTimeout(timer);
  }
}

function pickBodyText($: cheerio.CheerioAPI): string | null {
  // 1) 알려진 셀렉터부터 순서대로 시도
  for (const sel of BODY_SELECTORS) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const text = normalizeText(el.text());
    if (text.length >= MIN_BODY_CHARS) return text;
  }

  // 2) 폴백: 텍스트 밀도가 가장 높은 <div>/<section> 하나 선택
  //    (텍스트 길이 대비 태그 수가 적은, 즉 "글자만 빽빽한" 블록을 본문으로 추정)
  let best: { text: string; score: number } | null = null;
  $('div, section').each((_, node) => {
    const el = $(node);
    const text = normalizeText(el.text());
    if (text.length < MIN_BODY_CHARS) return;
    const childTags = el.find('*').length || 1;
    const score = text.length / childTags;
    if (!best || score > best.score) best = { text, score };
  });
  return best ? (best as { text: string; score: number }).text : null;
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}
