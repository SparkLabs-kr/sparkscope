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
import type { ChatResponse, ChatQueryResult } from './sparkscope/chat-types';
import { categoryLabel, PERIOD_LABEL, SCOPE_LABEL } from './sparkscope/chat-types';
// 화면(ChatWelcome)과 같은 규칙으로 기사를 묶는다 — 두 곳이 달라 보이면 안 된다.
import { organizeArticles, GROUP_PREVIEW_COUNT } from './sparkscope/group-articles';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** `| a | b |` 한 줄을 셀 배열로. 양끝 파이프는 버린다. */
function splitTableRow(line: string) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

/** `|---|:--:|` 같은 마크다운 표 구분선인지 */
function isTableDivider(line: string) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

/**
 * 요약 본문 — "- " 목록과 마크다운 표를 HTML로 바꾼다.
 *
 * '표로 정리'를 켜면 모델이 마크다운 표로 답하는데, 예전엔 이 함수가 표를 모르고
 * 모든 줄을 <p>로 감싸서 저장한 HTML에 "| 구분 | 이번 달 건수 |", "|---|---:|---|"가
 * 그대로 찍혔다(2026-08-18 피드백 — 화면에서는 AnswerText가 표로 그려주는데 저장
 * 파일만 깨져 보였다).
 */
function renderSummary(text: string) {
  const out: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
    list = [];
  };

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 표: 헤더 줄 + 구분선이 연달아 나와야 표로 인정한다(본문에 파이프가 하나 섞인
    // 문장을 표로 오인하지 않도록).
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushList();
      const head = splitTableRow(line);
      const body: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].includes('|'); j++) {
        if (isTableDivider(lines[j])) continue;
        body.push(splitTableRow(lines[j]));
      }
      out.push(`<table class="md-table">
        <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${body
          .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody>
      </table>`);
      i = j - 1;
      continue;
    }

    if (line.startsWith('- ')) list.push(line.slice(2));
    else {
      flushList();
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  flushList();
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

/**
 * 추이 그래프 — 순수 인라인 SVG(외부 차트 라이브러리 없음, 파일 하나로 열리는 원칙 유지).
 * 채팅 화면의 TrendChart(ChatWelcome.tsx)와 같은 기준으로 그린다(2026-08-12) — 기간을
 * 짧게(오늘·이번 주) 골라 일 단위로 쪼갠 데이터는 막대, 그 외 월 단위 6개월치는 선그래프.
 * 예전엔 이 함수가 막대 하나뿐이라 화면(채팅)과 저장한 HTML의 그래프 모양이 달랐다.
 */
function trendChart(items: { month: string; count: number }[], granularity: 'day' | 'month') {
  if (!items.length) return '';
  const max = Math.max(...items.map((i) => i.count), 1);
  const W = 720;
  const H = 220;
  const padL = 8;
  const padB = 34;
  const padT = 24;
  const chartW = W - padL * 2;
  const chartH = H - padT - padB;
  const n = items.length;
  const gap = chartW / n;
  const title = granularity === 'day' ? '일별 추이 (최근 14일)' : '월별 추이 (최근 6개월)';
  const label = (raw: string) => {
    if (granularity === 'day') {
      const [m, d] = raw.split('-');
      return m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : raw;
    }
    const [, m] = raw.split('-');
    return m ? `${parseInt(m, 10)}월` : raw;
  };
  const axis = `<line x1="${padL}" y1="${padT + chartH}" x2="${W - padL}" y2="${padT + chartH}" stroke="#E7E3DB" stroke-width="1" />`;

  if (granularity === 'day') {
    const barW = Math.min(34, gap * 0.6);
    const bars = items
      .map((it, i) => {
        const h = Math.round((it.count / max) * chartH);
        const x = padL + gap * i + (gap - barW) / 2;
        const y = padT + (chartH - h);
        return `<g>
          <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 1)}" rx="3" fill="#5046E5" opacity="${it.count > 0 ? 0.82 : 0.18}" />
          ${it.count > 0 ? `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="#514E5C">${it.count.toLocaleString()}</text>` : ''}
          <text x="${x + barW / 2}" y="${H - 12}" text-anchor="middle" font-size="10" fill="#8B8894">${esc(label(it.month))}</text>
        </g>`;
      })
      .join('');
    return `<div class="card chart-card">
      <h4>${title}</h4>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${title}">${axis}${bars}</svg>
    </div>`;
  }

  const points = items.map((it, i) => {
    const x = padL + gap * i + gap / 2;
    const y = padT + (chartH - Math.round((it.count / max) * chartH));
    return { x, y, it };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;
  const dots = points
    .map(
      (p) => `<g>
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#5046E5" />
        <text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="#514E5C">${p.it.count.toLocaleString()}</text>
        <text x="${p.x}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#8B8894">${esc(label(p.it.month))}</text>
      </g>`
    )
    .join('');

  return `<div class="card chart-card">
    <h4>${title}</h4>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${title}">
      ${axis}
      <path d="${areaPath}" fill="#5046E5" opacity="0.08" stroke="none" />
      <path d="${linePath}" fill="none" stroke="#5046E5" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
    </svg>
  </div>`;
}

/** 도넛차트 공통 — 채팅 화면의 ToneDonutChart/CategoryDonutChart와 같은 SVG 패턴(2026-08-12). */
function donutChart(title: string, ariaLabel: string, segments: { label: string; value: number; color: string }[]) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return '';
  const R = 54;
  const C = 2 * Math.PI * R;
  let cursor = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const dash = (s.value / total) * C;
      const arc = `<circle r="${R}" cx="0" cy="0" fill="none" stroke="${s.color}" stroke-width="20" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-cursor}" />`;
      cursor += dash;
      return arc;
    })
    .join('');
  const legend = segments
    .map(
      (s) => `<div class="donut-legend-row">
        <span class="donut-dot" style="background:${s.color}"></span>
        <span>${esc(s.label)}</span>
        <span class="dimtext">${s.value.toLocaleString()}건 (${Math.round((s.value / total) * 100)}%)</span>
      </div>`
    )
    .join('');

  return `<div class="card chart-card">
    <h4>${esc(title)}</h4>
    <div class="donut-wrap">
      <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="${esc(ariaLabel)}">
        <g transform="translate(70,70) rotate(-90)">
          <circle r="${R}" cx="0" cy="0" fill="none" stroke="#EDEAE2" stroke-width="20" />
          ${arcs}
        </g>
        <text x="70" y="66" text-anchor="middle" font-size="20" font-weight="800" fill="#2A2830">${total.toLocaleString()}</text>
        <text x="70" y="84" text-anchor="middle" font-size="11" fill="#8B8894">건</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  </div>`;
}

const CATEGORY_COLOR: Record<string, string> = {
  sparklabs_self: '#5046E5',
  portfolio_company: '#16A34A',
  competitor: '#F59E0B',
  industry_trend: '#3B82F6',
  executive: '#EC4899',
  live: '#8B8894',
};

/** 피칭 점수 순위 막대그래프 — 채팅 화면의 PitchScoreBarChart와 같은 기준(2026-08-12). */
function pitchScoreBarChart(articles: ChatQueryResult['articles']) {
  const points = articles.filter((a) => typeof a.pitchScore === 'number').slice(0, 10);
  if (!points.length) return '';
  const rows = points
    .map(
      (p) => `<div class="row">
        <span class="row-name">${p.matchedKeyword ? `[${esc(p.matchedKeyword)}] ` : ''}${esc(p.title)}</span>
        <span class="bar"><i style="width:${Math.max(Math.min(p.pitchScore as number, 100), 6)}%"></i></span>
        <b>${p.pitchScore}점</b>
      </div>`
    )
    .join('');
  return `<div class="card chart-card"><h4>피칭 점수 순위</h4>${rows}</div>`;
}

/**
 * 오탐 많은 키워드 점검 결과 표 — 예전엔 이 데이터(noisyKeywords) 자체가 HTML 저장에
 * 아예 안 실렸다(2026-08-11 발견, chat-agent.ts의 noise_report가 uiResult를 안 채워서
 * 화면 결과가 통째로 비어버리는 문제와 함께 고침). 오탐 건수·정상 건수·현재 설정·실제
 * 오탐 기사 예시까지 같이 보여줘야 "왜 오탐인지" 판단하고 바로 조치할 수 있다.
 */
function noiseTable(rows: NonNullable<ChatQueryResult['noisyKeywords']>) {
  if (!rows.length) return '';
  return `<section>
    <h2>오탐 많은 키워드 <span class="count">${rows.length}개</span></h2>
    <table>
      <thead><tr><th>키워드</th><th>상태</th><th>오탐</th><th>정상</th><th>현재 설정</th><th>오탐 예시</th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const settings = r.current
              ? [
                  r.current.contextWords ? `문맥어: ${esc(r.current.contextWords)}` : '',
                  r.current.excludeWords ? `제외어: ${esc(r.current.excludeWords)}` : '',
                ].filter(Boolean).join('<br/>') || '<span class="dimtext">없음</span>'
              : '<span class="dimtext">없음</span>';
            return `<tr>
              <td class="kw">${esc(r.name)}</td>
              <td>${r.status === 'ACTIVE' ? '<span class="badge dim">ACTIVE</span>' : `<span class="badge neg">${esc(r.status ?? 'UNKNOWN')}</span>`}</td>
              <td class="nowrap"><b>${r.noise.toLocaleString()}</b>건</td>
              <td class="nowrap dimtext">${r.kept.toLocaleString()}건</td>
              <td class="dimtext" style="font-size:11px">${settings}</td>
              <td class="dimtext" style="font-size:11px">${(r.samples ?? []).slice(0, 3).map((s) => esc(s)).join('<br/>')}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  </section>`;
}

function articleRows(items: ChatQueryResult['articles'], showTag: boolean) {
  return items
    .map(
      (a) => `<tr>
        ${showTag ? `<td class="kw">${esc(a.matchedKeyword || '-')}</td>` : ''}
        <td>
          <a href="${esc(a.link)}" target="_blank" rel="noreferrer">${esc(a.title)}</a>
          ${a.oneLiner && a.oneLiner !== a.title ? `<div class="one">${esc(a.oneLiner)}</div>` : ''}
        </td>
        <td class="dimtext">${esc(a.source)}</td>
        <td class="nowrap dimtext">${fmtDate(a.pubDate)}</td>
        <td>${toneBadge(a.tone)}</td>
      </tr>`
    )
    .join('');
}

/**
 * 그룹 카드 하나 안에 들어가는 기사 표. 카드 제목에 이미 회사·주제가 있으면 그 컬럼은 뺀다.
 *
 * 5건이 넘으면 관련도 높은 앞 5건만 보여주고 나머지 행은 숨긴 뒤 "더보기"로 편다
 * (2026-08-18 피드백 — 한 회사에 15건씩 쏟아져 리포트가 너무 길었다).
 * 표를 둘로 쪼개면 열 너비가 서로 어긋나므로 표는 하나로 두고 뒷 행에만 클래스를 준다.
 * 토글은 파일 맨 아래 인라인 스크립트가 담당한다(외부 의존성 없음 — 파일 하나로 열린다).
 */
function articleTable(items: ChatQueryResult['articles'], showTag: boolean) {
  const head = `<thead><tr>${showTag ? '<th>회사·키워드</th>' : ''}<th>제목</th><th>매체</th><th>날짜</th><th>톤</th></tr></thead>`;

  if (items.length <= GROUP_PREVIEW_COUNT) {
    return `<table>${head}<tbody>${articleRows(items, showTag)}</tbody></table>`;
  }

  const shown = articleRows(items.slice(0, GROUP_PREVIEW_COUNT), showTag);
  const rest = items.slice(GROUP_PREVIEW_COUNT);
  // 숨길 행에 class="extra"를 달아둔다. 인쇄할 땐 CSS가 전부 다시 펴준다.
  const hidden = articleRows(rest, showTag).replace(/<tr>/g, '<tr class="extra">');
  return `<table>${head}<tbody>${shown}${hidden}</tbody></table>
    <button type="button" class="more-btn" data-count="${rest.length}">기사 ${rest.length}건 더보기</button>`;
}

/**
 * 근거 기사 — 화면(ChatWelcome)과 똑같이 회사·주제별 카드로 묶는다.
 *
 * 예전엔 여기만 그룹핑 없이 전체를 한 표로 뿌려서, 회사·키워드 컬럼에 같은 값이 계속
 * 반복되고 30건이 한 덩어리로 이어졌다(2026-08-18 피드백). 인쇄(PDF)에서도 카드 하나가
 * 페이지 중간에 잘리지 않도록 page-break-inside: avoid를 걸어둔다.
 */
function articleGroupsHtml(articles: ChatQueryResult['articles']) {
  const { topics, companies, companyArticles } = organizeArticles(articles);

  const groupCard = (icon: string, tag: string, items: ChatQueryResult['articles'], kindLabel?: string) =>
    `<div class="group">
      <div class="group-head">
        <span class="group-name">${icon} ${kindLabel ? `<span class="group-kind">${esc(kindLabel)}</span> ` : ''}${esc(tag)}</span>
        <span class="group-count">${items.length}건</span>
      </div>
      ${articleTable(items, false)}
    </div>`;

  const parts = [
    ...companies.map((g) => groupCard('🏢', g.tag, g.items)),
    ...topics.map((g) => groupCard('📌', g.tag, g.items, '주제')),
  ];

  // 어느 그룹에도 안 묶인(그 회사·주제 기사가 1건뿐인) 기사 — 억지로 1건짜리 카드를
  // 만들지 않고 하나로 모아서 회사·키워드 컬럼을 살려 보여준다.
  if (companyArticles.length) {
    parts.push(`<div class="group">
      <div class="group-head">
        <span class="group-name">🏢 그 외 매칭된 기사</span>
        <span class="group-count">${companyArticles.length}건</span>
      </div>
      ${articleTable(companyArticles, true)}
    </div>`);
  }

  // 그룹이 하나도 안 잡히면(전부 1건씩) 굳이 카드로 감쌀 이유가 없다.
  if (!companies.length && !topics.length) return articleTable(articles, true);
  return parts.join('');
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

  const noteBlock = (r?.deltaUnavailableReason || r?.deltaCaution)
    ? `<p class="note">${esc(r.deltaUnavailableReason ?? r.deltaCaution ?? '')}</p>`
    : '';

  // 채팅 화면(ChatWelcome.tsx)에 뜨는 그래프와 저장한 HTML의 그래프가 서로 다르면 안
  // 된다는 실사용 피드백(2026-08-12)으로, 같은 resultKind 조건으로 같은 차트를 그린다.
  const toneDonutBlock =
    res.resultKind === 'search' && r && (r.positiveCount ?? 0) + (r.neutralCount ?? 0) + r.negativeCount > 0
      ? donutChart('톤 분포', '긍정·중립·부정 톤 비율', [
          { label: '긍정', value: r.positiveCount ?? 0, color: '#16A34A' },
          { label: '중립', value: r.neutralCount ?? 0, color: '#8B8894' },
          { label: '부정', value: r.negativeCount, color: '#DC2626' },
        ])
      : '';
  const categoryDonutBlock =
    res.resultKind === 'search' && r && r.byCategory.filter((c) => c.count > 0).length > 1
      ? donutChart(
          '분류 비율',
          '분류별 기사 비율',
          r.byCategory.map((c) => ({ label: categoryLabel(c.category), value: c.count, color: CATEGORY_COLOR[c.category] ?? '#8B8894' }))
        )
      : '';
  const pitchBarBlock =
    res.resultKind === 'pitch' && r?.articles.some((a) => a.pitchScore != null) ? pitchScoreBarChart(r.articles) : '';

  // 분석 — 톤 분포 도넛을 요약 문단 옆에 붙인다. 예전엔 도넛이 "집계" 섹션 맨 아래
  // 혼자 떨어져 있어서 본문과 무슨 관계인지 바로 안 읽혔다(2026-08-18 요청). 요약이
  // 없거나 도넛을 그릴 톤 데이터가 없으면 한쪽만 자연스럽게 전체 폭을 쓴다.
  const summaryBlock = res.summary
    ? `<section>
        <h2>분석</h2>
        <div class="${toneDonutBlock ? 'analysis-row' : ''}">
          <div class="prose">${renderSummary(res.summary)}</div>
          ${toneDonutBlock}
        </div>
      </section>`
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
        ${res.resultKind === 'trend' && r.monthly?.length ? trendChart(r.monthly, r.trendGranularity ?? 'month') : ''}
        ${/* 요약이 없어서 도넛을 위로 못 옮긴 경우에만 여기 그대로 둔다 */ ''}
        ${!res.summary ? toneDonutBlock : ''}
        ${categoryDonutBlock}
        ${pitchBarBlock}
      </section>`
    : '';

  const articleBlock = r?.articles.length
    ? `<section>
        <h2>근거 기사 <span class="count">${r.articles.length}건${r.total > r.articles.length ? ` / 전체 ${r.total.toLocaleString()}건` : ''}</span></h2>
        ${articleGroupsHtml(r.articles)}
      </section>`
    : '';

  const noiseBlock = r?.noisyKeywords?.length ? noiseTable(r.noisyKeywords) : '';

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
  /* 분석 문단 옆에 톤 분포 도넛을 붙인다 — 요약과 톤 비율을 한눈에 같이 본다(2026-08-18). */
  .analysis-row { display: grid; grid-template-columns: 1fr 230px; gap: 24px; align-items: start; }
  .analysis-row .chart-card { margin-top: 0; }
  @media (max-width: 640px) { .analysis-row { grid-template-columns: 1fr; } }
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
  .chart-card { margin-top: 14px; }
  .donut-wrap { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  .donut-legend { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
  .donut-legend-row { display: flex; align-items: center; gap: 7px; }
  .donut-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
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

  /* 근거 기사 — 회사·주제별 카드 */
  .group { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 12px; }
  .group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px;
                background: var(--subtle); padding: 9px 14px; border-bottom: 1px solid var(--border); }
  .group-name { color: var(--purple); font-weight: 700; font-size: 13px; }
  .group-kind { color: var(--muted); font-weight: 500; font-size: 10.5px; }
  .group-count { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .group table { margin-top: 0; }
  .group th { padding-top: 9px; padding-bottom: 9px; }
  .group tbody tr:last-child td { border-bottom: none; }
  /* 앞 5건만 보이고, 나머지는 "더보기"를 눌러야 나온다 */
  .group tr.extra { display: none; }
  .group.open tr.extra { display: table-row; }
  .more-btn { display: block; width: 100%; border: none; border-top: 1px solid var(--border);
              background: #FCFBF9; color: var(--purple); font: inherit; font-size: 12px;
              font-weight: 700; padding: 8px 14px; cursor: pointer; text-align: center; }
  .more-btn:hover { background: var(--subtle); }
  .more-btn::after { content: ' ▾'; }
  .group.open .more-btn::after { content: ' ▴'; }

  /* 답변 본문 안의 마크다운 표 */
  .md-table { margin: 0 0 14px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .md-table th { background: var(--subtle); }
  .md-table td { font-size: 12.5px; vertical-align: middle; }
  .md-table tbody tr:last-child td { border-bottom: none; }
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
    tr, .card, .group { page-break-inside: avoid; }
    /* 인쇄물은 접어둘 이유가 없다 — 숨긴 기사까지 전부 펴서 뽑는다 */
    .group tr.extra { display: table-row; }
    .more-btn { display: none; }
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
    ${noiseBlock}
    ${articleBlock}
    <footer>SparkScope 수집 기사 DB 기반 자동 생성 · 스파크랩 내부 자료 · 외부 공유 금지</footer>
  </div>
  <script>
    // "더보기" 토글. 이거 하나뿐이고 외부 스크립트는 쓰지 않는다 — 파일 하나로 열려야 한다.
    document.querySelectorAll('.more-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.closest('.group');
        var open = group.classList.toggle('open');
        btn.textContent = open ? '접기' : '기사 ' + btn.dataset.count + '건 더보기';
      });
    });
  </script>
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
