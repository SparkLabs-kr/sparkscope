/**
 * 메일에 실제로 들어가는 기사만 골라 구글 프록시 링크를 진짜 주소로 바꾼다.
 *
 * 왜 "실제로 들어가는 것만"인가:
 * 구글 뉴스로 수집된 기사는 link가 news.google.com/rss/articles/… 프록시라, 그대로 열면
 * 기사가 아니라 빈 구글 페이지가 뜬다. 그래서 화면·메일은 그런 링크를 제목 검색으로
 * 돌려보내는데(article-link.ts), 읽는 사람이 기사 하나 보려고 검색 결과를 한 번 더 거친다.
 *
 * 해석기(google-news-resolver.ts)가 이걸 풀어주지만 구글이 100건 남짓부터 막는다
 * (2026-09-21 실측: 1,303건을 한 번에 돌렸더니 약 80건 성공 후 전부 실패).
 * 그래서 DB에 쌓인 것을 통째로 고치는 방식은 쓸 수 없다.
 *
 * 대신 발송 직전에 "이번 메일에 들어가는 기사"만 해석한다. 한 통에 30여 건, 그중 프록시는
 * 10여 건이라 차단선에 한참 못 미치고, 정작 사람이 누르는 링크는 전부 진짜 주소가 된다.
 * 수집 쪽도 같은 날 고쳐서 새 기사는 애초에 진짜 주소로 들어오므로, 여기서 할 일은
 * 시간이 갈수록 줄어든다.
 *
 * 해석한 값은 DB에도 돌려 써서 대시보드와 다음 발송이 다시 풀지 않아도 되게 한다.
 */
import { prisma } from '@/lib/prisma';
import type { AnalyzedArticle, DigestData } from './types';
import { resolveGoogleNewsUrls } from './google-news-resolver';

/** 한 통에 해석할 상한 — 구글 차단선(약 100건)에 닿지 않게 여유를 크게 둔다. */
const MAX_PER_RUN = 40;

function collectArticles(data: DigestData): AnalyzedArticle[] {
  return [
    ...data.top3,
    ...data.sparklabsArticles,
    ...data.portfolioArticles,
    ...data.competitorArticles,
    ...data.industryArticles,
  ];
}

/**
 * 메일에 들어갈 기사들의 프록시 링크를 진짜 주소로 바꾼다.
 *
 * 기사 객체를 그 자리에서 고친다 — top3와 각 섹션 배열이 같은 객체를 함께 들고 있어서,
 * 한 번 고치면 양쪽에 다 반영된다.
 *
 * 실패해도 아무것도 하지 않는다. 원본 링크가 그대로 남아 예전처럼 제목 검색으로 열릴 뿐이라,
 * 이 단계가 통째로 죽어도 메일은 나간다.
 */
export async function attachResolvedLinks<T extends DigestData>(data: T): Promise<T> {
  try {
    const proxied = collectArticles(data).filter(a => a.link?.includes('news.google.com'));
    if (proxied.length === 0) return data;

    const links = [...new Set(proxied.map(a => a.link))].slice(0, MAX_PER_RUN);
    const t = Date.now();
    const map = await resolveGoogleNewsUrls(links);

    for (const a of proxied) {
      const real = map.get(a.link);
      if (real) a.link = real;
    }

    // DB에도 반영 — 대시보드와 다음 발송이 같은 일을 다시 하지 않도록.
    // link는 unique라 같은 주소가 이미 있으면 충돌하는데, 그건 그 기사가 이미 제대로
    // 저장돼 있다는 뜻이라 그냥 둔다. 메일 본문은 위에서 이미 고쳐졌다.
    await Promise.all([...map.entries()].map(([proxy, real]) =>
      prisma.article.update({ where: { link: proxy }, data: { link: real } }).catch(() => {}),
    ));

    console.log(
      `[digest-links] 메일 기사 링크 해석: ${map.size}/${links.length}건 성공 (${((Date.now() - t) / 1000).toFixed(1)}초)`,
    );
  } catch (e: any) {
    console.error(`[digest-links] 링크 해석 실패 — 원본 링크로 발송합니다: ${e?.message ?? e}`);
  }
  return data;
}
