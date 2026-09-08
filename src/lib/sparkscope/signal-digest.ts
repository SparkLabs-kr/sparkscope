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

  const meta: string[] = [`<span class="s-src">${esc(it.source)}</span>`];
  if (it.kind === 'news') {
    if (it.alsoInCount) meta.push(`<span class="s-also">+${it.alsoInCount}개 매체가 함께 보도</span>`);
  } else {
    if (it.author) meta.push(`<span class="s-auth">${esc(it.author)}</span>`);
    if (it.points) meta.push(`<span class="s-pt">▲ ${num(it.points)} ${esc(it.pointsLabel ?? '')}</span>`);
  }

  const kind = it.kind === 'news'
    ? '<span class="s-kind s-k-news">뉴스</span>'
    : '<span class="s-kind s-k-sig">커뮤니티</span>';

  return `
  <table class="s-row" cellpadding="0" cellspacing="0" width="100%"><tr>
    <td class="s-no">${it.rank}</td>
    <td>
      <div class="s-head">${kind}${meta.join('')}</div>
      <div class="s-title"><a href="${esc(it.url)}" target="_blank">${esc(title)}</a></div>
      ${desc ? `<div class="s-desc">${esc(desc)}</div>` : ''}
    </td>
  </tr></table>`;
}

/** 항목이 하나도 없으면 섹션 자체를 그리지 않는다 — 빈 제목만 남는 것보다 낫다. */
export function renderSignalSection(feed: SignalFeed | null): string {
  if (!feed || feed.items.length === 0) return '';
  return `
  <div class="signal-sec">
    <div class="section-label signal-lb">🤖 이번 주 AI 트렌드 TOP ${feed.items.length}</div>
    <div class="s-sub">
      신뢰할 수 있는 매체의 보도와 개발자·연구자 커뮤니티에서 화제인 글을 함께 세운 순위입니다.
      대시보드 Inter 탭 AI 도메인과 같은 기준입니다.
    </div>
    ${feed.items.map(renderRow).join('\n')}
  </div>`;
}

/** 이 섹션 전용 CSS — 기존 클래스는 하나도 덮어쓰지 않는다(전부 s- / signal- 접두). */
export const SIGNAL_EMAIL_CSS = `
.signal-sec{padding:20px 28px;background:#FAF9FF;border-top:2px solid #6D28D9;border-bottom:1px solid #E4DFF7}
.section-label.signal-lb{color:#6D28D9}
.s-sub{font-size:11.5px;color:#6B7280;line-height:1.6;margin:-4px 0 14px}
.s-row{border-bottom:1px dashed #EDE9FB}
.s-row:last-child{border-bottom:0}
.s-no{width:26px;vertical-align:top;padding:10px 10px 10px 0;font-size:16px;font-weight:800;color:#6D28D9;text-align:right}
.s-row td{padding:10px 0}
.s-head{margin-bottom:4px;line-height:1.9}
.s-kind{font-size:9.5px;font-weight:800;padding:2px 6px;border-radius:3px;margin-right:6px;white-space:nowrap}
.s-k-news{background:#EDE9FB;color:#5B21B6}
.s-k-sig{background:#FFF1E7;color:#C2410C}
.s-src{font-size:10.5px;font-weight:700;color:#514E5C;margin-right:6px}
.s-auth{font-size:10px;font-weight:700;color:#6D28D9;margin-right:6px}
.s-also{font-size:10px;font-weight:700;color:#047857;background:#ECFDF5;border-radius:3px;padding:2px 5px;margin-right:6px}
.s-pt{font-size:10.5px;font-weight:700;color:#C2410C}
.s-title{font-size:14px;font-weight:600;line-height:1.4}
.s-title a{color:#1A1A1A;text-decoration:none}
.s-desc{font-size:11.5px;color:#6B7280;line-height:1.6;margin-top:4px}
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
