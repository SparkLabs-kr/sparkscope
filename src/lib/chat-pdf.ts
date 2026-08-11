'use client';

// 답변을 PDF로 저장 — 인쇄 대화상자(window.print) 대신 실제 PDF 파일을 만들어 바로 내려받는다.
//
// 한글 폰트를 jsPDF에 직접 임베드하면 번들이 수 MB 커지므로, 대신 보이지 않는 iframe에
// HTML을 렌더링한 뒤 html2canvas로 화면째 캡처해 이미지로 PDF에 넣는다(폰트 임베딩 불필요,
// 표·줄바꿈은 브라우저 레이아웃 엔진이 그대로 처리).
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
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
          typeof r.prevTotal === 'number'
            ? `<span class="muted" style="font-size:11px;margin-left:6px">직전 기간 ${r.prevTotal.toLocaleString()}건</span>`
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

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PX_PER_MM = 96 / 25.4; // 화면 렌더용 CSS px 기준(브라우저 96dpi)

/** 인쇄 대화상자 없이 실제 PDF 파일을 만들어 바로 내려받는다("다른 이름으로 저장" 창이 뜬다). */
export async function exportAnswerToPdf(opts: {
  question: string;
  res: ChatResponse;
  period: string;
  scopes: string[];
}) {
  const html = buildReportHtml(opts);
  const widthPx = Math.round(A4_WIDTH_MM * PX_PER_MM);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-99999px';
  iframe.style.top = '0';
  iframe.style.width = `${widthPx}px`;
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();

    await new Promise<void>((resolve) => {
      if (doc.readyState === 'complete') resolve();
      else iframe.onload = () => resolve();
    });

    const body = doc.body;
    // @page 여백을 캡처 대상에는 그대로 두고, 실제 컨텐츠 높이만큼 iframe을 늘려서 잘리지 않게 한다.
    iframe.style.height = `${body.scrollHeight}px`;
    await new Promise((r) => setTimeout(r, 50)); // 리플로우 대기

    const canvas = await html2canvas(body, {
      width: widthPx,
      windowWidth: widthPx,
      scale: 2,
      backgroundColor: '#FFFFFF',
      useCORS: true,
    });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageHeightPx = Math.round((A4_HEIGHT_MM / A4_WIDTH_MM) * canvas.width);
    const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    const ctx = pageCanvas.getContext('2d')!;

    for (let i = 0; i < totalPages; i++) {
      const sliceHeight = Math.min(pageHeightPx, canvas.height - i * pageHeightPx);
      pageCanvas.height = sliceHeight;
      ctx.clearRect(0, 0, pageCanvas.width, sliceHeight);
      ctx.drawImage(canvas, 0, i * pageHeightPx, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      const imgData = pageCanvas.toDataURL('image/png');
      if (i > 0) pdf.addPage();
      const imgHeightMm = (sliceHeight / canvas.width) * A4_WIDTH_MM;
      pdf.addImage(imgData, 'PNG', 0, 0, A4_WIDTH_MM, imgHeightMm);
    }

    const filename = `스파크스코프_${opts.question.slice(0, 20).replace(/[\\/:*?"<>|]/g, '')}.pdf`;
    pdf.save(filename);
  } finally {
    document.body.removeChild(iframe);
  }
}
