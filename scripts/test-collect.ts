/**
 * 네이버+구글 테스트 수집 (저장 안 함, 결과만 요약).
 * 실행: LIMIT=8 tsx scripts/test-collect.ts   (카테고리별 최대 8개 대상으로 빠르게 테스트)
 * 키 입력 후 확인용.
 */
import { collectAllArticles } from '../src/lib/sparkscope/collector';
import { isKnownMedia, normalizeSource } from '../src/lib/sparkscope/media';

async function main() {
  const limit = Number(process.env.LIMIT ?? '8');
  const naverOn = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
  console.log(`테스트 수집 시작 — Naver: ${naverOn ? 'ON' : 'OFF(키 없음)'} · 카테고리별 최대 ${limit}개 대상`);

  const t0 = Date.now();
  const articles = await collectAllArticles({ maxKeywordsPerCategory: limit });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const known = articles.filter(a => isKnownMedia(a.source));
  const bySource = new Map<string, number>();
  known.forEach(a => bySource.set(normalizeSource(a.source), (bySource.get(normalizeSource(a.source)) ?? 0) + 1));
  const top = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log(`\n=== 결과 (${secs}s) ===`);
  console.log(`최종 수집(관련성 필터 + 중복제거 후): ${articles.length}건`);
  console.log(`26개 확정 매체 매칭: ${known.length}건`);
  console.log(`상위 매체: ${top.map(([s, c]) => `${s}(${c})`).join(', ') || '(없음)'}`);
  console.log('\n※ 이 스크립트는 DB에 저장하지 않습니다 (수집 품질 확인용).');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
