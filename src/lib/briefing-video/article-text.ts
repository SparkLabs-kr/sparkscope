/**
 * 대본 재료용 기사 본문 발췌 — 3분 개편안(2026-10-07)은 기사마다 숫자·맥락을 요구하는데, 저장된 건 제목과
 * AI 한 줄 요약뿐이라 금액·지분·배경이 대본에 들어갈 수 없었다. 원문 페이지의 문단(<p>)을 앞에서부터
 * 1,500자 정도 읽어 온다. 실패하면 빈 문자열 — 그때는 제목·요약만으로 쓴다(대본이 사실을 지어내지 않게).
 */
const strip = (s: string) => s
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

export async function articleExcerpt(url: string, max = 1500): Promise<string> {
  if (!/^https?:\/\//.test(url) || url.includes('news.google.com')) return '';
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(7000) });
    const html = (await r.text()).slice(0, 400_000);
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => strip(m[1]))
      // 저작권·기자 이메일·메뉴 같은 짧은 줄은 뺀다
      .filter(t => t.length >= 40 && !/무단\s*전재|재배포|저작권|Copyright|@[a-z0-9.-]+\.[a-z]{2,}/i.test(t));
    let out = '';
    for (const p of paras) {
      if (out.length + p.length > max) break;
      out += (out ? ' ' : '') + p;
    }
    if (!out) {
      const d = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
      out = d ? strip(d[1]) : '';
    }
    return out.slice(0, max);
  } catch {
    return '';
  }
}
