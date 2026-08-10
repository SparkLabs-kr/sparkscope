'use client';

// 답변을 PDF로 저장 — 인쇄용 문서를 만들어 브라우저 인쇄 대화상자를 띄운다.
// 여기서 "PDF로 저장"을 고르면 파일이 만들어진다.
//
// jsPDF 같은 라이브러리를 쓰지 않은 이유: 한글 폰트를 직접 임베드해야 해서 번들이 수 MB 커지고
// 줄바꿈·표 레이아웃을 전부 손으로 계산해야 한다. 브라우저 인쇄 경로는 한글·표·링크가 그대로 나온다.
import type { ChatResponse } from './sparkscope/chat-types';
import { categoryLabel, PERIOD_LABEL, SCOPE_LABEL } from './sparkscope/chat-types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
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

  const conditions = [
    PERIOD_LABEL[period as keyof typeof PERIOD_LABEL] ?? period,
    ...scopes.map((s) => SCOPE_LABEL[s as keyof typeof SCOPE_LABEL] ?? s),
    ...(r?.terms.length ? [`검색어: ${r.terms.join(', ')}`] : []),
  ].join(' · ');

  const summaryBlock = res.summary
    ? `<section><h2>분석</h2><div class="summary">${esc(res.summary)
        .split('\n')
        .filter(Boolean)
        .map((line) => `<p>${line}</p>`)
        .join('')}</div></section>`
    : '';

  const statBlock = r
    ? `<section>
        <h2>집계</h2>
        <p class="big">${r.total.toLocaleString()}건 <span class="muted">${esc(r.periodLabel)} 기준</span>
        ${
          typeof r.deltaPct === 'number'
            ? `<span class="delta">직전 대비 ${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%</span>`
            : r.deltaUnavailableReason
              ? `<span class="muted" style="font-size:10px;margin-left:6px">직전 대비 비교 불가</span>`
              : ''
        }
        ${r.negativeCount > 0 ? `<span class="neg">부정 톤 ${r.negativeCount}건</span>` : ''}</p>
        ${r.deltaUnavailableReason || r.deltaCaution ? `<p class="note">${esc(r.deltaUnavailableReason ?? r.deltaCaution ?? '')}</p>` : ''}
        ${
          r.sampled
            ? '<p class="note">아래 분류·키워드·매체 집계는 최신 1000건 표본 기준입니다.</p>'
            : ''
        }
        <div class="cols">
          ${statList('분류', r.byCategory.map((c) => ({ name: categoryLabel(c.category), count: c.count })))}
          ${statList('회사·키워드', r.topCompanies)}
          ${statList('매체', r.topSources)}
        </div>
        ${
          r.monthly?.length
            ? `<h3>월별 추이</h3><table><thead><tr><th>월</th><th>건수</th></tr></thead><tbody>${r.monthly
                .map((m) => `<tr><td>${esc(m.month)}</td><td>${m.count.toLocaleString()}</td></tr>`)
                .join('')}</tbody></table>`
            : ''
        }
      </section>`
    : '';

  const articleBlock = r?.articles.length
    ? `<section>
        <h2>근거 기사 (${r.articles.length}건)</h2>
        <table>
          <thead><tr><th>회사·키워드</th><th>제목</th><th>매체</th><th>날짜</th><th>톤</th></tr></thead>
          <tbody>
            ${r.articles
              .map(
                (a) => `<tr>
                  <td class="kw">${esc(a.matchedKeyword || '-')}</td>
                  <td>${esc(a.title)}<div class="link">${esc(a.link)}</div></td>
                  <td>${esc(a.source)}</td>
                  <td class="nowrap">${fmtDate(a.pubDate)}</td>
                  <td>${a.tone === 'NEGATIVE' ? '부정' : a.tone === 'POSITIVE' ? '긍정' : '-'}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </section>`
    : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8" />
<title>SparkScope 리포트 · ${esc(question).slice(0, 40)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif;
         color: #1A1A1A; font-size: 11px; line-height: 1.55; margin: 0; }
  header { border-bottom: 2px solid #5046E5; padding-bottom: 8px; margin-bottom: 14px; }
  .brand { color: #5046E5; font-weight: 800; letter-spacing: .14em; font-size: 10px; }
  h1 { font-size: 17px; margin: 4px 0 6px; }
  .meta { color: #8B8894; font-size: 10px; }
  h2 { font-size: 12px; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #E7E3DB; }
  h3 { font-size: 11px; margin: 12px 0 4px; }
  .big { font-size: 20px; font-weight: 800; margin: 6px 0; }
  .big .muted { font-size: 11px; font-weight: 400; color: #8B8894; }
  .delta, .neg { font-size: 10px; font-weight: 700; margin-left: 6px; }
  .delta { color: #C0392B; } .neg { color: #C0392B; }
  .note { color: #8B8894; font-size: 9.5px; margin: 2px 0 6px; }
  .summary p { margin: 0 0 6px; }
  .cols { display: flex; gap: 10px; }
  .cols > div { flex: 1; border: 1px solid #E7E3DB; border-radius: 6px; padding: 6px 8px; }
  .cols h4 { margin: 0 0 4px; font-size: 9.5px; color: #8B8894; font-weight: 700; }
  .cols li { display: flex; justify-content: space-between; gap: 8px; list-style: none; }
  .cols ul { margin: 0; padding: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; background: #FAF8F4; font-size: 9.5px; color: #514E5C; padding: 4px 6px; border-bottom: 1px solid #E7E3DB; }
  td { padding: 5px 6px; border-bottom: 1px solid #F0EDE7; vertical-align: top; }
  .kw { color: #5046E5; font-weight: 700; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .link { color: #A9A5B0; font-size: 8px; word-break: break-all; margin-top: 2px; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #E7E3DB; color: #8B8894; font-size: 9px; }
</style></head>
<body>
  <header>
    <div class="brand">SPARKSCOPE</div>
    <h1>${esc(question)}</h1>
    <div class="meta">${esc(conditions)} · 생성일 ${stamp}</div>
  </header>
  ${res.unsupported ? `<p class="note">참고: ${esc(res.note ?? '')}</p>` : ''}
  ${summaryBlock}
  ${statBlock}
  ${articleBlock}
  <footer>SparkScope 수집 기사 DB 기반 자동 생성 · 스파크랩 내부 자료 · 외부 공유 금지</footer>
</body></html>`;
}

function statList(title: string, items: { name: string; count: number }[]) {
  if (!items.length) return '';
  return `<div><h4>${esc(title)}</h4><ul>${items
    .map((i) => `<li><span>${esc(i.name)}</span><b>${i.count.toLocaleString()}</b></li>`)
    .join('')}</ul></div>`;
}

/** 인쇄 대화상자를 띄운다. 사용자가 "PDF로 저장"을 고르면 파일이 만들어진다. */
export function exportAnswerToPdf(opts: {
  question: string;
  res: ChatResponse;
  period: string;
  scopes: string[];
}) {
  const html = buildReportHtml(opts);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const run = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    // 인쇄 대화상자가 닫힌 뒤 정리 (취소해도 지워진다)
    setTimeout(() => iframe.parentNode && document.body.removeChild(iframe), 60_000);
  };
  if (doc.readyState === 'complete') run();
  else iframe.onload = run;
}
