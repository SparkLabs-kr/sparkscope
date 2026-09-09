/**
 * Inter 매치 순위 점수 검증 — 세 신호를 합산해서 다이제스트에 올릴 매치를 고른다.
 *   ① 셀 배지   : 급증/기회 조합에 속한 매치 우선 (computeCellBadge 결과 재사용, 추가 비용 0)
 *   ② 매체 등급 : paper(Nature·Cell·arXiv) > opinion(MIT·Review) > news
 *   ③ reason 구체성 : 회사명·제품명·수치가 박힌 reason 우선, "~수 있습니다" 추측형은 감점
 *
 * 지금은 점수가 실제로 뭘 뽑는지 눈으로 확인하는 단계 — 앱 코드는 아직 안 건드린다.
 * ※ Inter 전용. 임시 스크래치 파일(커밋 대상 아님).
 */
import './_env';
import { loadInterData, buildMatrix, type InterDomain } from '../src/lib/inter-sample-data';

const BADGE_SCORE: Record<string, number> = {
  surge: 40, opportunity: 34, major: 18, quiet: 6, none: 0,
};

function sourceScore(source: string): { score: number; kind: string } {
  if (/Nature|Cell|Science|Scientific American|arXiv/i.test(source)) return { score: 25, kind: 'paper' };
  if (/MIT|Review|Harvard|Telegraph|칼럼|기고/i.test(source)) return { score: 15, kind: 'opinion' };
  return { score: 8, kind: 'news' };
}

/**
 * reason 구체성 — LLM 재호출 없이 문자열만 본다.
 * 고유명사(영문 대문자 시작 단어·한글 회사명)와 수치가 있으면 가점,
 * 근거 없이 "가능성이 있습니다"로 끝나는 추측형은 감점.
 */
function reasonScore(reason: string, companyName: string): { score: number; why: string[] } {
  const why: string[] = [];
  let s = 0;
  if (/\d/.test(reason)) { s += 8; why.push('수치'); }
  if (/[A-Z][A-Za-z]{2,}/.test(reason)) { s += 8; why.push('영문고유명사'); }
  if (reason.includes(companyName)) { s += 6; why.push('회사명직접'); }
  // 제품·기술 고유명사 힌트 (OTAC, ADC, LLM 같은 약어)
  if (/\b[A-Z]{2,5}\b/.test(reason)) { s += 5; why.push('약어'); }
  const hedges = (reason.match(/수 있습니다|가능성이|것으로 보입니다|우호적입니다|자극할/g) ?? []).length;
  if (hedges >= 2) { s -= 10; why.push(`추측형x${hedges}`); }
  else if (hedges === 1) { s -= 4; why.push('추측형'); }
  return { score: s, why };
}

async function main() {
  const until = new Date(); until.setHours(23, 59, 59, 999);
  const since = new Date(until.getTime() - 7 * 86400000); since.setHours(0, 0, 0, 0);

  for (const domain of ['bio', 'ai'] as InterDomain[]) {
    const data = await loadInterData(domain, since, until, 'all');
    const matrix = buildMatrix(domain, data);

    // verdictId -> 그 기사가 속한 셀의 배지
    const cellOf = new Map<string, { badge: string; label: string }>();
    matrix.rows.forEach(r => r.cells.forEach(c => {
      c.topItems.forEach(it => cellOf.set(it.id, { badge: c.badge.kind, label: `${c.topicKey}×${c.eventKey}` }));
    }));

    const scored = data.matches.map(m => {
      const v = data.verdicts.find(x => x.id === m.verdictId);
      if (!v) return null;
      const cell = cellOf.get(m.verdictId);
      const src = sourceScore(v.news.source);
      const rs = reasonScore(m.reason ?? '', m.companyName);
      const badge = cell?.badge ?? 'none';
      return {
        vid: m.verdictId,
        total: (BADGE_SCORE[badge] ?? 0) + src.score + rs.score,
        badge, cellLabel: cell?.label ?? '(매트릭스 밖)',
        srcKind: src.kind, media: v.news.source,
        company: m.companyName,
        title: (v.titleKo || v.news.title).slice(0, 52),
        reason: (m.reason ?? '').slice(0, 78),
        why: rs.why,
      };
    }).filter(Boolean) as any[];

    scored.sort((a, b) => b.total - a.total);

    // 기사 단위로 묶는다 — 점수만으로 뽑으면 같은 기사가 회사만 바뀌어 상위를 도배한다.
    // 카드 1장 = 기사 1건, 그 안에 점수 높은 회사 최대 2개사.
    const byArticle = new Map<string, any[]>();
    scored.forEach(s => {
      const a = byArticle.get(s.vid) ?? [];
      a.push(s); byArticle.set(s.vid, a);
    });
    const cards = Array.from(byArticle.values())
      .map(rows => ({ ...rows[0], companies: rows.slice(0, 2) }))
      .sort((a, b) => b.total - a.total);

    console.log(`\n${'='.repeat(104)}`);
    console.log(`■ domain=${domain} · 최근 7일 · 매치 ${scored.length}건 → 기사 ${cards.length}장 · 상위 3장이 메일에 올라감`);
    console.log('='.repeat(104));
    cards.slice(0, 4).forEach((s, i) => {
      const mark = i < 3 ? '★' : ' ';
      console.log(`\n${mark}[${i + 1}] ${s.total}점  (배지 ${s.badge} / ${s.srcKind} ${s.media} / reason ${s.why.join('·') || '-'})`);
      console.log(`    ${s.cellLabel}`);
      console.log(`    ${s.title}`);
      s.companies.forEach((c: any) => console.log(`      · ${c.company} — "${c.reason.slice(0, 68)}"`));
    });

    console.log(`\n  ── 하위 3건(=메일에 안 올라갈 것) ──`);
    scored.slice(-3).forEach(s => {
      console.log(`    ${String(s.total).padStart(3)}점  ${s.company} / ${s.badge} / ${s.srcKind}  ← ${s.title}`);
    });
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
