// 포트폴리오사 브리핑 — Inter(해외 트렌드) 탭의 "기회 판정 근거"에서 회사 한 곳을 골라,
// "왜 이 회사가 이 해외 기사들과 묶였는지 + 그래서 어디에 집중해야 하는지"를 요약하고
// 그 아래에 업계 동향(대시보드에 이미 보이는 숫자 그대로)을 붙인 HTML 한 장을 만든다.
//
// 1단계에서는 수신자 DB가 없다 — 대표님이 화면에서 미리 보고 복사하거나 본인 메일로 받아
// 포폴사에 직접 포워딩한다. 나중에 PortfolioCompany에 contactEmail이 생기면
// 이 함수가 만든 html을 그대로 sendDigestEmail의 to만 바꿔 쓰면 되도록 분리해 둔다.

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = 'gpt-4o-mini';

export interface BriefingArticle {
  title: string;
  url: string;
  media: string;
  date: string;
  reason: string;       // 이 기사가 왜 이 회사와 묶였는지(매칭 단계 AI 근거)
  eventKey?: string | null;
}

export interface BriefingInput {
  company: string;
  domainLabel: string;          // '바이오' | 'AI'
  periodLabel: string;          // '2026-05-07 ~ 2026-08-07'
  sector: {
    name: string;
    badgeLabel: string;
    badgeWhy: string;
    count: number;
    deltaPct: number | null;
    share: number;              // 0~1
    sourceCount: number;
    paperCount: number;
    matchCount: number;
  };
  overview: {
    total: number;
    deltaPct: number | null;
    sourceCount: number;
    matchCount: number;
    matchedCompanyCount: number;
    topSectors: { name: string; count: number; deltaPct: number | null }[];
  };
  articles: BriefingArticle[];
}

export interface BriefingBody {
  summary: string;                              // 왜 매칭됐는지 2~3문장
  focus: { title: string; why: string }[];      // 집중 포인트
  isAi: boolean;                                // AI가 실제로 쓴 문장인지, 기본 문구인지
}

const SYSTEM =
  '너는 스타트업 액셀러레이터(스파크랩스)의 해외 트렌드 분석가다. 포트폴리오사 대표에게 보낼 브리핑의 ' +
  '요약 부분을 쓴다. 주어진 해외 기사 제목·매칭 근거·집계 지표 안에 있는 사실만 쓰고, 없는 숫자나 ' +
  '사실을 지어내지 마라. 문장은 "~습니다/~합니다" 존댓말 종결형으로 쓴다. ' +
  '반드시 JSON 객체 하나만 반환한다.';

/** 왜 매칭됐는지 + 어디에 집중해야 하는지 요약. 실패하면 지표 기반 기본 문구로 대체한다. */
export async function summarizeBriefing(input: BriefingInput): Promise<BriefingBody> {
  const fallback: BriefingBody = {
    summary:
      `이 기간(${input.periodLabel}) ${input.domainLabel} 해외 트렌드 중 '${input.sector.name}' 주제에서 ` +
      `${input.company}와 관련 있다고 판정된 기사가 ${input.articles.length}건 확인됐습니다. ` +
      `해당 주제는 ${input.sector.badgeWhy} 상태입니다.`,
    focus: [],
    isAi: false,
  };
  if (input.articles.length === 0) return fallback;

  try {
    const articleLines = input.articles
      .slice(0, 20)
      .map((a, i) => `${i + 1}. [${a.media} · ${a.date}] ${a.title}\n   매칭 근거: ${a.reason}`)
      .join('\n');

    const user = `포트폴리오사: ${input.company}
분야: ${input.domainLabel} / 주제: ${input.sector.name}
주제 상태: ${input.sector.badgeLabel} (${input.sector.badgeWhy})
집계 지표: 이 주제 기사 ${input.sector.count}건, 매체 ${input.sector.sourceCount}곳, 논문 ${input.sector.paperCount}건, 포트폴리오 매칭 ${input.sector.matchCount}건
조회 기간: ${input.periodLabel}

이 회사와 매칭된 해외 기사:
${articleLines}

위 기사와 지표만 근거로 다음 두 가지를 써주세요.
1) summary: 이 회사가 왜 이 해외 흐름과 연결되는지를 대표에게 설명하는 2~3문장. 기사에 실제로 나온 기술·기업·규제·거래를 구체적으로 언급하세요.
2) focus: 이 회사가 지금 집중해서 볼 만한 지점 2~4개. 각 항목은 title(예: "신약 발굴 파이프라인", "미국 FDA 규제 변화")과 why(왜 그런지 한 문장, 근거가 된 기사 내용 언급).

출력 스키마: {"summary": "...", "focus": [{"title": "...", "why": "..."}]}
JSON 객체만 반환:`;

    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 700,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const focus = Array.isArray(parsed?.focus)
      ? parsed.focus
          .filter((f: unknown): f is { title: string; why: string } =>
            !!f && typeof (f as any).title === 'string' && typeof (f as any).why === 'string')
          .slice(0, 4)
          .map((f: { title: string; why: string }) => ({ title: f.title.trim(), why: f.why.trim() }))
      : [];
    if (!summary) return fallback;
    return { summary, focus, isAi: true };
  } catch (e) {
    console.error('[inter-briefing] summarizeBriefing failed:', e);
    return fallback;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function deltaText(d: number | null): string {
  if (d === null) return '신규';
  if (d === 0) return '±0%';
  return `${d > 0 ? '▲' : '▼'}${Math.abs(d)}%`;
}

export function briefingSubject(input: BriefingInput): string {
  return `[SparkScope] ${input.company} 관련 해외 ${input.domainLabel} 동향 ${input.articles.length}건 (${input.periodLabel})`;
}

/**
 * 메일 클라이언트용 HTML. 다이제스트 메일과 같은 제약을 지킨다 —
 * 인라인 스타일만, 외부 CSS·스크립트·이미지 없음, 표 대신 단순 블록.
 */
export function renderBriefingHtml(input: BriefingInput, body: BriefingBody): string {
  const { company, domainLabel, periodLabel, sector, overview, articles } = input;

  const focusHtml = body.focus.length
    ? `<div style="margin:16px 0 0">
        <div style="font-size:13px;font-weight:700;color:#1f2937;margin-bottom:8px">지금 집중해서 볼 지점</div>
        ${body.focus
          .map(
            f => `<div style="border-left:3px solid #059669;padding:6px 0 6px 10px;margin-bottom:8px">
              <div style="font-size:13px;font-weight:700;color:#065f46">${esc(f.title)}</div>
              <div style="font-size:13px;color:#374151;line-height:1.6;margin-top:2px">${esc(f.why)}</div>
            </div>`
          )
          .join('')}
      </div>`
    : '';

  const articlesHtml = articles
    .map(
      a => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:8px">
        <a href="${esc(a.url)}" style="font-size:13px;font-weight:700;color:#111827;text-decoration:none;line-height:1.5">${esc(a.title)}</a>
        <div style="font-size:11px;color:#9ca3af;margin-top:3px">${esc(a.media)} · ${esc(a.date)}${a.eventKey ? ` · ${esc(a.eventKey)}` : ''}</div>
        <div style="font-size:12px;color:#374151;line-height:1.6;margin-top:6px;padding-top:6px;border-top:1px solid #f3f4f6">
          <b style="color:#047857">왜 ${esc(company)}?</b> ${esc(a.reason)}
        </div>
      </div>`
    )
    .join('');

  const topSectorsHtml = overview.topSectors
    .slice(0, 5)
    .map(
      s => `<li style="font-size:13px;color:#374151;line-height:1.8">
        ${esc(s.name)} — <b>${s.count}건</b> <span style="color:#6b7280">${deltaText(s.deltaPct)}</span>
      </li>`
    )
    .join('');

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111827;background:#ffffff">

  <div style="border-bottom:2px solid #059669;padding-bottom:12px;margin-bottom:16px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#059669">SPARKSCOPE 해외 트렌드 브리핑</div>
    <div style="font-size:20px;font-weight:800;margin-top:4px">${esc(company)}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px">${esc(domainLabel)} · ${esc(sector.name)} · ${esc(periodLabel)}</div>
  </div>

  <div style="background:#ecfdf5;border-radius:10px;padding:14px 16px">
    <div style="font-size:13px;font-weight:700;color:#065f46;margin-bottom:6px">
      ${body.isAi ? '🤖 AI 요약' : '⚙️ 기본 요약'} · 왜 이 기사들이 ${esc(company)}와 연결됐나
    </div>
    <div style="font-size:14px;line-height:1.75;color:#1f2937">${esc(body.summary)}</div>
    ${focusHtml}
  </div>

  <div style="margin-top:22px">
    <div style="font-size:14px;font-weight:800;margin-bottom:8px">🔗 관련 해외 기사 ${articles.length}건</div>
    ${articlesHtml || '<div style="font-size:13px;color:#9ca3af">이 기간 매칭된 기사가 없습니다.</div>'}
  </div>

  <div style="margin-top:22px">
    <div style="font-size:14px;font-weight:800;margin-bottom:8px">📊 업계 동향 — ${esc(sector.name)}</div>
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px">
      <div style="font-size:13px;color:#374151;line-height:1.8">
        <b>${esc(sector.badgeLabel)}</b> · ${esc(sector.badgeWhy)}<br/>
        이 기간 기사 <b>${sector.count}건</b> (${deltaText(sector.deltaPct)}, 직전 동일 기간 대비) ·
        매체 ${sector.sourceCount}곳 · 논문 ${sector.paperCount}건 ·
        ${esc(domainLabel)} 전체 중 비중 ${Math.round(sector.share * 100)}% ·
        포트폴리오 매칭 ${sector.matchCount}건
      </div>
    </div>
  </div>

  <div style="margin-top:18px">
    <div style="font-size:14px;font-weight:800;margin-bottom:8px">🌏 ${esc(domainLabel)} 해외 트렌드 전체</div>
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px">
      <div style="font-size:13px;color:#374151;line-height:1.8">
        전체 기사 <b>${overview.total}건</b> (${deltaText(overview.deltaPct)}) · 매체 ${overview.sourceCount}곳 ·
        포트폴리오 매치 ${overview.matchCount}건 / ${overview.matchedCompanyCount}개사
      </div>
      ${topSectorsHtml ? `<ul style="margin:8px 0 0;padding-left:18px">${topSectorsHtml}</ul>` : ''}
    </div>
  </div>

  <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.7">
    이 브리핑은 SparkScope가 해외 매체·저널 RSS를 수집해 AI로 관련성을 판정하고, 포트폴리오사의 사업 설명과
    비교해 자동 생성한 것입니다. 판정에 오차가 있을 수 있으니 원문 링크로 확인해 주세요.
  </div>
</div>`;
}
