/**
 * 글로벌벤처스(SparkLabs Global Ventures) 포트폴리오사 뉴스 수집 — 구글 뉴스 RSS(en-US).
 *
 * 왜 네이버가 아닌가:
 *   collector.ts는 네이버 뉴스 API 하나만 쓴다. GV 포트폴리오 54개사는 대부분 미국·영국·
 *   싱가포르 기업이고 보도가 영문이라, 네이버로는 대만과 같은 이유로 거의 0건이다.
 *
 * 왜 대만 방식(구글 뉴스)을 그대로 쓰는가:
 *   영문은 오히려 대만보다 조건이 좋다 — 검색어가 곧 공식 사명이고, inter-collect의
 *   영문 매체 RSS는 주제 기반(피드 전체를 받아 거름)이라 "이 회사 기사"를 찾는 데는 맞지
 *   않는다. 회사별 질의가 필요하므로 구글 뉴스 검색이 맞다.
 *
 * 한계 (대만과 동일 — taiwan-collect.ts 주석 참고):
 *   - 구글 뉴스 <link>는 리다이렉트 페이지라 본문 스크래핑 불가. 제목만으로 판정하므로
 *     contextWords 설정이 결정적이다.
 *   - GV 포트폴리오는 Woo·42·Castle·Origin·Flow·Stitch·Iodine처럼 흔한 영어 단어가
 *     사명인 곳이 많다. 대만(고유한 중문 사명)보다 오탐 위험이 훨씬 크므로
 *     master-keywords.json의 excludeWords를 반드시 채운 상태로 돌려야 한다.
 *   - 공개 문서화된 엔드포인트가 아니라 SLA가 없다. 0건인 주가 이어지면 알람이 필요하다.
 */
import { prisma } from '@/lib/prisma';
import { isRelevant } from './relevance';
import { packFor } from './locale';
// 구글 뉴스 RSS 공통 헬퍼 — 대만을 붙일 때 taiwan-collect.ts에 들어갔지만 로케일에
// 의존하지 않는다. 복제하지 않고 그대로 쓴다(별도 파일로 떼는 건 별건으로 둔다).
import { buildQueryUrl, parseGoogleNewsItems, stripSourceSuffix, type TaiwanFeedItem } from './taiwan-collect';
import type { RawArticle } from './types';

export const GV_NEWS_LOCALE = { hl: 'en-US', gl: 'US', ceid: 'US:en' } as const;

export const GV_CATEGORY = 'portfolio_company_gv' as const;

/**
 * GV 자사 언급 감시 대상.
 *
 * sparklabs_self에는 GV가 두 건 등록돼 있다('스파크랩 글로벌벤처스', '스파크랩 글로벌').
 * 둘 다 englishName이 SparkLabs Global Ventures라 검색어가 같아 두 번 조회하면 같은
 * 기사를 중복 요청한다. 그래서 수집은 더 구체적인 이름 하나만 쓴다.
 * (대시보드는 읽을 때 두 키워드를 모두 본다 — 네이버가 '스파크랩 글로벌'로 쌓아둔
 * 과거 기사가 있어서다. dashboard/page.tsx의 GV_SELF_KEYWORDS 참고.)
 */
export const GV_SELF_NAME = '스파크랩 글로벌벤처스';

/** 구글 뉴스는 쿼리당 100건이 상한 — 기간을 쪼개야 과거 기사를 잃지 않는다. */
const RESULT_CAP = 100;
const WINDOW_DAYS = 15;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparkScope/1.0)' },
  });
  if (!res.ok) throw new Error(`google news ${res.status}`);
  return res.text();
}

/**
 * GV 포트폴리오사 기사 수집.
 *
 * 매칭은 한국·대만과 같은 relevance.isRelevant()를 그대로 탄다. 본문은 넘기지 않는다
 * (body='') — 구글 뉴스 링크는 리다이렉트 페이지라 스크래핑이 불가능하다.
 *
 * 로케일은 en-US 하나만 쓴다. 포트폴리오가 10개국에 걸쳐 있어 en-GB·en-SG를 더하고
 * 싶어지지만, 대만에서 내린 것과 같은 판단이다 — 54개사에 로케일을 더하면 요청이
 * 그 배수로 늘어나는데 이득이 확인되지 않았다. 영문 매체는 en-US 색인에 상당히 겹친다.
 * 특정 국가 회사가 계속 0건이면 그때 그 회사만 로케일을 더한다.
 *
 * @param sinceDays 조회 기간(일). 주 1회 실행 기준 10일이면 누락 없이 겹친다.
 * @param opts.onlySelf 자사 언급만 조회한다(백필용) — 54개사를 같이 훑으면 요청이 55배다.
 */
export async function collectGvArticles(
  sinceDays = 10,
  opts: { onlySelf?: boolean } = {},
): Promise<RawArticle[]> {
  const pack = packFor('en-US');
  const selfWhere = { category: 'sparklabs_self', name: GV_SELF_NAME };
  const targets = await prisma.monitoringTarget.findMany({
    where: opts.onlySelf
      ? { status: 'ACTIVE', ...selfWhere }
      : {
          status: 'ACTIVE',
          OR: [
            { category: GV_CATEGORY },
            // GV 자사 언급 — 위 GV_SELF_NAME 주석 참고.
            selfWhere,
          ],
        },
    orderBy: { name: 'asc' },
  });

  const until = new Date();
  const since = new Date(until.getTime() - sinceDays * 86400_000);
  const out: RawArticle[] = [];
  const seenLinks = new Set<string>();

  for (const t of targets) {
    const isSelf = t.category === 'sparklabs_self';

    // 검색어는 영문 우선이다. name은 한국어인 경우가 있고(자사 대상, 그리고 GV 포폴사
    // 중 한글명을 가진 12곳), 구글 뉴스 en-US에 한국어를 넣으면 영문 기사가 안 걸린다.
    // 통과 여부는 아래 isRelevant()가 contextWords로 다시 좁히므로, 여기서는 넓게 잡는다.
    const aliases = (t.helperKeywords ?? '').split(',').map(v => v.trim()).filter(Boolean);
    const names = [t.englishName, t.primaryKeyword, ...(isSelf ? aliases : [])].filter(
      (v): v is string => !!v && v.trim().length > 0,
    );
    // 한글·한자가 섞인 검색어는 뺀다 — en-US 질의에서 결과를 0으로 만들 뿐이다.
    const latinOnly = names.filter(n => !/[가-힣一-鿿]/.test(n));
    const uniqueNames = [...new Set(latinOnly.length > 0 ? latinOnly : names)];
    if (uniqueNames.length === 0) continue;

    let items: TaiwanFeedItem[] = [];
    try {
      items = parseGoogleNewsItems(await fetchXml(buildQueryUrl(uniqueNames, GV_NEWS_LOCALE)));
    } catch (e) {
      console.error(`[gv-collect] ${t.name} 조회 실패:`, e);
      continue;
    }

    // 상한에 걸린 대상만 기간 분할 재조회 — 그 외는 요청 낭비다.
    // OpenSea·Animoca Brands처럼 보도량이 많은 곳이 여기 걸린다.
    if (items.length >= RESULT_CAP) {
      for (let d = new Date(since); d < until; d.setDate(d.getDate() + WINDOW_DAYS)) {
        const lo = ymd(d);
        const hi = ymd(new Date(d.getTime() + WINDOW_DAYS * 86400_000));
        try {
          const extra = parseGoogleNewsItems(
            await fetchXml(`${buildQueryUrl(uniqueNames, GV_NEWS_LOCALE)}+after:${lo}+before:${hi}`),
          );
          for (const it of extra) {
            if (!items.some(x => x.link === it.link)) items.push(it);
          }
        } catch { /* 분할 조회 실패는 무시 — 기본 조회분은 이미 확보했다 */ }
      }
    }

    for (const it of items) {
      if (!it.pubDate || it.pubDate < since || it.pubDate > until) continue;
      if (seenLinks.has(it.link)) continue;

      // 구글 뉴스 제목의 " - 매체명" 접미사를 떼고 판정한다 — 안 떼면 매체명이
      // 사명·제외어와 우연히 겹쳐 오분류된다(예: "Origin" 기사와 "Yahoo Finance").
      const title = stripSourceSuffix(it.title, it.source);

      const relevant = isRelevant({
        title,
        body: '', // 구글 뉴스 링크는 스크래핑 불가 — 제목만으로 판정
        primaryKeyword: t.primaryKeyword,
        name: t.name,
        englishName: t.englishName,
        helperKeywords: t.helperKeywords,
        excludeWords: t.excludeWords,
        contextWords: t.contextWords,
        category: t.category,
        link: it.link,
        source: it.source,
      });
      if (!relevant) continue;

      seenLinks.add(it.link);

      // 매체명 정규화 — 같은 매체가 두 이름으로 들어오면 매체별 집계가 갈라진다
      // (Reuters == reuters.com, FT == Financial Times 등. locale/en-US.ts의 EN_ALIASES).
      const source = pack.media.normalize(it.source);

      // PR 와이어·아그리게이터·자동생성 종목 리포트는 버리지 않고 우선순위만 최하로 내린다.
      // 대만과 같은 원칙 — 차단하면 되돌릴 수 없지만 분류해두면 나눠 볼 수 있다.
      // 영문에서 특히 중요하다: Business Wire·PR Newswire 보도자료가 같은 내용을
      // 매체 여러 곳으로 퍼뜨려 "여러 매체가 함께 보도" 신호를 망가뜨린다.
      const excluded = pack.media.exclusionReason(it.source);

      out.push({
        title,
        link: it.link,
        source,
        pubDate: it.pubDate,
        // 자사 기사는 한국·대만과 같은 기준으로 matchedKeyword=primaryKeyword
        // (대시보드가 sparklabs_self를 primaryKeyword로 거른다). 포폴사는 name.
        matchedKeyword: isSelf ? t.primaryKeyword : t.name,
        category: t.category as RawArticle['category'],
        basePriority: excluded ? 5 : isSelf ? 100 : 70,
      });
    }
  }

  const offRoster = out.filter(a => a.basePriority === 5).length;
  const selfCount = out.filter(a => a.category === 'sparklabs_self').length;
  console.log(
    `[gv-collect] ${targets.length}개 대상 조회 → ${out.length}건 수집 ` +
    `(큐레이션 매체 ${out.length - offRoster}건 · 제외 매체 ${offRoster}건 · 자사 ${selfCount}건)`,
  );
  return out;
}
