/**
 * 다이제스트 데이터 구성 + HTML 렌더링
 * 상무님 시안(05_다이제스트_메일_시안_v0.2.html)을 그대로 구현.
 * 핵심 원칙:
 *  - 카드/기사 헤드라인은 항상 "실제 기사 제목"(title) — "회사명 관련 — 매체" 같은 조합 금지
 *  - 우리 관점 한 줄(ourTake)은 AI 생성값 우선, 없으면 톤/카테고리 기반 정직한 fallback
 *  - 톤 배지 + 자체/인용 배지 + 피칭/키워드 태그
 */
import type { AnalyzedArticle, DigestData } from './types';
import { isPolitical, normalizeTitleKey } from './relevance';
import { safeArticleHref } from './article-link';
import { clusterArticles } from './cluster';
import { INTER_EMAIL_CSS, renderInterSection, renderInterStat, renderInterStrip } from './inter-digest';

const TOP_3_LIMIT = 3;
const PORTFOLIO_LIMIT = 8;
const SPARKLABS_LIMIT = 5;
const COMPETITOR_LIMIT = 5;
const INDUSTRY_LIMIT = 5;

// 이메일 CTA 기본 도메인 (링크가 실제로 열리도록 프로덕션 URL 우선)
const DEFAULT_BASE_URL = 'https://sparkscope.vercel.app';

// 정치 기사 제외 + 중복 제거(제목 정규화/URL) + 같은 사건 클러스터링 → 대표 기사만 남긴 배열.
// TOP3 후보 산정과 카테고리별 섹션 구성 양쪽에서 공유한다.
export function buildClusteredPool(articles: AnalyzedArticle[]): AnalyzedArticle[] {
  // 정치 기사 제외 + 중복 제거(제목 정규화/URL). 대표는 우선순위 상위 1건.
  const seenKey = new Set<string>();
  const exactDeduped = [...articles]
    .filter(a => !isPolitical(a.title))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .filter(a => {
      const tk = normalizeTitleKey(a.title);
      const lk = 'L:' + a.link;
      if ((tk && seenKey.has(tk)) || seenKey.has(lk)) return false;
      if (tk) seenKey.add(tk);
      seenKey.add(lk);
      return true;
    });

  // 위 중복 제거는 제목이 완전히 같거나 링크가 같은 경우만 잡는다. 매체마다 헤드라인을
  // 다르게 써서(예: "엔씽, 158억 AI농업플랫폼 공급" vs "엔씽, 158억 'AI 수직농장' 구축…")
  // 같은 사건인데 문구가 달라 위 필터를 통과하는 경우가 많았고, 그 결과 TOP3가 같은 사건을
  // 매체만 다르게 3개 채우는 사고가 있었음(2026-08-06). clusterArticles(대시보드 "최근 수집
  // 기사"·톤 분석에서 이미 쓰는 같은 사건 클러스터링)로 한 번 더 걸러 대표 기사만 남긴다.
  const clusters = clusterArticles(exactDeduped.map(a => ({ ...a, id: a.link })));
  // 대표 기사에 "같은 사건으로 묶인 다른 매체 보도 건수"를 붙여서, 클러스터링이 완전히 하나로
  // 합치지 못해도 최소한 몇 건이 더 있었는지 메일에서 알 수 있게 한다(렌더 시 "외 N개 매체").
  return clusters.map(c => ({ ...c.rep, otherOutlets: c.others.length }));
}

// TOP3 후보를 우선순위(본부 스크랩 > 카테고리 > priorityScore)로 정렬하고 회사당 1건으로 제한한
// 풀 — 슬라이스 전 전체 순위. runner.ts가 AI 검증 후 대체 후보를 고를 때도 이 풀을 그대로 쓴다.
// TOP3는 "우리 얘기"(스파크랩·포트폴리오)만 다룬다 — 경쟁사·업계동향은 아래 별도 섹션에 이미
// 있어서, TOP3까지 차지하면 가장 눈에 띄는 자리가 우리와 무관한 뉴스로 채워지는 문제가 있었다
// (2026-08-06, 소윤 피드백).
const TOP_3_CATEGORIES = new Set(['sparklabs_self', 'portfolio_company']);

export function rankTop3Pool(sorted: AnalyzedArticle[], scrappedLinks?: Set<string>): AnalyzedArticle[] {
  const rankedForTop3 = sorted
    .filter(a => TOP_3_CATEGORIES.has(a.category))
    .sort((a, b) => {
      // [1] 본부 스크랩 우선
      const sa = scrappedLinks?.has(a.link) ? 1 : 0;
      const sb = scrappedLinks?.has(b.link) ? 1 : 0;
      if (sa !== sb) return sb - sa;

      // [2] 카테고리 우선순위 (스파크랩 > 포트폴리오)
      const catPriority: Record<string, number> = {
        'sparklabs_self': 4,
        'portfolio_company': 3,
      };
      const aPri = catPriority[a.category] ?? 0;
      const bPri = catPriority[b.category] ?? 0;
      if (aPri !== bPri) return bPri - aPri;

      // [3] 같은 카테고리면 priorityScore
      return b.priorityScore - a.priorityScore;
    });
  // 회사(matchedKeyword)당 TOP3엔 최대 1건만 — 클러스터링이 "같은 사건"으로 못 묶은(문구가
  // 많이 다른) 같은 회사의 서로 다른 기사 2건이 TOP3를 나눠 차지하던 문제 수정(2026-08-06,
  // 엣지크로스 기사 2건이 2·3위를 같이 차지한 사례로 발견). 업계동향(industry_trend)은
  // matchedKeyword가 여러 회사가 공유하는 범용 주제어라 이 제한에서 제외한다.
  const pool: AnalyzedArticle[] = [];
  const usedCompanies = new Set<string>();
  for (const a of rankedForTop3) {
    const isCompanyScoped = a.category !== 'industry_trend';
    if (isCompanyScoped && usedCompanies.has(a.matchedKeyword)) continue;
    pool.push(a);
    if (isCompanyScoped) usedCompanies.add(a.matchedKeyword);
  }
  return pool;
}

export function buildDigestData(
  articles: AnalyzedArticle[],
  editorIntro: string,
  weeklyFlow?: string,
  scrappedLinks?: Set<string>,
  top3Override?: AnalyzedArticle[],
): DigestData {
  const sorted = buildClusteredPool(articles);

  const sparklabsArticles = sorted.filter(a => a.category === 'sparklabs_self').slice(0, SPARKLABS_LIMIT);
  const portfolioArticles = dedupeByCompany(sorted.filter(a => a.category === 'portfolio_company')).slice(0, PORTFOLIO_LIMIT);
  // 경쟁사(투자사)는 matchedKeyword가 투자사명 자체라 포트폴리오처럼 회사당 대표 1건만 —
  // 클러스터링이 놓친 같은 사건(제목에 투자사명이 다르게 표기되는 등)이 겹쳐 보이지 않도록
  // 하는 2차 안전망(2026-08-06, 에이티넘인베스트먼트/모드하우스 건이 매체별로 다른
  // matchedKeyword로 수집돼 클러스터링만으론 다 못 묶인 사례로 발견).
  // 업계동향(industry_trend)은 matchedKeyword가 "시리즈 B 투자"처럼 여러 서로 다른 회사가
  // 공유하는 범용 주제어라 여기 적용하면 무관한 다른 회사 기사까지 지워버려 제외한다 —
  // 클러스터링(같은 사건 판단)에만 맡긴다.
  // 그래도 "같은 피투자회사를 서로 다른 투자사 키워드로 각각 수집"한 잔여 중복은 위 두 단계로도
  // 못 잡는다(모드하우스가 "에이티넘인베스트먼트"·"IMM인베스트먼트" 두 키워드로 따로 잡힌 사례).
  // 전사 발송 메일은 정확성이 최우선이라 AC·VC 섹션에 한해 mergeResidualDuplicates로 한 번 더
  // 느슨한 기준으로 병합한다(AI 호출 없음 — 비용·시간 부담 없는 순수 문자열 비교).
  const competitorArticles = mergeResidualDuplicates(
    dedupeByCompany(sorted.filter(a => a.category === 'competitor')),
  ).slice(0, COMPETITOR_LIMIT);
  const industryArticles = sorted.filter(a => a.category === 'industry_trend').slice(0, INDUSTRY_LIMIT);

  // TOP3는 연관성 우선순위: 스파크랩 > 포트폴리오 > 업계동향, 회사당 1건 제한 (rankTop3Pool 참고).
  // top3Override가 있으면(runner.ts의 AI 검증 후 선정 결과) 그걸 그대로 쓰고, 없으면 기존처럼
  // 규칙 기반 순위로 계산한다 — 검수 콘솔(review.ts) 등 기존 호출부는 override 없이 그대로 동작.
  const top3 = (top3Override ?? rankTop3Pool(sorted, scrappedLinks)).slice(0, TOP_3_LIMIT);

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const dateLabel = formatDateKR(now);

  return {
    date: now,
    dateLabel,
    generatedAt: now.toISOString(),
    editorIntro,
    weeklyFlow,
    stats: {
      total: articles.length,
      sparklabsSelf: sparklabsArticles.length,
      portfolio: portfolioArticles.length,
      competitor: competitorArticles.length,
      industry: industryArticles.length,
    },
    top3,
    sparklabsArticles,
    portfolioArticles,
    competitorArticles,
    industryArticles,
  };
}

// 포트폴리오는 회사(matchedKeyword)별 대표 1건씩
function dedupeByCompany(list: AnalyzedArticle[]): AnalyzedArticle[] {
  const seen = new Set<string>();
  const out: AnalyzedArticle[] = [];
  for (const a of list) {
    if (seen.has(a.matchedKeyword)) continue;
    seen.add(a.matchedKeyword);
    out.push(a);
  }
  return out;
}

// AC·VC 섹션 전용 2차 병합 — dedupeByCompany는 같은 투자사(matchedKeyword) 안에서만 중복을
// 잡아서, 같은 피투자회사를 서로 다른 투자사 키워드로 각각 수집한 경우는 못 걸렀다. 이 섹션은
// 정확성이 가장 중요한 전사 발송 메일이라, 기준을 살짝 낮춰(0.7, 기본값 1.0) 한 번 더 병합한다 —
// AI 호출 없이 순수 문자열 비교라 비용·시간 부담이 없다. 다른 섹션(TOP3·포트폴리오·업계동향)에
// 쓰이는 공용 클러스터링 기준은 그대로 둔다(2026-08-06).
function mergeResidualDuplicates(list: AnalyzedArticle[]): AnalyzedArticle[] {
  const clusters = clusterArticles(list.map(a => ({ ...a, id: a.link })), { textOnlyThreshold: 0.7 });
  return clusters.map(c => ({
    ...c.rep,
    otherOutlets: (c.rep.otherOutlets ?? 0) + c.others.length
      + c.others.reduce((sum, o) => sum + (o.otherOutlets ?? 0), 0),
  }));
}

export function renderDigestHtml(data: DigestData, baseUrl?: string): string {
  const pStat = data.stats;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SparkScope · ${escape(data.dateLabel)}</title>
<style>
${EMAIL_CSS}
${INTER_EMAIL_CSS}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">SparkScope · 미디어 다이제스트</div>
    <div class="date">${escape(data.dateLabel)}</div>
    <div class="stats">
      ${pStat.sparklabsSelf > 0 ? `<div class="stat"><div class="stat-value">${pStat.sparklabsSelf}</div><div class="stat-label">스파크랩 직접 언급</div></div>` : ''}
      <div class="stat"><div class="stat-value">${pStat.portfolio}</div><div class="stat-label">포트폴리오사 노출</div>${pStat.portfolioTrend ? `<div class="stat-trend">${escape(pStat.portfolioTrend)}</div>` : ''}</div>
      <div class="stat"><div class="stat-value">${pStat.competitor}</div><div class="stat-label">AC·VC 동향</div></div>
      ${data.inter ? renderInterStat(data.inter) : ''}
    </div>
  </div>

  ${data.weeklyFlow ? `
  <div class="weekly-flow">
    <div class="weekly-label">📈 지난 주 흐름 (월요일 추가 섹션)</div>
    <div class="weekly-text">${data.weeklyFlow}</div>
  </div>` : ''}

  <div class="section">
    <div class="section-label">⭐ 오늘의 핵심 TOP 3</div>
    ${data.top3.map((a, i) => renderTopCard(a, i + 1)).join('\n')}
  </div>

  ${data.sparklabsArticles.length > 0 ? `
  <div class="section">
    <div class="section-label">🏢 스파크랩 직접 언급</div>
    ${catSummary(data.categorySummaries?.sparklabs_self)}
    ${data.sparklabsArticles.map(a => renderArticle(a, { citation: true, tone: true })).join('\n')}
  </div>` : ''}

  <div class="section">
    <div class="section-label">💼 포트폴리오 하이라이트 (${data.portfolioArticles.length}건)</div>
    ${catSummary(data.categorySummaries?.portfolio_company)}
    ${data.portfolioArticles.length > 0 ? data.portfolioArticles.map(a => renderArticle(a, { keyword: true, tone: true })).join('\n') : '<div style="color:#6B7280; font-size:13px;">최근 영업일 내 포트폴리오 보도 없음</div>'}
  </div>

  ${data.inter ? renderInterStrip(data.inter) : ''}

  ${data.inter ? renderInterSection(data.inter, baseUrl ?? DEFAULT_BASE_URL) : ''}

  ${data.competitorArticles.length > 0 ? `
  <div class="section">
    <div class="section-label">🤝 AC·VC 업계 동향</div>
    ${catSummary(data.categorySummaries?.competitor)}
    ${data.competitorArticles.map(a => renderArticle(a, {})).join('\n')}
  </div>` : ''}

  ${data.industryArticles.length > 0 ? `
  <div class="section">
    <div class="section-label">🚀 스타트업계 뉴스</div>
    ${catSummary(data.categorySummaries?.industry_trend)}
    ${data.industryArticles.map(a => renderArticle(a, {})).join('\n')}
  </div>` : ''}

  <div class="footer">
    <div class="footer-cta-text">INTRA(스파크랩 내부 생태계)부터 INTER(글로벌 시장)까지, 아래 대시보드에서 확인하실 수 있습니다.</div>
    <a href="https://sparkscope.vercel.app/dashboard?from=2026-04-09&amp;to=2026-07-08" class="footer-cta-button">SparkScope 대시보드 바로가기</a>
  </div>
</div>
</body>
</html>`;
}

// 카테고리 섹션 상단 편집자 요약 한 줄 (검수 콘솔에서 입력)
function catSummary(text?: string): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  return `<div class="cat-summary">${escape(t)}</div>`;
}

// ── TOP 3 컬러 카드 ──────────────────────────────────────────────
function renderTopCard(a: AnalyzedArticle, rank: number): string {
  const cls = rank === 1 ? '' : rank === 2 ? 'dark' : 'gray';
  const rankText = categoryLabel(a.category);
  const take = takeLine(a);
  return `
    <div class="top-card ${cls}">
      <div class="top-rank"><span class="top-num">${rank}</span> · ${escape(rankText)}</div>
      <div class="top-headline">${escape(a.title)}</div>
      ${take ? `<div class="top-take">${escape(take)}</div>` : ''}
      <div class="top-meta">${escape(a.source)} · <a href="${escape(safeArticleHref(a.link, a.title, a.source))}" target="_blank">기사 보기 →</a></div>
    </div>`;
}

// ── 일반 기사 ────────────────────────────────────────────────────
// opts.tone: 톤 배지 표시 여부(스파크랩·포트폴리오만 true, AC·VC는 부정 검사 자체를 안 함)
function renderArticle(a: AnalyzedArticle, opts: { citation?: boolean; keyword?: boolean; tone?: boolean }): string {
  const toneTag = !opts.tone ? ''
    : a.tone === 'POSITIVE' ? '<span class="tag positive">긍정</span>'
    : a.tone === 'NEGATIVE' ? '<span class="tag alert">부정</span>'
    : '<span class="tag">중립</span>';
  const citationTag = opts.citation ? `<span class="tag">${citationType(a)}</span>` : '';
  const pitchTag = a.pitchScore >= 60 ? '<span class="tag opportunity">피칭 기회</span>' : '';
  const kwTag = opts.keyword ? `<span class="tag">${escape(a.matchedKeyword)}</span>` : '';
  const take = takeLine(a);
  return `
    <div class="article">
      <div>${toneTag}${citationTag}${pitchTag}${kwTag}</div>
      <div class="article-headline" style="margin-top:8px;">
        <a href="${escape(safeArticleHref(a.link, a.title, a.source))}" target="_blank">${escape(a.title)}</a>
      </div>
      ${take ? `<div class="article-take">${escape(take)}</div>` : ''}
      <div class="article-meta">${escape(a.source)} · ${formatFullDate(a.pubDate)}</div>
    </div>`;
}

// ── 우리 관점 한 줄: AI(ourTake) 우선, 없으면 정직한 fallback (‘관련/매체명 조합’ 금지) ──
function takeLine(a: AnalyzedArticle): string {
  const t = (a.ourTake ?? '').trim();
  if (t) return t;
  // 부정 논조 안내는 스파크랩·포트폴리오에만 (AC·VC는 부정 검사 자체를 안 함)
  const toneScoped = a.category === 'sparklabs_self' || a.category === 'portfolio_company';
  if (toneScoped && a.tone === 'NEGATIVE') return '부정 논조 보도 — 본부 모니터링·대응 검토가 필요하다.';
  if (a.pitchScore >= 60) return '기획기사 피칭으로 연결 가능한 주제다.';
  if (a.category === 'sparklabs_self') return '스파크랩 미디어 노출 — 메시지 확산 관점에서 참고할 보도다.';
  if (a.category === 'portfolio_company') return '포트폴리오사 언론 노출 — PR 활용 가능성을 살펴볼 보도다.';
  if (a.category === 'competitor') return '타 하우스 동향 — 경쟁 포지셔닝 참고용이다.';
  return '업계 흐름 참고 보도다.';
}

// 자체/인용 휴리스틱 (본문 미저장 상태 — 제목에 스파크랩 노출 여부로 근사)
function citationType(a: AnalyzedArticle): string {
  return a.title.includes('스파크랩') ? '자체' : '인용';
}

function categoryLabel(cat: string): string {
  return ({
    sparklabs_self: '스파크랩 뉴스',
    portfolio_company: '포트폴리오 뉴스',
    competitor: 'AC·VC 업계 동향',
    industry_trend: '업계 동향',
  } as Record<string, string>)[cat] ?? '주요 보도';
}

function formatDateKR(d: Date): string {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function formatFullDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function escape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_CSS = `
body{margin:0;padding:0;background:#F5F3EF;font-family:-apple-system,BlinkMacSystemFont,"맑은 고딕","Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#1A1A1A;line-height:1.6;word-break:keep-all;overflow-wrap:break-word}
.container{max-width:640px;margin:0 auto;background:#FFF}
.header{padding:28px 28px 22px;border-bottom:3px solid #5046E5}
.brand{font-size:11px;font-weight:700;letter-spacing:1.8px;color:#5046E5;text-transform:uppercase}
.date{margin-top:4px;font-size:24px;font-weight:700}
.editor-line{margin-top:14px;padding:14px 18px;background:linear-gradient(135deg,#EEEDFC 0%,#F5F3EF 100%);border-radius:10px;font-size:14px;line-height:1.55}
.editor-line strong{color:#5046E5}
.editor-byline{display:block;margin-top:8px;font-size:11px;color:#6B7280;font-style:italic}
.stats{display:flex;gap:10px;margin-top:16px}
.stat{flex:1;background:#F5F3EF;padding:12px 10px;border-radius:8px;text-align:center}
.stat-value{font-size:22px;font-weight:700;color:#5046E5;line-height:1.1}
.stat-label{font-size:10px;color:#6B7280;margin-top:4px}
.stat-trend{font-size:10px;color:#16A34A;margin-top:2px;font-weight:600}
.weekly-flow{padding:20px 28px;background:#FFFBEB;border-bottom:1px solid #FDE68A}
.weekly-label{font-size:11px;font-weight:700;letter-spacing:1.2px;color:#92400E;text-transform:uppercase;margin-bottom:10px}
.weekly-text{font-size:14px;color:#78350F;line-height:1.6}
.weekly-text strong{color:#92400E}
.section{padding:26px 28px;border-bottom:1px solid #EEEDFC}
.section-label{font-size:11px;font-weight:700;letter-spacing:1.2px;color:#5046E5;text-transform:uppercase;margin-bottom:16px}
.cat-summary{font-size:13px;color:#374151;line-height:1.6;margin:-8px 0 14px;padding:10px 12px;background:#F5F3EF;border-radius:8px}
.top-card{color:#FFF;padding:22px 24px;border-radius:12px;margin-bottom:12px;background:#5046E5}
.top-card.dark{background:#1A1A1A}
.top-card.gray{background:#475569}
.top-card .top-rank{font-size:11px;font-weight:700;letter-spacing:1.2px;opacity:.85}
.top-card .top-rank .top-num{font-size:16px;font-weight:800;letter-spacing:0;opacity:1}
.top-card .top-headline{font-size:17px;font-weight:600;margin:8px 0;line-height:1.4}
.top-card .top-take{font-size:13px;opacity:.92;margin-bottom:10px;line-height:1.55}
.top-card .top-meta{font-size:12px;opacity:.85}
.top-card a{color:#FFF;font-weight:600;text-decoration:underline}
.article{padding:14px 0;border-bottom:1px solid #F3F4F6}
.article:last-child{border-bottom:none}
.article-headline{font-size:15px;font-weight:600;margin-bottom:6px;line-height:1.45}
.article-headline a{color:#1A1A1A;text-decoration:none}
.article-take{font-size:13px;color:#374151;margin-bottom:6px;line-height:1.55;font-style:italic}
.article-meta{font-size:11px;color:#6B7280}
.tag{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;margin-right:6px;background:#EEEDFC;color:#5046E5}
.tag.positive{background:#DCFCE7;color:#166534}
.tag.alert{background:#FEE2E2;color:#991B1B}
.tag.opportunity{background:#FEF3C7;color:#92400E}
.footer{padding:24px 28px 32px;background:#F5F3EF;text-align:center}
.footer-text{font-size:12px;color:#6B7280}
.footer-cta-text{font-size:13px;color:#374151;margin-bottom:14px;white-space:nowrap}
.footer-cta-button{display:block;width:100%;box-sizing:border-box;padding:15px 20px;background:#5046E5;color:#FFF !important;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;text-align:center}
.footer-link{font-size:12px;color:#5046E5;text-decoration:none;font-weight:600}
.footer-meta{margin-top:12px;font-size:11px;color:#9CA3AF;line-height:1.6}
`;
