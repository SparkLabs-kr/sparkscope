/**
 * 다이제스트 데이터 구성 + HTML 렌더링
 * 상무님 시안(05_다이제스트_메일_시안_v0.2.html)을 그대로 구현.
 * 핵심 원칙:
 *  - 카드/기사 헤드라인은 항상 "실제 기사 제목"(title) — "회사명 관련 — 매체" 같은 조합 금지
 *  - 우리 관점 한 줄(ourTake)은 AI 생성값 우선, 없으면 톤/카테고리 기반 정직한 fallback
 *  - 톤 배지 + 자체/인용 배지 + 피칭/키워드 태그
 */
import type { AnalyzedArticle, DigestData } from './types';

const TOP_3_LIMIT = 3;
const PORTFOLIO_LIMIT = 8;
const SPARKLABS_LIMIT = 5;
const COMPETITOR_LIMIT = 5;
const INDUSTRY_LIMIT = 5;

// 이메일 CTA 기본 도메인 (링크가 실제로 열리도록 프로덕션 URL 우선)
const DEFAULT_BASE_URL = 'https://sparkscope.vercel.app';

export function buildDigestData(
  articles: AnalyzedArticle[],
  editorIntro: string,
  weeklyFlow?: string,
  scrappedLinks?: Set<string>,
): DigestData {
  const sorted = [...articles].sort((a, b) => b.priorityScore - a.priorityScore);

  const sparklabsArticles = sorted.filter(a => a.category === 'sparklabs_self').slice(0, SPARKLABS_LIMIT);
  const portfolioArticles = dedupeByCompany(sorted.filter(a => a.category === 'portfolio_company')).slice(0, PORTFOLIO_LIMIT);
  const competitorArticles = sorted.filter(a => a.category === 'competitor').slice(0, COMPETITOR_LIMIT);
  const industryArticles = sorted.filter(a => a.category === 'industry_trend').slice(0, INDUSTRY_LIMIT);

  // TOP3는 본부 스크랩 우선, 그다음 우선순위 점수
  const top3 = [...articles]
    .sort((a, b) => {
      const sa = scrappedLinks?.has(a.link) ? 1 : 0;
      const sb = scrappedLinks?.has(b.link) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return b.priorityScore - a.priorityScore;
    })
    .slice(0, TOP_3_LIMIT);

  const now = new Date();
  const dateLabel = formatDateKR(now);

  // 💡 본부에 한 줄: 가장 점수 높은 피칭 기회를 실제 제목 기반 액션으로
  const topPitch = sorted.find(a => a.pitchScore >= 60) ?? top3[0];
  const insightTitle = topPitch ? headquarterActionTitle(topPitch) : undefined;
  const insightText = topPitch ? headquarterActionText(sorted) : undefined;

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
    insightTitle,
    insightText,
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

export function renderDigestHtml(data: DigestData, baseUrl?: string): string {
  const base = baseUrl || DEFAULT_BASE_URL;
  const dashboardUrl = `${base}/dashboard`;

  const pStat = data.stats;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SparkScope · ${escape(data.dateLabel)}</title>
<style>
${EMAIL_CSS}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">SparkScope · 미디어 다이제스트</div>
    <div class="date">${escape(data.dateLabel)}</div>
    <div class="editor-line">
      ${data.editorIntro ? data.editorIntro : '오늘의 미디어 다이제스트입니다.'}
      <span class="editor-byline">— 커뮤니케이션본부</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-value">${pStat.sparklabsSelf}</div><div class="stat-label">스파크랩 직접 언급</div></div>
      <div class="stat"><div class="stat-value">${pStat.portfolio}</div><div class="stat-label">포트폴리오사 노출</div>${pStat.portfolioTrend ? `<div class="stat-trend">${escape(pStat.portfolioTrend)}</div>` : ''}</div>
      <div class="stat"><div class="stat-value">${pStat.competitor}</div><div class="stat-label">AC·VC 동향</div></div>
    </div>
  </div>

  ${data.weeklyFlow ? `
  <div class="weekly-flow">
    <div class="weekly-label">📈 지난 주 흐름 (월요일 추가 섹션)</div>
    <div class="weekly-text">${data.weeklyFlow}</div>
  </div>` : ''}

  <div class="section">
    <div class="section-label">⭐ 오늘의 핵심 — TOP 3</div>
    ${data.top3.map((a, i) => renderTopCard(a, i + 1)).join('\n')}
  </div>

  ${data.insightTitle ? `
  <div class="section" style="padding-top:8px;">
    <div class="insight-box">
      <div class="insight-label">💡 커뮤니케이션본부 TIP!</div>
      <div class="insight-title">${escape(data.insightTitle)}</div>
      <div class="insight-text">${data.insightText ?? ''}</div>
      <a href="${dashboardUrl}" class="insight-action">SparkScope 대시보드 바로가기 →</a>
    </div>
  </div>` : ''}

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

  ${data.competitorArticles.length > 0 ? `
  <div class="section">
    <div class="section-label">🤝 AC·VC 업계 동향</div>
    ${catSummary(data.categorySummaries?.competitor)}
    ${data.competitorArticles.map(a => renderArticle(a, {})).join('\n')}
  </div>` : ''}

  <div class="cta-row">
    <div class="cta-title">한 발 더 들어가시려면</div>
    <a href="${dashboardUrl}" class="cta-button">📊 본부 대시보드 열기</a>
  </div>

  <div class="footer">
    <div class="footer-text">SparkScope는 매주 월·수·금 오전 9시에 자동 발송됩니다.</div>
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
  const rankLabel = `#${rank} · ${categoryLabel(a.category)}${importanceLabel(a.importance)}`;
  const take = takeLine(a);
  const citation = a.category === 'sparklabs_self' ? ` · 스파크랩 ${citationType(a)}` : '';
  return `
    <div class="top-card ${cls}">
      <div class="top-rank">${escape(rankLabel)}</div>
      <div class="top-headline">${escape(a.title)}</div>
      ${take ? `<div class="top-take">${escape(take)}</div>` : ''}
      <div class="top-meta">${escape(a.source)} · ${formatDate(a.pubDate)}${citation} · <a href="${escape(a.link)}" target="_blank">기사 보기 →</a></div>
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
        <a href="${escape(a.link)}" target="_blank">${escape(a.title)}</a>
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
  if (toneScoped && a.tone === 'NEGATIVE') return '부정 논조 보도 — 본부 모니터링·대응 검토가 필요합니다.';
  if (a.pitchScore >= 60) return '기획기사 피칭으로 연결 가능한 주제입니다.';
  if (a.category === 'sparklabs_self') return '스파크랩 미디어 노출 — 메시지 확산 관점에서 참고할 보도입니다.';
  if (a.category === 'portfolio_company') return '포트폴리오사 언론 노출 — PR 활용 가능성을 살펴볼 보도입니다.';
  if (a.category === 'competitor') return '타 하우스 동향 — 경쟁 포지셔닝 참고용입니다.';
  return '업계 흐름 참고 보도입니다.';
}

// 자체/인용 휴리스틱 (본문 미저장 상태 — 제목에 스파크랩 노출 여부로 근사)
function citationType(a: AnalyzedArticle): string {
  return a.title.includes('스파크랩') ? '자체' : '인용';
}

function categoryLabel(cat: string): string {
  return ({
    sparklabs_self: '스파크랩 미디어 노출',
    portfolio_company: '포트폴리오 마일스톤',
    competitor: 'AC·VC 업계 동향',
    industry_trend: '업계 동향',
  } as Record<string, string>)[cat] ?? '주요 보도';
}

function importanceLabel(imp: string): string {
  if (imp === 'CRITICAL') return ' · 영향력 大';
  if (imp === 'HIGH') return ' · 영향력 높음';
  return '';
}

// 💡 본부에 한 줄 — 실제 데이터 기반 (AI 미가동 시에도 정직한 액션)
function headquarterActionTitle(a: AnalyzedArticle): string {
  if (a.pitchTopic) return `${a.pitchTopic} — 지금이 피칭 타이밍입니다`;
  if (a.tone === 'NEGATIVE') return '부정 이슈 감지 — 선제 대응 메시지를 준비할 시점입니다';
  return '오늘의 보도, 본부 차원에서 한 발 더 들어갈 지점입니다';
}

function headquarterActionText(sorted: AnalyzedArticle[]): string {
  const pitches = sorted.filter(a => a.pitchScore >= 60);
  const top = pitches[0] ?? sorted[0];
  if (!top) return '오늘은 주목할 보도가 적습니다. 업계 동향만 가볍게 확인해 주세요.';
  const cnt = pitches.length;
  const lead = `<strong>${escape(top.title)}</strong>`;
  if (cnt >= 2) {
    return `${lead} 등 주목할 보도가 ${cnt}건 확인됐습니다. 이를 우리 포트폴리오 맥락으로 엮어 <strong>기획 피칭 또는 본부 안내 메일</strong>로 연결할 수 있습니다.`;
  }
  return `${lead} 보도를 우리 포트폴리오 맥락으로 엮어 <strong>기획 피칭 또는 본부 안내</strong>로 연결할 수 있습니다.`;
}

function formatDateKR(d: Date): string {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
body{margin:0;padding:0;background:#F5F3EF;font-family:-apple-system,BlinkMacSystemFont,"맑은 고딕","Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#1A1A1A;line-height:1.6}
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
.insight-box{background:linear-gradient(135deg,#FFFBEB 0%,#FEF3C7 100%);border-left:5px solid #F59E0B;padding:18px 20px;border-radius:6px}
.insight-label{font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:6px}
.insight-title{font-size:15px;font-weight:700;color:#78350F;margin-bottom:8px}
.insight-text{font-size:13px;color:#78350F;line-height:1.6}
.insight-text strong{color:#92400E}
.insight-action{display:inline-block;margin-top:10px;padding:8px 14px;background:#F59E0B;color:#FFF;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600}
.cta-row{padding:24px 28px;background:#FAFAFA;border-bottom:1px solid #F3F4F6}
.cta-title{font-size:13px;font-weight:600;margin-bottom:12px}
.cta-button{display:inline-block;padding:10px 18px;background:#5046E5;color:#FFF !important;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;margin-right:8px;margin-bottom:6px}
.cta-button.outline{background:#FFF;color:#5046E5 !important;border:1.5px solid #5046E5}
.footer{padding:24px 28px 32px;background:#F5F3EF;text-align:center}
.footer-text{font-size:12px;color:#6B7280}
.footer-link{font-size:12px;color:#5046E5;text-decoration:none;font-weight:600}
.footer-meta{margin-top:12px;font-size:11px;color:#9CA3AF;line-height:1.6}
`;
