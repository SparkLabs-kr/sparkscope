'use client';

// 답변을 HTML 파일 하나로 내보낸다.
//
// 예전엔 html2canvas로 화면을 이미지로 구워 jsPDF에 넣었는데, 그 방식은
//  - 링크를 누를 수 없어 원문 URL을 본문에 텍스트로 박아야 했고(레이아웃이 URL 덩어리로 깨짐)
//  - 이미지라서 글자 선택·검색·복사가 안 되고
//  - A4 격자에 억지로 맞추느라 표가 눌렸다.
// HTML은 링크가 그대로 살고 폭 제약이 없다. 인쇄용 CSS를 같이 넣어둬서
// 파일을 열고 Cmd+P → "PDF로 저장"을 하면 깔끔한 PDF도 그대로 나온다.
//
// LLM은 관여하지 않는다. 이미 받아온 응답 데이터로 브라우저에서만 만든다.
import type { ChatResponse } from './sparkscope/chat-types';
import { categoryLabel, PERIOD_LABEL, SCOPE_LABEL } from './sparkscope/chat-types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 요약 본문 — "- "로 시작하는 줄은 목록으로 묶는다. */
function renderSummary(text: string) {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- ')) list.push(line.slice(2));
    else {
      flush();
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  flush();
  return out.join('');
}

function toneBadge(tone: string | null) {
  if (tone === 'NEGATIVE') return '<span class="badge neg">부정</span>';
  if (tone === 'POSITIVE') return '<span class="badge pos">긍정</span>';
  return '<span class="badge dim">중립</span>';
}

function statCard(title: string, items: { name: string; count: number }[]) {
  if (!items.length) return '';
  const max = Math.max(...items.map((i) => i.count)) || 1;
  return `<div class="card">
    <h4>${esc(title)}</h4>
    ${items
      .map(
        (i) => `<div class="row">
          <span class="row-name">${esc(i.name)}</span>
          <span class="bar"><i style="width:${Math.round((i.count / max) * 100)}%"></i></span>
          <b>${i.count.toLocaleString()}</b>
        </div>`
      )
      .join('')}
  </div>`;
}

export function buildReportHtml(opts: {
  question: string;
  res: ChatResponse;
  period: string;
  scopes: string[];
}) {
  const { question, res, period, scopes } = opts;
  const r = res.result;
  const today = new Date();
  const stamp = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

  const chips = [
    PERIOD_LABEL[period as keyof typeof PERIOD_LABEL] ?? period,
    ...scopes.map((s) => SCOPE_LABEL[s as keyof typeof SCOPE_LABEL] ?? s),
  ];

  const summaryBlock = res.summary
    ? `<section><h2>분석</h2><div class="prose">${renderSummary(res.summary)}</div></section>`
    : '';

  const noteBlock = (r?.deltaUnavailableReason || r?.deltaCaution)
    ? `<p class="note">${esc(r.deltaUnavailableReason ?? r.deltaCaution ?? '')}</p>`
    : '';

  const statBlock = r
    ? `<section>
        <h2>집계</h2>
        <div class="stat">
          <div class="stat-main"><b>${r.total.toLocaleString()}</b><span>건</span></div>
          <div class="stat-meta">
            <span>${esc(r.periodLabel)} 기준</span>
            ${typeof r.prevTotal === 'number' ? `<span>직전 기간 ${r.prevTotal.toLocaleString()}건</span>` : ''}
            ${r.negativeCount > 0 ? `<span class="warn">부정 톤 ${r.negativeCount}건</span>` : ''}
          </div>
        </div>
        ${noteBlock}
        ${r.sampled ? '<p class="note">아래 분류·키워드·매체 집계는 최신 1000건 표본 기준입니다.</p>' : ''}
        <div class="cards">
          ${statCard('분류', r.byCategory.map((c) => ({ name: categoryLabel(c.category), count: c.count })))}
          ${statCard('회사·키워드', r.topCompanies)}
          ${statCard('매체', r.topSources)}
        </div>
        ${
          r.monthly?.length
            ? `<h3>월별 추이</h3>${statCard('', r.monthly.map((m) => ({ name: m.month, count: m.count })))}`
            : ''
        }
      </section>`
    : '';

  const articleBlock = r?.articles.length
    ? `<section>
        <h2>근거 기사 <span class="count">${r.articles.length}건${r.total > r.articles.length ? ` / 전체 ${r.total.toLocaleString()}건` : ''}</span></h2>
        <table>
          <thead><tr><th>회사·키워드</th><th>제목</th><th>매체</th><th>날짜</th><th>톤</th></tr></thead>
          <tbody>
            ${r.articles
              .map(
                (a) => `<tr>
                  <td class="kw">${esc(a.matchedKeyword || '-')}</td>
                  <td>
                    <a href="${esc(a.link)}" target="_blank" rel="noreferrer">${esc(a.title)}</a>
                    ${a.oneLiner && a.oneLiner !== a.title ? `<div class="one">${esc(a.oneLiner)}</div>` : ''}
                  </td>
                  <td class="dimtext">${esc(a.source)}</td>
                  <td class="nowrap dimtext">${fmtDate(a.pubDate)}</td>
                  <td>${toneBadge(a.tone)}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </section>`
    : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SparkScope · ${esc(question).slice(0, 40)}</title>
<style>
  :root {
    --purple: #5046E5; --ink: #1A1A1A; --soft: #514E5C; --muted: #8B8894;
    --border: #E7E3DB; --subtle: #FAF8F4; --neg: #C0392B; --pos: #1E8E5A;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 64px; background: #F5F3EF; color: var(--ink);
    font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif;
    font-size: 14px; line-height: 1.7; -webkit-font-smoothing: antialiased;
  }
  .sheet { max-width: 860px; margin: 0 auto; background: #fff; border-radius: 14px;
           box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 8px 32px rgba(0,0,0,.06); padding: 40px 44px 48px; }
  header { border-bottom: 3px solid var(--purple); padding-bottom: 18px; margin-bottom: 8px; }
  .brand { color: var(--purple); font-weight: 800; letter-spacing: .18em; font-size: 11px; }
  h1 { font-size: 25px; line-height: 1.35; margin: 10px 0 14px; letter-spacing: -.02em; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { background: #EEECFB; color: var(--purple); font-size: 12px; font-weight: 700;
          padding: 3px 10px; border-radius: 999px; }
  .chip.plain { background: var(--subtle); color: var(--soft); font-weight: 500; }
  .meta { color: var(--muted); font-size: 12px; }
  h2 { font-size: 15px; margin: 34px 0 12px; display: flex; align-items: baseline; gap: 8px; }
  h2 .count { font-size: 12px; font-weight: 500; color: var(--muted); }
  h3 { font-size: 13px; margin: 22px 0 8px; color: var(--soft); }
  .prose p { margin: 0 0 12px; }
  .prose ul { margin: 0 0 12px; padding-left: 18px; }
  .prose li { margin-bottom: 7px; }
  .stat { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 16px; }
  .stat-main b { font-size: 34px; font-weight: 800; letter-spacing: -.03em; }
  .stat-main span { font-size: 16px; font-weight: 700; margin-left: 2px; }
  .stat-meta { display: flex; flex-wrap: wrap; gap: 6px; }
  .stat-meta span { background: var(--subtle); border-radius: 6px; padding: 3px 9px;
                    font-size: 12px; color: var(--soft); }
  .stat-meta .warn { background: #FDEEEC; color: var(--neg); font-weight: 700; }
  .note { color: var(--muted); font-size: 12px; margin: 10px 0 0;
          border-left: 2px solid var(--border); padding-left: 10px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 12px; margin-top: 18px; }
  .card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .card h4 { margin: 0 0 8px; font-size: 11px; color: var(--muted); font-weight: 700; letter-spacing: .04em; }
  .card h4:empty { display: none; }
  .row { display: grid; grid-template-columns: 1fr 46px auto; align-items: center; gap: 8px; margin-bottom: 5px; }
  .row-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row b { font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .bar { display: block; height: 4px; background: var(--subtle); border-radius: 2px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--purple); opacity: .55; border-radius: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 11px; color: var(--muted); font-weight: 700;
       padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td { padding: 11px 10px; border-bottom: 1px solid #F2EFEA; vertical-align: top; font-size: 13px; }
  tbody tr:hover { background: #FCFBF9; }
  td a { color: var(--ink); text-decoration: none; font-weight: 600; }
  td a:hover { color: var(--purple); text-decoration: underline; }
  .one { color: var(--muted); font-size: 12px; margin-top: 3px; font-weight: 400; }
  .kw { color: var(--purple); font-weight: 700; white-space: nowrap; font-size: 12.5px; }
  .dimtext { color: var(--muted); font-size: 12px; }
  .nowrap { white-space: nowrap; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 5px; white-space: nowrap; }
  .badge.neg { background: #FDEEEC; color: var(--neg); }
  .badge.pos { background: #E9F6F0; color: var(--pos); }
  .badge.dim { background: var(--subtle); color: var(--muted); }
  footer { margin-top: 34px; padding-top: 14px; border-top: 1px solid var(--border);
           color: var(--muted); font-size: 11px; }

  /* 파일을 열고 Cmd+P → "PDF로 저장"을 하면 이 규칙으로 깔끔하게 인쇄된다 */
  @media print {
    @page { size: A4; margin: 14mm; }
    body { background: #fff; padding: 0; font-size: 10.5px; }
    .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: none; }
    h1 { font-size: 18px; }
    .stat-main b { font-size: 24px; }
    tbody tr:hover { background: none; }
    tr, .card { page-break-inside: avoid; }
    td a { color: var(--ink); text-decoration: none; }
  }
</style></head>
<body>
  <div class="sheet">
    <header>
      <div class="brand">SPARKSCOPE</div>
      <h1>${esc(question)}</h1>
      <div class="chips">
        ${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}
        ${(r?.terms ?? []).map((t) => `<span class="chip plain">${esc(t)}</span>`).join('')}
      </div>
      <div class="meta">생성일 ${stamp}</div>
    </header>
    ${res.unsupported ? `<p class="note">참고: ${esc(res.note ?? '')}</p>` : ''}
    ${summaryBlock}
    ${statBlock}
    ${articleBlock}
    <footer>SparkScope 수집 기사 DB 기반 자동 생성 · 스파크랩 내부 자료 · 외부 공유 금지</footer>
  </div>
</body></html>`;
}

/** HTML 파일로 내려받는다. 인쇄 대화상자를 거치지 않고 바로 저장된다. */
export function exportAnswerToHtml(opts: {
  question: string;
  res: ChatResponse;
  period: string;
  scopes: string[];
}) {
  const html = buildReportHtml(opts);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const safe = opts.question.slice(0, 24).replace(/[\\/:*?"<>|]/g, '').trim() || '리포트';

  const a = document.createElement('a');
  a.href = url;
  a.download = `스파크스코프_${safe}_${stamp}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
