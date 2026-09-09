/**
 * 2026-08-03 ~ 08-19 스파크랩·포트폴리오 기사 정리 (구글 닥스 붙여넣기용, 1회성)
 *
 * 화면(최근 수집 기사)은 "최신 상위 183건"으로 잘린 목록을 묶어서 12/141을 보여주므로,
 * 이 스크립트는 기간 내 전체를 DB에서 직접 읽는다.
 *
 * 중복 묶기를 story-dedupe(제목 bigram)로 하다가 LLM 판정으로 바꿨다 — 매체가 제목을
 * 아예 새로 쓰면(같은 8/18 박용진 발언 기사 5건이 인용 문구가 전부 달라서 서로 0.55까지
 * 떨어짐) 문자 유사도로는 못 잡는다. 임베딩 코사인도 확인했지만 같은 회사의 '다른 사건'
 * 기사끼리도 0.6~0.7이 나와 한 임계값으로 가를 수 없었다.
 */
import './_env';
import { prisma } from '../src/lib/prisma';
import * as fs from 'fs';
import OpenAI from 'openai';
import { isRelevant } from '../src/lib/sparkscope/relevance';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = 'gpt-4.1';
const audit: string[] = [];

const PRIORITY = ['매일경제', '조선일보', '아시아경제', '머니투데이', '플래텀', '벤처스퀘어', '한국경제'];

function rank(source: string): number {
  const i = PRIORITY.findIndex(p => source.includes(p) || p.includes(source));
  return i === -1 ? 99 : i;
}
/** 구글뉴스 리다이렉트 링크는 문서에 붙이면 흉하니 원문 링크가 있으면 그쪽을 고른다. */
function isRedirect(link: string): boolean {
  return link.includes('news.google.com');
}

interface Art {
  id: string; title: string; link: string; source: string; pubDate: Date; matchedKeyword: string;
}
interface Row { date: string; company: string; source: string; count: number; title: string; link: string }

/** 한 회사(=버킷) 안에서 같은 사건 기사끼리 묶는다. 반환: 기사 인덱스 그룹 배열. */
async function clusterByLLM(bucket: string, arts: Art[]): Promise<number[][]> {
  if (arts.length <= 1) return arts.map((_, i) => [i]);
  const list = arts
    .map((a, i) => `${i}\t${a.pubDate.toISOString().slice(0, 10)}\t${a.title}`)
    .join('\n');

  const system = [
    '너는 언론 모니터링 담당자다. 같은 사건·같은 보도자료를 다룬 기사끼리 묶는 일을 한다.',
    '',
    '규칙:',
    '- 같은 사건이면 제목 표현이 완전히 달라도(인용 문구가 서로 달라도) 같은 그룹이다.',
    '- 한 건의 보도자료를 매체마다 다른 각도로 뽑은 제목은 모두 같은 그룹이다. 예: 같은 날',
    '  "A사, B사와 손잡았다" / "A사, 물류 AX 개발 착수" / "A사, 40억 규모 AI 개발" 은 한 그룹.',
    '- 판단이 애매하면 같은 날 같은 회사 소식은 같은 그룹으로 본다.',
    '- 같은 회사라도 사건이 다르면(투자 유치 vs 신제품 출시 vs 규제 발언) 반드시 다른 그룹이다.',
    '- 같은 인물의 발언이라도 날짜와 자리가 다르면 다른 사건이다.',
    '- 여러 회사의 여러 소식을 한 번에 나열한 묶음 기사([AI서머리], [IT라운지], [스타트업 안테나] 등)는',
    '  다루는 범위가 다르므로 항상 자기 혼자만의 그룹으로 둔다.',
    '- 모든 번호가 정확히 한 번씩 나와야 한다. 빠뜨리거나 중복하면 안 된다.',
    '',
    '출력은 JSON만: {"groups": [[0,3,5],[1],[2,4]]}',
  ].join('\n');

  const resp = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `회사/키워드: ${bucket}\n\n번호\t발행일\t제목\n${list}` },
    ],
  });

  const raw = resp.choices[0]?.message?.content ?? '{}';
  let groups: number[][];
  try {
    groups = (JSON.parse(raw).groups ?? []).map((g: unknown[]) => g.map(Number).filter(n => Number.isInteger(n)));
  } catch {
    groups = [];
  }

  // 검증 — 누락·중복은 조용히 넘기지 않는다. 빠진 번호는 단독 그룹으로 살리고, 중복은 첫 등장만 인정.
  const seen = new Set<number>();
  const clean: number[][] = [];
  for (const g of groups) {
    const kept = g.filter(n => n >= 0 && n < arts.length && !seen.has(n));
    kept.forEach(n => seen.add(n));
    if (kept.length) clean.push(kept);
  }
  const missing = arts.map((_, i) => i).filter(i => !seen.has(i));
  if (missing.length) {
    console.warn(`  ⚠️ ${bucket}: LLM이 ${missing.length}건 누락 → 단독 처리`);
    missing.forEach(i => clean.push([i]));
  }
  return clean;
}

function pickRep(members: Art[]): Art {
  return [...members].sort(
    (a, b) => rank(a.source) - rank(b.source) || Number(isRedirect(a.link)) - Number(isRedirect(b.link)),
  )[0]!;
}

/**
 * 청산(Written-off)된 회사는 제외 — 남기는 건 Exit·Live뿐.
 * Article에는 회사 상태가 없어서 matchedKeyword로 MonitoringTarget을 되짚는다.
 * 되짚지 못한 키워드는 조용히 버리지 않고(=진짜 기사를 잃을 위험) 남긴 뒤 경고만 띄운다.
 */
async function loadKeepSet(): Promise<{ keep: Set<string>; drop: Set<string> }> {
  const targets = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company' },
    select: { name: true, primaryKeyword: true, portfolioStatus: true },
  });
  const keep = new Set<string>();
  const drop = new Set<string>();
  for (const t of targets) {
    const bucket = t.portfolioStatus === 'Written-off' ? drop : keep;
    for (const k of [t.name, t.primaryKeyword]) if (k) bucket.add(k);
  }
  // 같은 이름이 양쪽에 걸리면(중복 등록) 살리는 쪽을 택한다.
  for (const k of keep) drop.delete(k);
  return { keep, drop };
}

async function collect(category: string): Promise<{ raw: number; rows: Row[] }> {
  const gte = new Date('2026-08-03T00:00:00+09:00');
  const lt = new Date('2026-08-20T00:00:00+09:00');
  const all = await prisma.article.findMany({
    where: { pubDate: { gte, lt }, isNoise: false, category },
    orderBy: { pubDate: 'desc' },
    select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true },
  });

  let articles = all;
  if (category === 'portfolio_company') {
    const { keep, drop } = await loadKeepSet();
    const dropped = new Map<string, number>();
    const unknown = new Map<string, number>();
    articles = all.filter(a => {
      if (drop.has(a.matchedKeyword)) {
        dropped.set(a.matchedKeyword, (dropped.get(a.matchedKeyword) ?? 0) + 1);
        return false;
      }
      if (!keep.has(a.matchedKeyword)) unknown.set(a.matchedKeyword, (unknown.get(a.matchedKeyword) ?? 0) + 1);
      return true;
    });
    console.log(`  청산(Written-off) 제외: ${all.length - articles.length}건 / ${dropped.size}개사`);
    if (dropped.size) console.log(`    ${[...dropped.entries()].map(([k, v]) => `${k}(${v})`).join(', ')}`);
    if (unknown.size) console.log(`  ⚠️ 회사 목록에 없는 키워드(그대로 남김): ${[...unknown.keys()].join(', ')}`);

    // '타코' 오탐 제외 — 문맥어에 '비디오'가 있던 탓에 트럼프 TACO·꼬깔콘 팝업·푸드플라자
    // 같은 기사가 본문 매칭으로 통과해 있었다. 문맥어는 이미 고쳤지만(2026-08-19) 그건
    // 앞으로 수집되는 기사에만 적용되므로, 이미 쌓인 건은 고친 규칙으로 다시 걸러낸다.
    // 제목만으로 판정하는 건 본문에만 회사명이 나오는 진짜 기사를 떨어뜨릴 수 있어서
    // 이 한 회사에만 적용한다(오탐 5건 전부를 눈으로 확인함).
    const target = await prisma.monitoringTarget.findFirst({ where: { name: '타코' } });
    if (target) {
      const before = articles.length;
      articles = articles.filter(a => a.matchedKeyword !== '타코' || isRelevant({
        title: a.title, body: '', primaryKeyword: target.primaryKeyword, name: target.name,
        englishName: target.englishName, helperKeywords: target.helperKeywords,
        excludeWords: target.excludeWords, contextWords: target.contextWords,
        category: target.category, link: a.link, source: a.source,
      }));
      console.log(`  타코 오탐 제외: ${before - articles.length}건`);
    }
  }

  // 버킷 = 회사. 스파크랩 자체 기사는 키워드가 '스파크랩'/'김유진'/'김호민'/'스파크클로'로
  // 흩어져 있어서 한 버킷으로 합친다(전부 같은 회사 소식이므로).
  const buckets = new Map<string, Art[]>();
  for (const a of articles) {
    const key = category === 'sparklabs_self' ? '스파크랩' : a.matchedKeyword;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a as Art);
  }

  const rows: Row[] = [];
  for (const [bucket, arts] of buckets) {
    let groups = await clusterByLLM(bucket, arts);

    // 2차 통합 — 1차에서는 같은 보도자료도 제목이 강조하는 지점이 다르면 쪼개진다
    // (딥파인 8/3 한화시스템 건이 '한화·SM 손잡았다' / '물류 AX 개발 착수' / '방산·車 AI 개발'
    // 3그룹으로 남았다). 대표 기사만 모아서 한 번 더 물어보면 목록이 짧아져 판단이 쉬워진다.
    for (let pass = 0; pass < 2 && groups.length > 1; pass++) {
      const reps = groups.map(g => pickRep(g.map(i => arts[i]!)));
      const merged = await clusterByLLM(bucket, reps);
      if (merged.length === groups.length) break; // 더 합칠 게 없으면 중단
      groups = merged.map(m => m.flatMap(ri => groups[ri]!));
    }

    // 날짜가 끊기면 다시 쪼갠다 — LLM은 "스카이랩스 IPO"처럼 몇 주에 걸쳐 계속되는 이슈를
    // 한 사건으로 보고 8/9~8/18 열흘치 17건을 한 줄로 합쳐버렸다. 한 건의 보도자료를 여러
    // 매체가 받아쓰는 건 하루이틀 안에 끝나므로, 하루 이상 비면 다른 사건으로 본다.
    // (FDA 임상 건은 8/5~8/7이 연속이라 이 규칙에서도 21건 한 묶음으로 남는다.)
    const MAX_GAP_DAYS = 1;
    const split: number[][] = [];
    for (const g of groups) {
      const sorted = [...g].sort((a, b) => arts[a]!.pubDate.getTime() - arts[b]!.pubDate.getTime());
      let run: number[] = [];
      for (const i of sorted) {
        const prev = run.length ? arts[run[run.length - 1]!]!.pubDate : null;
        const gapDays = prev ? (arts[i]!.pubDate.getTime() - prev.getTime()) / 86400000 : 0;
        if (prev && gapDays > MAX_GAP_DAYS) { split.push(run); run = []; }
        run.push(i);
      }
      if (run.length) split.push(run);
    }

    for (const g of split) {
      const members = g.map(i => arts[i]!);
      const rep = pickRep(members);
      // 감사 로그 — 과다 병합(서로 다른 사건이 한 줄로 합쳐지는 것)을 눈으로 검증하려면
      // 대표뿐 아니라 묶인 멤버 전체가 보여야 한다.
      if (members.length > 1) {
        audit.push(`[${bucket}] ${members.length}건`);
        for (const m of members) audit.push(`   ${m.pubDate.toISOString().slice(0, 10)} ${m.source} | ${m.title}`);
      }
      rows.push({
        date: new Date(rep.pubDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10),
        company: bucket,
        source: rep.source,
        count: members.length,
        title: rep.title,
        link: rep.link,
      });
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return { raw: articles.length, rows };
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  console.log('포트폴리오 묶는 중...');
  const port = await collect('portfolio_company');
  console.log('스파크랩 묶는 중...');
  const slab = await collect('sparklabs_self');

  const md: string[] = ['# 2026년 8월 3일(월) ~ 8월 19일(수) 뉴스 정리', ''];
  const html: string[] = [];

  html.push(
    `<header><div class="eyebrow">SparkScope 클리핑</div>` +
      `<h1>2026년 8월 3일 ~ 8월 19일 보도</h1>` +
      `<div class="sub">포트폴리오 ${port.rows.length}건 · 스파크랩 ${slab.rows.length}건 (중복 보도 묶음 후) · ` +
      `같은 사건은 매일경제·조선일보·아시아경제·머니투데이·플래텀·벤처스퀘어·한국경제 순으로 대표 매체를 골랐습니다.</div></header>`,
  );

  for (const [label, data] of [['포트폴리오 뉴스', port], ['스파크랩 뉴스', slab]] as const) {
    md.push(`## ${label} (${data.rows.length}건 · 원본 ${data.raw}건)`, '');
    html.push(`<section><h2>${label}<span class="n">${data.rows.length}건 / 원본 ${data.raw}건</span></h2>`);
    const byCompany = new Map<string, Row[]>();
    for (const r of data.rows) {
      if (!byCompany.has(r.company)) byCompany.set(r.company, []);
      byCompany.get(r.company)!.push(r);
    }
    const companies = [...byCompany.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'));
    for (const [company, rows] of companies) {
      md.push(`**${company}**`);
      html.push(`<div class="co"><h3>${esc(company)}<span>${rows.length}</span></h3><ul>`);
      for (const r of rows) {
        const others = r.count > 1 ? ` 외 ${r.count - 1}곳` : '';
        md.push(`- [${r.title}](${r.link}) — ${r.source}${others} · ${r.date}`);
        html.push(
          `<li><span class="d">${r.date.slice(5)}</span><span><a href="${esc(r.link)}">${esc(r.title)}</a>` +
            `<span class="src">${esc(r.source)}${others}</span></span></li>`,
        );
      }
      md.push('');
      html.push('</ul></div>');
    }
    html.push('</section>');
  }

  fs.writeFileSync('scratch-news-0803-0819.md', md.join('\n'));
  fs.writeFileSync('scratch-news-audit.txt', audit.join('\n'));

  const STYLE = `<title>8월 상반기 보도 클리핑</title>
<style>
:root{
  --bg:#F6F8F7; --surface:#FFFFFF; --ink:#141F1E; --muted:#5B6A68;
  --accent:#0B6B5F; --rule:#DCE3E1; --chip:#EAEFED;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0F1413; --surface:#161D1C; --ink:#E9EEEC; --muted:#94A3A0;
    --accent:#5AC7B3; --rule:#26302E; --chip:#1E2726;
  }
}
:root[data-theme="dark"]{
  --bg:#0F1413; --surface:#161D1C; --ink:#E9EEEC; --muted:#94A3A0;
  --accent:#5AC7B3; --rule:#26302E; --chip:#1E2726;
}
body{
  background:var(--bg); color:var(--ink); margin:0;
  font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;
  line-height:1.55; font-size:16px;
}
.wrap{max-width:820px; margin:0 auto; padding:56px 24px 96px; display:flex; flex-direction:column; gap:40px;}
header{display:flex; flex-direction:column; gap:10px; border-bottom:1px solid var(--rule); padding-bottom:24px;}
.eyebrow{font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); font-weight:600;}
h1{font-family:Georgia,"Times New Roman",serif; font-weight:600; font-size:34px; line-height:1.2; margin:0; text-wrap:balance;}
.sub{color:var(--muted); font-size:14px;}
h2{font-family:Georgia,serif; font-size:24px; margin:0 0 4px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;}
h2 .n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; color:var(--muted); font-variant-numeric:tabular-nums;}
section{display:flex; flex-direction:column; gap:22px;}
.co{background:var(--surface); border:1px solid var(--rule); border-radius:6px; padding:16px 18px; display:flex; flex-direction:column; gap:10px;}
.co h3{margin:0; font-size:15px; font-weight:700; display:flex; align-items:baseline; gap:8px;}
.co h3 span{font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--muted); background:var(--chip); border-radius:3px; padding:1px 6px;}
ul{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px;}
li{display:grid; grid-template-columns:52px 1fr; gap:12px; align-items:baseline;}
li .d{font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;}
a{color:var(--ink); text-decoration:none; border-bottom:1px solid var(--rule);}
a:hover,a:focus-visible{color:var(--accent); border-bottom-color:var(--accent);}
.src{color:var(--muted); font-size:12px; margin-left:6px; white-space:nowrap;}
@media (max-width:520px){ li{grid-template-columns:1fr; gap:2px;} h1{font-size:27px;} }
</style>`;
  fs.writeFileSync('scratch-news-0803-0819.html', `${STYLE}\n<div class="wrap">${html.join('\n')}</div>`);

  console.log(`\n포트폴리오 ${port.rows.length}건(원본 ${port.raw}) / 스파크랩 ${slab.rows.length}건(원본 ${slab.raw})`);
  await prisma.$disconnect();
}
main();
