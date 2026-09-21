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

/**
 * 여러 구글 뉴스 링크를 제한된 동시성으로 한 번에 해석한다.
 *
 * 반환 맵에는 성공한 것만 담긴다 — 실패한 링크는 키 자체가 없으므로 호출부가
 * 원본을 그대로 두면 된다(지금까지와 똑같이 제목 검색 폴백으로 열린다).
 *
 * 동시성을 4로 잡은 이유는 scrapeBodiesFor와 같다. 구글이 429를 주기 시작하면
 * 그 뒤가 전부 실패하므로, 빠르게 훑는 것보다 끝까지 성공하는 쪽이 낫다.
 */
export async function resolveGoogleNewsUrls(
  links: string[],
  concurrency = 4,
): Promise<Map<string, string>> {
  const targets = [...new Set(links.filter(l => l.includes('news.google.com')))];
  const out = new Map<string, string>();
  let consecutiveFailedBatches = 0;

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const resolved = await Promise.all(batch.map(l => resolveGoogleNewsUrl(l)));
    batch.forEach((l, idx) => {
      const r = resolved[idx];
      if (r) out.set(l, r);
    });

    // 구글은 100건 남짓부터 막는다(2026-09-21 실측: 1,303건을 돌렸더니 약 80건 성공 뒤
    // 나머지가 전부 실패). 한 번 막히면 그 실행에서는 다시 열리지 않으므로, 연달아
    // 헛도는 게 보이면 멈춘다 — 계속 두드려봐야 차단만 길어지고 얻는 것이 없다.
    consecutiveFailedBatches = resolved.some(Boolean) ? 0 : consecutiveFailedBatches + 1;
    if (consecutiveFailedBatches >= 3) {
      console.warn(
        `[google-news-resolver] 연속 실패 — 차단으로 보고 중단합니다 (${out.size}/${targets.length}건 해석).`,
      );
      break;
    }
  }
  return out;
}
