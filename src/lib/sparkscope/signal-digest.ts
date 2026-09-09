/**
 * 다이제스트 메일의 "이번 주 AI 트렌드 TOP 5" 섹션.
 *
 * 목록 선정은 signal-feed.ts가 한다 — 파트너(블루사이트)로 나가는 것과 같은 목록이어야
 * 해서, 규칙이 갈라지지 않게 한 곳에 두었다. 여기는 그리기만 한다.
 *
 * 위치는 '글로벌 트렌드 × 포트폴리오' 바로 아래다. 메일이 가까운 것 → 먼 것 순서
 * (스파크랩 → 포트폴리오 → 해외 트렌드 → 업계)인데 AI 시그널은 그중 가장 바깥이다.
 * 위로 올리면 "우리 얘기"가 밀리고, 맨 아래로 내리면 스크롤 끝이라 안 읽힌다.
 *
 * 색은 보라. 바로 위 Inter 섹션이 초록이라 같은 색을 쓰면 두 섹션이 한 덩어리로 읽힌다.
 *
 * ⚠️ 포트폴리오사 매칭은 넣지 않는다 — 그건 바로 위 섹션의 몫이고,
 *    파트너로 나가는 데이터와 같은 내용으로 유지하려는 목적도 있다.
 */
import type { SignalFeed, FeedItem } from './signal-feed';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n: number) => n.toLocaleString('ko-KR');

function renderRow(it: FeedItem): string {
  const title = it.titleKo || it.title;
  // 뉴스는 요약(summaryKo), 커뮤니티·모델·논문은 설명(blurb)이 같은 자리를 채운다.
  const desc = it.blurb || it.summaryKo;

  // 카드 위쪽 라벨 — 어디서 온 신호이고 얼마나 반응이 있었는지.
  const meta: string[] = [];
  if (it.kind === 'news') {
    // 헤드라인 합의가 있으면 그것을 먼저 말한다 — "함께 보도"보다 강한 근거다.
    if (it.headlineOutlets && it.headlineOutlets >= 2) {
      meta.push(`<span class="s-also">${it.headlineOutlets}개 매체가 1면 헤드라인</span>`);
    } else if (it.alsoInCount) {
      meta.push(`<span class="s-also">+${it.alsoInCount}개 매체가 함께 보도</span>`);
    }
    // 지표 소스는 항목으로 싣지 않고 근거로만 밝힌다.
    if (it.indicatorSources?.length) {
      meta.push(`<span class="s-src">🧭 ${it.indicatorSources.slice(0, 2).join(' · ')}</span>`);
    }
  } else {
    if (it.author) meta.push(`<span class="s-auth">${esc(it.author)}</span>`);
    if (it.points) meta.push(`<span class="s-pt">▲ ${num(it.points)} ${esc(it.pointsLabel ?? '')}</span>`);
  }

  const kindTag = it.kind === 'news'
    ? '<span class="s-tag s-t-news">뉴스</span>'
    : '<span class="s-tag s-t-sig">커뮤니티</span>';

  // 커뮤니티 분기는 지금 쓰이지 않는다(2026-09-09부터 메일에는 뉴스만 나간다).
  // FeedItem 타입에 두 종류가 그대로 있고 파트너 쪽에서 되살릴 수 있으므로 남겨 둔다.
  // 카드는 종류에 따라 색을 달리한다 — 뉴스(보라)와 커뮤니티(주황)가 한 줄씩
  // 번갈아 나오는데, 같은 색이면 다섯 장이 하나의 덩어리로 뭉개져 보인다.
  // 1번은 히어로다. 대시보드에서 그 기사만 큰 배너로 박혀 있는데 메일에서 다섯 장이
  // 같은 크기면 "그날 가장 큰 일"이라는 정보가 사라진다 — 다섯 개를 마구잡이로
  // 늘어놓은 것처럼 읽힌다(2026-09-09 피드백). 웹과 같은 위계를 메일에도 준다.
  const hero = it.rank === 1;

  return `
  <div class="signal-card ${it.kind === 'news' ? 'sc-news' : 'sc-sig'}${hero ? ' sc-hero' : ''}">
    <div class="s-card-top">
      ${hero ? '<span class="s-lead">가장 큰 사안</span>' : `<span class="s-rank">${it.rank}</span>`}${kindTag}<span class="s-src">${esc(it.source)}</span>
    </div>
    <div class="s-title"><a href="${esc(it.url)}" target="_blank">${esc(title)}</a></div>
    ${meta.length ? `<div class="s-meta">${meta.join('')}</div>` : ''}
    ${desc ? `<div class="s-desc">${esc(desc)}</div>` : ''}
  </div>`;
}

/** 항목이 하나도 없으면 섹션 자체를 그리지 않는다 — 빈 제목만 남는 것보다 낫다. */
export function renderSignalSection(feed: SignalFeed | null): string {
  if (!feed || feed.items.length === 0) return '';
  return `
  <div class="signal-sec">
    <div class="s-head-big">🤖 이번 주 AI 트렌드 TOP ${feed.items.length}</div>
    <div class="s-sub">
      여러 매체가 함께 다룬 사안과 1면 헤드라인을 기준으로 세운 순위입니다.
      대시보드 Inter 탭 AI 도메인과 같은 기준입니다.
    </div>
    ${feed.items.map(renderRow).join('\n')}
  </div>`;
}

/** 이 섹션 전용 CSS — 기존 클래스는 하나도 덮어쓰지 않는다(전부 s- / signal- 접두). */
export const SIGNAL_EMAIL_CSS = `
.signal-sec{padding:22px 28px;background:#FAF9FF;border-top:2px solid #6D28D9;border-bottom:1px solid #E4DFF7}
/* 섹션 제목 — 다른 섹션의 11px kicker보다 크게 잡는다. Inter 띠(.i-strip-title)와 같은 취지로,
   "여기부터 다른 이야기"라는 걸 색뿐 아니라 크기로도 갈라 준다. */
.s-head-big{font-size:19px;font-weight:800;color:#4C1D95;line-height:1.3;margin-bottom:6px}
.s-sub{font-size:12.5px;color:#6B7280;line-height:1.6;margin-bottom:16px}

/* 항목마다 한 장씩 — 촘촘한 목록이면 다섯 건이 한 덩어리로 뭉개진다.
   Inter 섹션의 .inter-match와 같은 모양(왼쪽 색 띠 + 카드)으로 맞춰 두 섹션이 형제로 읽히게 한다. */
.signal-card{padding:15px 17px;border-radius:6px;margin-bottom:11px}
.signal-card.sc-news{background:#F3F0FF;border-left:5px solid #6D28D9}
.signal-card.sc-sig{background:#FFF6EF;border-left:5px solid #EA580C}

/* 1번 카드 — 대시보드 히어로와 같은 위계. 색 띠를 두 배로 굵히고 제목을 키우고
   테두리를 둘러 "여기가 그날 가장 큰 일"임을 크기로 말한다. 메일은 hover도 없고
   상호작용도 없으므로 위계를 전부 정적인 형태로 줘야 한다. */
.signal-card.sc-hero{border-left-width:10px;border:1px solid #C4B5FD;border-left:10px solid #6D28D9;background:#EDE9FE;padding:19px 20px;margin-bottom:15px}
.sc-hero .s-title{font-size:19px;font-weight:800;line-height:1.34}
.sc-hero .s-desc{font-size:13.5px;color:#3F3D56;line-height:1.72}
.s-lead{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:800;background:#6D28D9;color:#FFFFFF;margin-right:7px}

.s-card-top{margin-bottom:9px;line-height:1.9}
.s-rank{display:inline-block;min-width:19px;font-size:14px;font-weight:800;color:#6B7280}
.s-tag{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;margin-right:7px}
.s-t-news{background:#EDE9FE;color:#5B21B6}
.s-t-sig{background:#FFEDD5;color:#9A3412}
.s-src{font-size:11.5px;font-weight:700;color:#514E5C}

.s-title{font-size:15.5px;font-weight:700;line-height:1.42;margin-bottom:7px}
.s-title a{color:#1A1A1A;text-decoration:none}

.s-meta{margin-bottom:7px;line-height:1.9}
.s-auth{font-size:11px;font-weight:700;color:#6D28D9;margin-right:8px}
.s-also{display:inline-block;font-size:11px;font-weight:700;color:#047857;background:#ECFDF5;border-radius:10px;padding:2px 9px;margin-right:7px}
.s-pt{font-size:11.5px;font-weight:800;color:#C2410C}

.s-desc{font-size:12.5px;color:#4B5563;line-height:1.68}
`;

/**
 * 다이제스트 데이터에 AI 시그널 TOP 5를 붙인다.
 * attachInterDigest와 같은 모양 — 실패해도 그 섹션만 빠지고 메일은 나간다.
 */
export async function attachAiSignals<T extends { aiSignals?: SignalFeed | null }>(data: T): Promise<T> {
  try {
    const { buildSignalFeed } = await import('./signal-feed');
    data.aiSignals = await buildSignalFeed();
  } catch (e: any) {
    console.error(`[Signal] AI 트렌드 블록 생성 실패 — 그 섹션 없이 발송합니다: ${e?.message}`);
    data.aiSignals = null;
  }
  return data;
}
