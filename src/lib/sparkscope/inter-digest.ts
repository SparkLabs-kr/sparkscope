/**
 * 다이제스트 메일의 Inter(해외 트렌드) 블록 — 데이터 구성 + HTML 렌더링.
 *
 * Intra(국내 모니터링) 쪽 로직은 이 파일에서 일절 건드리지 않는다. digest.ts는 여기서 만든
 * 문자열을 정해진 자리에 끼워 넣기만 하고, 이 블록이 null이면 메일은 예전과 100% 동일하다.
 *
 * ── 어떤 매치를 메일에 올릴지 (2026-08-06, 실데이터 14일치로 검증) ──
 * 매치는 기사 1건당 항상 정확히 3개사가 붙는다(프롬프트 상한이 3이고 모델이 늘 꽉 채운다).
 * 그래서 "매치가 몇 개냐"는 신호가 되지 못하고, 아래 세 가지를 합산해 순위를 매긴다.
 *   ① 셀 배지     — 급증/기회 조합에 속한 매치 우선. buildMatrix가 이미 계산해둔 값이라 추가 비용 0.
 *   ② 매체 등급   — 논문(Nature·Cell·arXiv) > 오피니언(MIT·Review) > 일반 뉴스.
 *   ③ 근거 구체성 — reason에 수치·고유명사·회사명이 있으면 가점, "~수 있습니다"류 추측형은 감점.
 * 셋을 합치면 서로 빈틈을 메운다. 실제로 매칭 상한 도입(2026-08-05, 01c2502) 전에 저장돼
 * 한 기사에 12개사가 붙어버린 07-31 잔재 데이터가, 배지 none + 일반 뉴스라 자동으로 최하위(4점)로
 * 밀려났다 — 잔재를 걸러내는 전용 필터를 따로 두지 않는 이유다.
 *
 * ── 급증이 없는 날 ──
 * 해외 트렌드는 하루이틀로 잘 안 바뀌어서 "급증"이 아예 없는 날이 흔하다(2026-08-06 실측:
 * 전체 -9%, 1위 조합 -12%로 전부 보합·감소). 그래서 제목을 "급증한"으로 고정하지 않고,
 * 실제로 오른 조합이 있을 때만 급증이라 부른다. 증가는 빨강, 감소·보합은 회색 — 빨강을 아무
 * 데나 쓰면 "늘었다"는 신호 자체가 죽는다.
 */
import {
  buildMatrix,
  loadInterData,
  type InterDomain,
} from '../inter-sample-data';

/** 조회창 — 대시보드 기본(3개월)보다 짧게. 메일은 "이번 주 해외 흐름"을 묻는 것이므로 7일. */
const WINDOW_DAYS = 7;
/** 메일에 올릴 카드(기사) 수 */
const CARD_LIMIT = 3;
/** 카드 하나에 보여줄 회사 수 */
const COMPANY_PER_CARD = 2;
/** 상단 띠에 올릴 조합 수 */
const COMBO_LIMIT = 3;

/** 셀 배지별 가중치 — 급증·기회가 압도적으로 앞서도록 벌린다. */
const BADGE_SCORE: Record<string, number> = {
  surge: 40, opportunity: 34, major: 18, quiet: 6, none: 0,
};

const BADGE_LABEL: Record<string, string> = {
  surge: '급증', opportunity: '기회', major: '주요 흐름', quiet: '관측 중', none: '',
};

export interface InterDigestCompany {
  name: string;
  reason: string;
}

export interface InterDigestCard {
  cellLabel: string;      // "디지털헬스 × 연구성과"
  badge: string;          // surge | opportunity | major | quiet | none
  badgeLabel: string;
  sourceKind: 'paper' | 'opinion' | 'news';
  title: string;
  url: string;
  media: string;
  dateLabel: string;
  companies: InterDigestCompany[];
}

export interface InterDigestCombo {
  label: string;
  count: number;
  prevCount: number;
  deltaPct: number | null;
  isSurge: boolean;
}

export interface InterDigestBlock {
  total: number;
  prevTotal: number;
  deltaPct: number | null;
  /** 카드에 실제로 등장하는 회사 이름(중복 제거) — 헤더 stat 칸에 쓴다 */
  companyNames: string[];
  combos: InterDigestCombo[];
  /** 상단 띠에 급증이라 부를 만한 조합이 하나라도 있는지 */
  hasSurge: boolean;
  cards: InterDigestCard[];
}

// ── 점수 ─────────────────────────────────────────────────────────
function sourceScore(source: string): { score: number; kind: 'paper' | 'opinion' | 'news' } {
  if (/Nature|Cell|Science|Scientific American|arXiv/i.test(source)) return { score: 25, kind: 'paper' };
  if (/MIT|Review|Harvard|Telegraph|칼럼|기고/i.test(source)) return { score: 15, kind: 'opinion' };
  return { score: 8, kind: 'news' };
}

/** reason 구체성 — LLM 재호출 없이 문자열만 본다(비용 0). */
function reasonScore(reason: string, companyName: string): number {
  let s = 0;
  if (/\d/.test(reason)) s += 8;                        // 수치
  if (/[A-Z][A-Za-z]{2,}/.test(reason)) s += 8;         // 영문 고유명사 (Dupixent, Regeneron)
  if (reason.includes(companyName)) s += 6;             // 회사를 직접 지목
  if (/\b[A-Z]{2,5}\b/.test(reason)) s += 5;            // 약어 (RTM, LLM, FIDO)
  const hedges = (reason.match(/수 있습니다|가능성이|것으로 보입니다|우호적입니다/g) ?? []).length;
  if (hedges >= 2) s -= 10;
  else if (hedges === 1) s -= 4;
  return s;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 해외 트렌드 블록을 만든다. 쓸 만한 매치가 하나도 없으면 null —
 * 호출부는 null이면 섹션을 통째로 빼면 된다(메일은 예전 모습 그대로).
 */
export async function buildInterDigest(
  domain: InterDomain = 'bio',
  now: Date = new Date(),
): Promise<InterDigestBlock | null> {
  const until = new Date(now); until.setHours(23, 59, 59, 999);
  const since = new Date(until.getTime() - WINDOW_DAYS * 86400000); since.setHours(0, 0, 0, 0);

  const data = await loadInterData(domain, since, until, 'all');
  if (data.verdicts.length === 0) return null;

  const matrix = buildMatrix(domain, data);
  const h = matrix.headline;

  // verdictId -> 그 기사가 속한 셀(배지·라벨). topItems는 셀당 최신 3건이라
  // 여기 안 잡히는 기사는 배지 none으로 떨어지며, 그게 곧 "매트릭스에서 존재감이 없다"는 뜻이다.
  const cellOf = new Map<string, { badge: string; label: string }>();
  matrix.rows.forEach(r => r.cells.forEach(c => {
    c.topItems.forEach(it => cellOf.set(it.id, { badge: c.badge.kind, label: `${c.topicKey} × ${c.eventKey}` }));
  }));

  const verdictById = new Map(data.verdicts.map(v => [v.id, v]));

  const scored = data.matches.flatMap(m => {
    const v = verdictById.get(m.verdictId);
    if (!v || !m.reason) return [];
    const cell = cellOf.get(m.verdictId);
    const src = sourceScore(v.news.source);
    const badge = cell?.badge ?? 'none';
    return [{
      vid: m.verdictId,
      score: (BADGE_SCORE[badge] ?? 0) + src.score + reasonScore(m.reason, m.companyName),
      badge,
      cellLabel: cell?.label ?? '기타 트렌드',
      sourceKind: src.kind,
      company: m.companyName,
      reason: m.reason,
      verdict: v,
    }];
  });
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);

  // 기사 단위로 묶는다 — 점수순으로만 자르면 같은 기사가 회사만 바뀌어 상위를 도배한다.
  const byArticle = new Map<string, typeof scored>();
  for (const s of scored) {
    const arr = byArticle.get(s.vid) ?? [];
    arr.push(s);
    byArticle.set(s.vid, arr);
  }

  const cards: InterDigestCard[] = Array.from(byArticle.values())
    .sort((a, b) => b[0]!.score - a[0]!.score)
    .slice(0, CARD_LIMIT)
    .map(rows => {
      const top = rows[0]!;
      const v = top.verdict;
      return {
        cellLabel: top.cellLabel,
        badge: top.badge,
        badgeLabel: BADGE_LABEL[top.badge] ?? '',
        sourceKind: top.sourceKind,
        title: v.titleKo || v.news.title,
        url: v.news.url,
        media: v.news.source,
        dateLabel: formatDate(v.news.publishedAt),
        companies: rows.slice(0, COMPANY_PER_CARD).map(r => ({ name: r.company, reason: r.reason })),
      };
    });
  if (cards.length === 0) return null;

  const companyNames = Array.from(new Set(cards.flatMap(c => c.companies.map(x => x.name))));

  // 상단 띠 — hottest는 증가율 순이라 감소만 있는 날에도 값이 채워진다.
  // "급증"이라 부르는 기준은 셀 배지(computeCellBadge)와 같게 맞춘다: 직전 대비 +50% 이상 & 3건 이상.
  const combos: InterDigestCombo[] = h.hottest.slice(0, COMBO_LIMIT).map(x => ({
    label: x.label,
    count: x.count,
    prevCount: x.prevCount,
    deltaPct: x.deltaPct,
    isSurge: x.prevCount > 0 && x.deltaPct !== null && x.deltaPct >= 50 && x.count >= 3,
  }));

  return {
    total: h.total,
    prevTotal: h.prevTotal,
    deltaPct: h.deltaPct,
    companyNames,
    combos,
    hasSurge: combos.some(c => c.isSurge),
    cards,
  };
}

/**
 * DigestData에 Inter 블록을 붙인다. Inter 쪽에서 무슨 일이 나도 국내 다이제스트 발송은
 * 막지 않는다 — 실패하면 inter=null로 두고 예전과 똑같은 메일이 나간다.
 */
export async function attachInterDigest<T extends { inter?: InterDigestBlock | null }>(
  data: T,
  domain: InterDomain = 'bio',
): Promise<T> {
  try {
    data.inter = await buildInterDigest(domain);
  } catch (e: any) {
    console.error(`[Inter] 다이제스트 블록 생성 실패 — 해외 섹션 없이 발송합니다: ${e?.message}`);
    data.inter = null;
  }
  return data;
}

// ── 렌더링 ───────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 증감 표기 — 오른 것만 빨강, 나머지는 회색. */
function delta(deltaPct: number | null): string {
  if (deltaPct === null) return '<span class="i-flat">비교 불가</span>';
  if (deltaPct > 0) return `<span class="i-up">▲${deltaPct}%</span>`;
  if (deltaPct < 0) return `<span class="i-flat">▼${Math.abs(deltaPct)}%</span>`;
  return '<span class="i-flat">보합</span>';
}

/** 헤더 stats 안에 들어갈 칸 하나. "해외 39건"이 아니라 "몇 개사가 우리와 연결됐나"를 값으로 쓴다. */
export function renderInterStat(b: InterDigestBlock): string {
  const names = b.companyNames;
  const shown = names.slice(0, 2).join(' · ');
  const rest = names.length > 2 ? ` 외 ${names.length - 2}` : '';
  return `
      <div class="stat inter">
        <div class="i-kicker">🔭 해외 트렌드</div>
        <div class="i-big">${names.length}<span>개사 연결</span></div>
        <div class="i-detail">${esc(shown)}${rest}</div>
        <div class="i-detail">해외 ${b.total}건 ${delta(b.deltaPct)}</div>
      </div>`;
}

/** TOP3 바로 아래 요약 띠. */
export function renderInterStrip(b: InterDigestBlock): string {
  if (b.combos.length === 0) return '';
  const title = '🔭 해외 트렌드 주요 Topic';

  const rows = b.combos.map((c, i) => `
    <div class="i-rank">
      <span class="i-no">${i + 1}</span><span class="i-combo">${esc(c.label)}</span>
      <span class="i-nums"> · ${c.count}건 (직전 ${c.prevCount}건) </span>${delta(c.deltaPct)}${
        c.isSurge ? '<span class="i-tag surge">급증</span>' : ''
      }
    </div>`).join('');

  const names = b.companyNames;
  const foot = b.hasSurge
    ? `이 중 <strong>${names.length}개사</strong>(${esc(names.slice(0, 3).join(' · '))})가 우리 포트폴리오와 연결됩니다 — 아래 참고`
    : `이번 주는 <strong>새로 튀어오른 조합이 없습니다</strong> — 아래는 우리 포트폴리오와 연결된 흐름입니다`;

  return `
  <div class="inter-strip">
    <div class="i-strip-label">${title}</div>
    ${rows}
    <div class="i-strip-foot">${foot}</div>
  </div>`;
}

/** 본문 섹션 — TOP 3 바로 아래에 들어간다. */
export function renderInterSection(b: InterDigestBlock, baseUrl: string): string {
  const cards = b.cards.map(c => {
    const kindTag = c.sourceKind === 'paper' ? '<span class="i-tag paper">논문</span>'
      : c.sourceKind === 'opinion' ? '<span class="i-tag opinion">오피니언</span>' : '';
    const badgeTag = c.badgeLabel
      ? `<span class="i-tag ${c.badge === 'surge' ? 'surge' : 'opp'}">${c.badgeLabel}</span>` : '';
    const companies = c.companies.map(co =>
      `<div class="i-co">· <b>${esc(co.name)}</b> — ${esc(co.reason)}</div>`).join('');
    return `
    <div class="inter-match">
      <div class="i-match-label">${esc(c.cellLabel)}</div>
      <div>${badgeTag}${kindTag}</div>
      <div class="i-match-title"><a href="${esc(c.url)}" target="_blank">${esc(c.title)}</a></div>
      <div class="i-match-src">${esc(c.media)} · ${c.dateLabel}</div>
      ${companies}
    </div>`;
  }).join('\n');

  return `
  <div class="section inter-sec">
    <div class="section-label inter-lb">🔭 글로벌 트렌드 × 우리 포트폴리오</div>
    <div class="i-sub">
      최근 ${WINDOW_DAYS}일 해외 매체·논문 <strong>${b.total}건</strong> 중, 우리 포트폴리오사와
      연결된 <strong>${b.cards.length}건</strong>을 골랐습니다 (연결된 회사 ${b.companyNames.length}개사).
    </div>
    ${cards}
    <a href="${esc(baseUrl)}/dashboard?scope=inter" class="i-cta">Inter 탭에서 전체 트렌드 보기 →</a>
  </div>`;
}

/** Inter 블록 전용 CSS — 기존 EMAIL_CSS 클래스는 하나도 덮어쓰지 않는다(전부 i- / inter- 접두). */
export const INTER_EMAIL_CSS = `
.i-up{color:#DC2626;font-weight:800}
.i-flat{color:#6B7280;font-weight:700}
.stat.inter{background:#ECFDF5;text-align:left;flex:1.75}
.stat.inter .i-kicker{font-size:9.5px;font-weight:800;letter-spacing:.8px;color:#047857;text-transform:uppercase}
.stat.inter .i-big{font-size:20px;font-weight:800;color:#064E3B;line-height:1.15;margin-top:2px}
.stat.inter .i-big span{font-size:12px;font-weight:700}
.stat.inter .i-detail{font-size:10px;color:#6B7280;margin-top:3px;line-height:1.45}
.inter-strip{padding:18px 28px;background:#ECFDF5;border-bottom:1px solid #A7F3D0}
.i-strip-label{font-size:11px;font-weight:700;letter-spacing:1.2px;color:#047857;text-transform:uppercase;margin-bottom:9px}
.i-rank{padding:4px 0;font-size:13px;color:#065F46;line-height:1.5}
.i-no{display:inline-block;width:14px;font-weight:800;color:#A7F3D0}
.i-combo{font-weight:800;color:#064E3B}
.i-nums{color:#6B7280;font-size:11.5px}
.i-strip-foot{margin-top:10px;padding-top:9px;border-top:1px solid #A7F3D0;font-size:12.5px;color:#065F46;line-height:1.6}
.i-strip-foot strong{color:#047857}
.section.inter-sec{border-bottom:1px solid #D1FAE5}
.section-label.inter-lb{color:#047857}
.i-sub{font-size:12.5px;color:#6B7280;margin:-10px 0 14px;line-height:1.6}
.i-sub strong{color:#374151}
.inter-match{background:#ECFDF5;border-left:5px solid #059669;padding:15px 17px;border-radius:6px;margin-bottom:11px}
.i-match-label{font-size:11px;font-weight:700;color:#047857;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.i-match-title{font-size:14.5px;font-weight:700;color:#064E3B;margin:8px 0 3px;line-height:1.4}
.i-match-title a{color:#064E3B;text-decoration:none}
.i-match-src{font-size:11px;color:#6B7280;margin-bottom:9px}
.i-co{font-size:12.5px;color:#065F46;line-height:1.6;padding:4px 0}
.i-co b{color:#047857;font-weight:800}
.i-cta{display:block;width:100%;box-sizing:border-box;margin-top:13px;padding:13px 20px;background:#059669;color:#FFF !important;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700;text-align:center}
.i-tag{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;margin-right:6px}
.i-tag.surge{background:#FEE2E2;color:#991B1B}
.i-tag.opp{background:#FEF3C7;color:#92400E}
.i-tag.paper{background:#EDE9FE;color:#5B21B6}
.i-tag.opinion{background:#E0F2FE;color:#075985}
`;
