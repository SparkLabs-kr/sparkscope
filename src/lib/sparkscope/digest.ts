/**
 * 다이제스트 데이터 구성 + HTML 렌더링
 * v0.2 시안의 디자인 시스템을 그대로 사용.
 */
import type { AnalyzedArticle, DigestData } from './types';

const TOP_3_LIMIT = 3;
const PORTFOLIO_LIMIT = 8;
const SPARKLABS_LIMIT = 5;
const COMPETITOR_LIMIT = 5;
const INDUSTRY_LIMIT = 5;

export function buildDigestData(
  articles: AnalyzedArticle[],
  editorIntro: string,
  weeklyFlow?: string,
): DigestData {
  const sorted = [...articles].sort((a, b) => b.priorityScore - a.priorityScore);

  const sparklabsArticles = sorted.filter(a => a.category === 'sparklabs_self').slice(0, SPARKLABS_LIMIT);
  const portfolioArticles = sorted.filter(a => a.category === 'portfolio_company').slice(0, PORTFOLIO_LIMIT);
  const competitorArticles = sorted.filter(a => a.category === 'competitor').slice(0, COMPETITOR_LIMIT);
  const industryArticles = sorted.filter(a => a.category === 'industry_trend').slice(0, INDUSTRY_LIMIT);

  const top3 = sorted.slice(0, TOP_3_LIMIT);

  const now = new Date();
  const dateLabel = formatDateKR(now);

  // 인사이트 박스: 가장 점수 높은 피칭 기회
  const topPitch = sorted.find(a => a.pitchScore >= 60);
  const insightTitle = topPitch?.pitchTopic ? `${topPitch.pitchTopic} 트렌드 매칭 가능성` : undefined;
  const insightText = topPitch ? `이 주제에 매칭되는 우리 포트폴리오사가 다수 있습니다. 본부 차원에서 묶어서 안내·피칭 검토를 권장합니다.` : undefined;

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

export function renderDigestHtml(data: DigestData, baseUrl?: string): string {
  const dashboardUrl = baseUrl ? `${baseUrl}/dashboard` : '#';

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
    <div class="brand">SparkScope · 일일 미디어 다이제스트</div>
    <div class="date">${escape(data.dateLabel)}</div>
    <div class="editor-line">
      ${escape(data.editorIntro)}
      <span class="editor-byline">— SparkScope 편집부</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-value">${data.stats.sparklabsSelf}</div><div class="stat-label">스파크랩 뉴스</div></div>
      <div class="stat"><div class="stat-value">${data.stats.portfolio}</div><div class="stat-label">포트폴리오사</div></div>
      <div class="stat"><div class="stat-value">${data.stats.competitor}</div><div class="stat-label">AC·VC 동향</div></div>
      <div class="stat"><div class="stat-value">${data.stats.industry}</div><div class="stat-label">스타트업계</div></div>
    </div>
  </div>

  ${data.weeklyFlow ? `
  <div class="weekly-flow">
    <div class="weekly-label">📈 지난 주 흐름</div>
    <div class="weekly-text">${escape(data.weeklyFlow)}</div>
  </div>` : ''}

  <div class="section">
    <div class="section-label">⭐ 오늘의 핵심 — TOP 3</div>
    ${data.top3.map((a, i) => renderTopCard(a, i + 1)).join('\n')}
  </div>

  ${data.insightTitle ? `
  <div class="section" style="padding-top:8px;">
    <div class="insight-box">
      <div class="insight-label">💡 본부에 한 줄</div>
      <div class="insight-title">${escape(data.insightTitle)}</div>
      <div class="insight-text">${escape(data.insightText ?? '')}</div>
      <a href="${dashboardUrl}" class="insight-action">대시보드에서 매칭 포트폴리오 보기 →</a>
    </div>
  </div>` : ''}

  <div class="section">
    <div class="section-label">🏢 스파크랩 뉴스</div>
    ${data.sparklabsArticles.length > 0 ? data.sparklabsArticles.map(renderArticle).join('\n') : '<div style="color:#6B7280; font-size:13px;">최근 영업일 내 직접 언급 없음</div>'}
  </div>

  <div class="section">
    <div class="section-label">💼 포트폴리오사</div>
    ${data.portfolioArticles.length > 0 ? data.portfolioArticles.map(renderArticle).join('\n') : '<div style="color:#6B7280; font-size:13px;">최근 영업일 내 포트폴리오 보도 없음</div>'}
  </div>

  <div class="section">
    <div class="section-label">🤝 AC·VC 업계 동향</div>
    ${data.competitorArticles.length > 0 ? data.competitorArticles.map(renderArticle).join('\n') : '<div style="color:#6B7280; font-size:13px;">최근 AC·VC 업계 동향 없음</div>'}
  </div>

  <div class="section">
    <div class="section-label">🌐 스타트업계 뉴스</div>
    ${data.industryArticles.length > 0 ? data.industryArticles.map(renderArticle).join('\n') : '<div style="color:#6B7280; font-size:13px;">최근 스타트업계 뉴스 없음</div>'}
  </div>

  <div class="cta-row">
    <div class="cta-title">한 발 더 들어가시려면</div>
    <a href="${dashboardUrl}" class="cta-button">📊 본부 대시보드 열기</a>
    <a href="mailto:mido.jang@gmail.com?subject=SparkScope 의견" class="cta-button outline">💬 본부에 의견 보내기</a>
  </div>

  <div class="footer">
    <div class="footer-text">SparkScope는 매주 월·수·금 오전 9시에 자동 발송됩니다.</div>
    <div class="footer-meta">
      외부 공유 금지 · 문의: 커뮤니케이션 본부 (Eunbit)
    </div>
  </div>
</div>
</body>
</html>`;
}

function renderTopCard(a: AnalyzedArticle, rank: number): string {
  const bg = rank === 1 ? '#5046E5' : rank === 2 ? '#1A1A1A' : '#475569';
  const catLabel: Record<string, string> = {
    sparklabs_self: '스파크랩 뉴스',
    portfolio_company: '포트폴리오사',
    competitor: 'AC·VC 업계 동향',
    industry_trend: '스타트업계 뉴스',
  };
  return `
    <div class="top-card" style="background:${bg};">
      <div class="top-rank">#${rank} · ${escape(catLabel[a.category] ?? '주요 보도')}</div>
      <div class="top-headline">${escape(a.oneLiner || a.title)}</div>
      ${a.ourTake ? `<div class="top-take">${escape(a.ourTake)}</div>` : ''}
      <div class="top-meta">${escape(a.source)} · ${formatDate(a.pubDate)} · <a href="${escape(a.link)}" target="_blank">기사 보기 →</a></div>
    </div>`;
}

function renderArticle(a: AnalyzedArticle): string {
  const toneTag = a.tone === 'POSITIVE' ? '<span class="tag positive">긍정</span>' : a.tone === 'NEGATIVE' ? '<span class="tag alert">주의</span>' : '';
  const pitchTag = a.pitchScore >= 60 ? '<span class="tag opportunity">피칭 기회</span>' : '';
  const kwTag = `<span class="tag">${escape(a.matchedKeyword)}</span>`;
  return `
    <div class="article">
      <div>${toneTag}${pitchTag}${kwTag}</div>
      <div class="article-headline" style="margin-top:8px;">
        <a href="${escape(a.link)}" target="_blank">${escape(a.oneLiner || a.title)}</a>
      </div>
      ${a.ourTake ? `<div class="article-take">${escape(a.ourTake)}</div>` : ''}
      <div class="article-meta">${escape(a.source)} · ${formatDate(a.pubDate)}</div>
    </div>`;
}

function formatDateKR(d: Date): string {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escape(s: string): string {
  return s
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
.editor-byline{display:block;margin-top:8px;font-size:11px;color:#6B7280;font-style:italic}
.stats{display:flex;gap:10px;margin-top:16px}
.stat{flex:1;background:#F5F3EF;padding:12px 10px;border-radius:8px;text-align:center}
.stat-value{font-size:22px;font-weight:700;color:#5046E5;line-height:1.1}
.stat-label{font-size:10px;color:#6B7280;margin-top:4px}
.weekly-flow{padding:20px 28px;background:#FFFBEB;border-bottom:1px solid #FDE68A}
.weekly-label{font-size:11px;font-weight:700;letter-spacing:1.2px;color:#92400E;text-transform:uppercase;margin-bottom:10px}
.weekly-text{font-size:14px;color:#78350F;line-height:1.6}
.section{padding:26px 28px;border-bottom:1px solid #EEEDFC}
.section-label{font-size:11px;font-weight:700;letter-spacing:1.2px;color:#5046E5;text-transform:uppercase;margin-bottom:16px}
.top-card{color:#FFF;padding:22px 24px;border-radius:12px;margin-bottom:12px}
.top-card .top-rank{font-size:11px;font-weight:700;letter-spacing:1.2px;opacity:.85}
.top-card .top-headline{font-size:17px;font-weight:600;margin:8px 0;line-height:1.4}
.top-card .top-take{font-size:13px;opacity:.92;margin-bottom:10px;line-height:1.55}
.top-card .top-meta{font-size:12px;opacity:.85}
.top-card a{color:#FFF;font-weight:600}
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
.insight-action{display:inline-block;margin-top:10px;padding:8px 14px;background:#F59E0B;color:#FFF;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600}
.cta-row{padding:24px 28px;background:#FAFAFA;border-bottom:1px solid #F3F4F6}
.cta-title{font-size:13px;font-weight:600;margin-bottom:12px}
.cta-button{display:inline-block;padding:10px 18px;background:#5046E5;color:#FFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;margin-right:8px;margin-bottom:6px}
.cta-button.outline{background:#FFF;color:#5046E5;border:1.5px solid #5046E5}
.footer{padding:24px 28px 32px;background:#F5F3EF;text-align:center}
.footer-text{font-size:12px;color:#6B7280}
.footer-meta{margin-top:12px;font-size:11px;color:#9CA3AF;line-height:1.6}
`;
