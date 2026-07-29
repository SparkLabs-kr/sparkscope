/**
 * 구글 뉴스 RSS 프록시 링크(news.google.com/rss/articles/...)를 실제 언론사 URL로 변환.
 *
 * 구글이 공식 문서화하지 않은 내부 batchexecute API를 사용 — 브라우저가 구글 뉴스 기사를
 * 클릭했을 때 내부적으로 호출하는 API를 그대로 재현한 것. 구글이 내부 구조를 바꾸면 깨질 수
 * 있으므로, 실패 시 예외를 던지지 않고 null만 반환 (호출부에서 네이버 재검색 등으로 폴백).
 */
import * as cheerio from 'cheerio';

const TIMEOUT_MS = 6_000;
// 이 엔드포인트는 일반 UA로는 400을 던짐 — 실제 브라우저 UA가 필요.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export async function resolveGoogleNewsUrl(googleNewsUrl: string): Promise<string | null> {
  try {
    const base64Str = extractArticleId(googleNewsUrl);
    if (!base64Str) return null;

    const params = await fetchDecodingParams(base64Str);
    if (!params) return null;

    return await decodeRealUrl(params);
  } catch {
    return null;
  }
}

// news.google.com/rss/articles/{id} 또는 /read/{id} 형태에서 id 부분만 추출.
function extractArticleId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('news.google.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'articles' || p === 'read');
    if (idx === -1 || idx === parts.length - 1) return null;
    return parts[idx + 1];
  } catch {
    return null;
  }
}

interface DecodingParams {
  signature: string;
  timestamp: string;
  articleId: string;
}

// 기사 페이지 HTML에 심어진 서명(signature)·타임스탬프 추출 — batchexecute 호출에 필요.
async function fetchDecodingParams(articleId: string): Promise<DecodingParams | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://news.google.com/articles/${articleId}`, {
      headers: { 'User-Agent': UA },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const html = await res.text();

    const $ = cheerio.load(html);
    const div = $('c-wiz > div[jscontroller]').first();
    const signature = div.attr('data-n-a-sg');
    const timestamp = div.attr('data-n-a-ts');
    if (!signature || !timestamp) return null;

    return { signature, timestamp, articleId };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 구글 내부 batchexecute RPC를 호출해 진짜 언론사 URL을 알아냄.
async function decodeRealUrl(params: DecodingParams): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const innerPayload = JSON.stringify([
      'garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      params.articleId,
      Number(params.timestamp),
      params.signature,
    ]);
    // 3중 배열 중첩 필수: [ [ [rpcId, payload] ] ] — 하나라도 빠지면 400.
    const reqBody = JSON.stringify([[['Fbv4je', innerPayload]]]);

    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': UA,
      },
      body: `f.req=${encodeURIComponent(reqBody)}`,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();

    // 응답 형식: ")]}'\n\n<길이>\n[...실제 데이터...]\n<길이>\n[...]" — 두 번째 청크에 실제 payload.
    const chunks = text.split('\n\n');
    if (chunks.length < 2) return null;
    const outer = JSON.parse(chunks[1]).slice(0, -2);
    const inner = JSON.parse(outer[0][2]);
    const decodedUrl = inner[1];
    return typeof decodedUrl === 'string' && decodedUrl.startsWith('http') ? decodedUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
