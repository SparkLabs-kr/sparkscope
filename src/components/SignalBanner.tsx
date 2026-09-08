'use client';
/**
 * 오늘의 시그널 — Inter 탭 맨 위 배너. 뉴스와 커뮤니티를 한 덩어리로 보여준다.
 *
 * 전에는 '지금 주목받는 뉴스'와 '소셜 시그널'이 각각 카드였고, 둘 다 같은 무게로
 * 나열돼 있어서 "그래서 오늘 뭘 봐야 하나"에 답하지 못했다. 지금 구조(B안, 2026-09-08)는
 * 우선순위를 화면에 새긴다:
 *
 *   1) 히어로  — 가장 중요한 뉴스 한 건. 크게, 요약과 포트폴리오 영향까지 펼쳐서.
 *   2) 레일    — 커뮤니티별 미니 랭킹. 매체마다 무엇에 특화됐는지 한 줄로 밝힌다.
 *   3) 스트립  — 그 외 뉴스. 접힌 상태로 훑고, 누르면 그 자리에서 펼쳐진다.
 *   4) 나머지 시그널 — 레일에 못 들어간 소스들. 기본은 접혀 있다.
 *
 * 두 API를 각각 부른다(digest·social). 갱신 주기가 완전히 달라서 —
 * 뉴스는 30분, 커뮤니티는 소스별 2~24시간 — 한 엔드포인트로 묶으면 느린 쪽에 끌려간다.
 */
import { useEffect, useMemo, useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import type { DigestItem } from '@/lib/sparkscope/news-digest';
import type { SocialSource, SocialPost, SocialSourceId } from '@/lib/sparkscope/social-collect';

type DigestResp = {
  items: DigestItem[];
  feeds: { name: string; ok: boolean; count: number }[];
};

const RANGES = [
  { days: 1, label: '오늘' },
  { days: 7, label: '이번 주' },
  { days: 30, label: '이번 달' },
] as const;

/** 커뮤니티 카드 하나에 보여줄 글 수. */
const RAIL_POSTS = 3;
/** 히어로를 뺀 나머지 뉴스 중 스트립에 깔 개수. */
const STRIP = 6;

/** 소스별 색. 배지 하나로 "어디서 온 신호인지"가 구분되게 한다. */
const SRC_STYLE: Record<string, string> = {
  hf: 'text-emerald-700 border-emerald-300 bg-emerald-50',
  hf_new: 'text-emerald-700 border-emerald-300 bg-emerald-50',
  hn: 'text-orange-700 border-orange-300 bg-orange-50',
  reddit: 'text-rose-700 border-rose-300 bg-rose-50',
  lobsters: 'text-red-800 border-red-300 bg-red-50',
  arxiv: 'text-slate-700 border-slate-300 bg-slate-100',
  biorxiv: 'text-cyan-800 border-cyan-300 bg-cyan-50',
  pubmed: 'text-indigo-700 border-indigo-300 bg-indigo-50',
  trials: 'text-violet-700 border-violet-300 bg-violet-50',
};

/**
 * 같은 매체의 여러 정렬을 한 카드로 묶는다.
 * HF '인기 모델'과 '새 모델'은 같은 Hugging Face인데 카드가 둘로 갈려 있어서
 * 별개 매체처럼 보였다(2026-09-08 사용자 피드백).
 */
/**
 * 히어로 후보 — 업보트라는 같은 단위로 비교되는 토론 커뮤니티만.
 * 모델 저장소(HF)나 논문 색인(arXiv·PubMed)은 "화제글"이 아니고 점수 단위도 달라서 뺀다.
 */
const HERO_SOURCES: SocialSourceId[] = ['hn', 'reddit', 'lobsters'];

const MERGE_GROUPS: { key: string; label: string; ids: SocialSourceId[] }[] = [
  { key: 'hf-group', label: 'Hugging Face', ids: ['hf', 'hf_new'] },
];

type SocialCard =
  | { kind: 'single'; key: string; source: SocialSource }
  | { kind: 'merged'; key: string; label: string; why: string;
      variants: { source: SocialSource; tab: '인기순' | '최신순' }[] };

export function SignalBanner({ domain }: { domain: 'bio' | 'ai' }) {
  const t = useT();
  const locale = useLocale();
  const [days, setDays] = useState<number>(7);
  const [digest, setDigest] = useState<DigestResp | null>(null);
  const [social, setSocial] = useState<SocialSource[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDigest(null);
    fetch(`/api/inter/digest?domain=${domain}&days=${days}`)
      .then(r => r.json())
      .then(d => { if (alive) setDigest({ items: d.items ?? [], feeds: d.feeds ?? [] }); })
      .catch(() => { if (alive) setDigest({ items: [], feeds: [] }); });
    return () => { alive = false; };
  }, [domain, days]);

  // 커뮤니티는 기간 버튼과 무관하게 각 소스의 갱신 주기를 따른다 —
  // 여기서 days를 넘기면 캐시가 기간마다 쪼개져 같은 데이터를 세 번 받아 온다.
  useEffect(() => {
    let alive = true;
    setSocial(null);
    fetch(`/api/inter/social?domain=${domain}&lang=${locale}`)
      .then(r => r.json())
      .then(d => { if (alive) setSocial(d.sources ?? []); })
      .catch(() => { if (alive) setSocial([]); });
    return () => { alive = false; };
  }, [domain, locale]);

  const items = digest?.items ?? [];
  const hero = items[0];
  const strip = items.slice(1, 1 + STRIP);
  const live = (digest?.feeds ?? []).filter(f => f.ok && f.count > 0);

  // 소셜 히어로 — 커뮤니티 토론글 중 가장 화제인 글 하나.
  //
  // 후보를 HERO_SOURCES로 좁히는 게 중요하다. 소스마다 점수 단위가 달라서
  // (HF 좋아요 14,286 vs HN 업보트 2,288 vs 모델 다운로드 26,731) 전부 섞어 최댓값을
  // 고르면 항상 HF 모델이 1등이 된다 — 순위가 아니라 단위 차이를 보고 있는 셈이다.
  // 업보트라는 같은 단위를 쓰는 토론 커뮤니티끼리만 비교한다.
  const socialHero = useMemo(() => {
    let best: { source: SocialSource; post: SocialPost } | null = null;
    for (const s of social ?? []) {
      if (!HERO_SOURCES.includes(s.id)) continue;
      for (const p of s.posts) {
        if (!p.points) continue;
        if (!best || p.points > (best.post.points ?? 0)) best = { source: s, post: p };
      }
    }
    return best;
  }, [social]);

  // 같은 매체의 두 정렬(HF 인기 모델·새 모델)은 한 카드로 합친다 — 별개 매체처럼 나란히
  // 놓이면 같은 곳인 줄 모른다(2026-09-08 사용자 피드백).
  const socialCards = useMemo<SocialCard[]>(() => {
    const list = social ?? [];
    const out: SocialCard[] = [];
    const used = new Set<string>();
    for (const s of list) {
      if (used.has(s.id)) continue;
      const group = MERGE_GROUPS.find(g => g.ids.includes(s.id));
      if (group) {
        const members = group.ids
          .map(id => list.find(x => x.id === id))
          .filter((x): x is SocialSource => !!x && x.posts.length > 0);
        if (members.length > 1) {
          members.forEach(m => used.add(m.id));
          out.push({
            kind: 'merged', key: group.key, label: group.label, why: members[0].why,
            variants: members.map(m => ({ source: m, tab: m.ranked ? '인기순' : '최신순' })),
          });
          continue;
        }
      }
      used.add(s.id);
      out.push({ kind: 'single', key: s.id, source: s });
    }
    return out;
  }, [social]);

  return (
    <>
    <div className="bg-white border border-spark-border rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
        <h2 className="text-[19px] font-extrabold tracking-tight">📡 {t('오늘의 시그널')}</h2>
        <span className="text-[13px] text-spark-muted">
          {t('여러 매체가 함께 다룬 뉴스를 봅니다.')}
        </span>
        <div className="ml-auto flex items-center gap-1 rounded-xl bg-spark-cream p-1">
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={`rounded-lg px-3 py-1 text-[12px] font-bold transition-colors ${
                days === r.days ? 'bg-spark-purple text-white' : 'text-spark-muted hover:text-spark-ink-soft'
              }`}
            >
              {t(r.label)}
            </button>
          ))}
        </div>
      </div>

      {/* ── 1) 히어로 ──
          예전엔 오른쪽에 커뮤니티 레일을 세로로 세웠는데, 레일이 히어로보다 훨씬 길어서
          오른쪽만 아래로 튀어나왔다(2026-09-08). 커뮤니티는 아래 전체 폭으로 내렸다. */}
      <div className="mt-4">
        {digest === null ? (
          <div className="h-64 rounded-xl bg-spark-subtle animate-pulse" />
        ) : !hero ? (
          <div className="rounded-xl border border-spark-border bg-spark-subtle p-8 text-center text-[13px] text-spark-muted">
            {t('이 기간에 표시할 기사가 없습니다.')}
          </div>
        ) : (
          <Hero item={hero} locale={locale} />
        )}
      </div>

      {/* ── 3) 스트립 ── */}
      {strip.length > 0 && (
        <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 mt-4">
          {strip.map(it => (
            <StripCard
              key={it.url}
              item={it}
              locale={locale}
              open={open === it.url}
              onToggle={() => setOpen(open === it.url ? null : it.url)}
            />
          ))}
        </ol>
      )}

      {digest && (
        <p className="mt-3 text-[11.5px] text-spark-muted">{t('매체 {n}곳에서 수집', { n: live.length })}</p>
      )}
      </div>

      {/* ═══ 소셜 시그널 — 별도 카드 ═══
          전에는 뉴스와 같은 카드 안에 있어서 한 덩어리로 읽혔고, 그래서 어지러웠다
          (2026-09-08 사용자 피드백). 카드를 나누고 제목도 '오늘의 시그널'과 같은 크기로
          올려 둘이 대등한 섹션임을 분명히 한다. */}
      <div className="bg-white border border-spark-border rounded-2xl p-5 mt-4">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
          <h2 className="text-[19px] font-extrabold tracking-tight">🔥 {t('소셜 시그널')}</h2>
          <span className="text-[13px] text-spark-muted">
            {t('이 분야 종사자들이 지금 이야기하는 글 — 기사보다 며칠 먼저 움직입니다.')}
          </span>
        </div>

        {social === null ? (
          <div className="mt-4 h-24 rounded-xl bg-spark-subtle animate-pulse" />
        ) : social.length === 0 ? (
          <p className="mt-4 text-[12.5px] text-spark-muted">{t('표시할 커뮤니티 시그널이 없습니다.')}</p>
        ) : (
          <>
            {/* 가장 화제인 글 하나를 뉴스 히어로처럼 위에 세운다 — 뉴스 쪽과 읽는 방식을 맞춘다. */}
            {socialHero && <SocialHero pick={socialHero} locale={locale} />}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 mt-3 items-start">
              {socialCards.map(c =>
                c.kind === 'merged'
                  ? <MergedCard key={c.key} label={c.label} why={c.why} variants={c.variants} locale={locale} />
                  : <RailCard key={c.key} source={c.source} locale={locale} limit={RAIL_POSTS} />)}
            </div>
            <p className="mt-3 text-[11.5px] text-spark-muted">{t('커뮤니티 {n}곳', { n: social.length })}</p>
          </>
        )}
      </div>
    </>
  );
}

/** 가장 중요한 한 건. 요약 첫 문단까지 펼쳐 두고, 포트폴리오 영향은 이유까지 보여준다. */
function Hero({ item, locale }: { item: DigestItem; locale: string }) {
  const t = useT();
  const title = locale === 'ko' && item.summary?.titleKo ? item.summary.titleKo : item.title;
  const body = item.summary
    ? (locale === 'en' ? item.summary.enLong?.[0] ?? item.summary.en : item.summary.koLong?.[0] ?? item.summary.ko)
    : null;

  return (
    <article className="rounded-xl border border-spark-border bg-spark-subtle p-5">
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md border border-spark-border bg-white text-spark-ink-soft">
          {item.source}
        </span>
        {item.independent && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-spark-border text-spark-muted">
            {t('개인·뉴스레터')}
          </span>
        )}
        {/* 여러 매체가 동시에 다뤘다는 것 자체가 이 기사를 1위로 만든 근거다. */}
        {item.alsoIn.length > 0 && (
          <span className="text-[11.5px] font-bold text-rose-600">
            🔥 {t('{n}개 매체가 함께 보도', { n: item.alsoIn.length + 1 })}
          </span>
        )}
        <span className="ml-auto text-[11.5px] text-spark-muted tabular-nums">{item.publishedAt}</span>
      </div>

      <h3 className="text-[21px] font-extrabold leading-[1.28] tracking-tight text-balance">{title}</h3>

      {body ? (
        <p className="mt-2.5 text-[13.5px] leading-[1.72] text-spark-ink-soft">{body}</p>
      ) : (
        <p className="mt-2.5 text-[12.5px] text-spark-muted">{t('요약 준비 중 — 다음 조회에서 채워집니다.')}</p>
      )}

      {item.portfolio && item.portfolio.length > 0 && (
        <div className="mt-3 pt-3 border-t border-spark-border space-y-1.5">
          {item.portfolio.slice(0, 3).map(h => (
            <div key={h.company} className="flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 text-[11.5px]">
              <span className="shrink-0 font-bold rounded bg-spark-light-purple text-spark-purple px-1.5 py-0.5">
                {h.company}
              </span>
              <span className="text-spark-ink-soft leading-relaxed">{h.reason}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        <a href={item.url} target="_blank" rel="noopener noreferrer"
           className="font-semibold text-spark-purple hover:underline">
          {t('원문 보기')} ↗
        </a>
        {item.alsoIn.slice(0, 4).map(a => (
          <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"
             className="text-spark-muted hover:text-spark-purple hover:underline">
            {a.source} ↗
          </a>
        ))}
      </div>
    </article>
  );
}

/** 커뮤니티 미니 랭킹. 매체가 무엇에 특화됐는지(why)를 제목 바로 아래 한 줄로 둔다. */
/** 소셜 쪽 히어로 — 뉴스 히어로와 같은 자리·같은 무게로, 지금 가장 화제인 글 하나. */
function SocialHero({ pick, locale }: { pick: { source: SocialSource; post: SocialPost }; locale: string }) {
  const t = useT();
  const { source, post } = pick;
  const style = SRC_STYLE[source.id] ?? 'text-spark-ink-soft border-spark-border bg-white';
  const title = locale === 'ko' ? (post.titleKo || post.title) : post.title;
  return (
    <a
      href={post.url} target="_blank" rel="noopener noreferrer"
      className="mt-4 block rounded-xl border border-spark-border bg-spark-subtle px-4 py-3.5 transition-colors hover:border-spark-purple/40 hover:bg-white"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${style}`}>{source.label}</span>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-700">
          🔥 {t('가장 화제')}
        </span>
        {post.origin && <span className="text-[10.5px] text-spark-muted">{post.origin}</span>}
        <span className="ml-auto text-[10.5px] text-spark-muted">{post.date}</span>
      </div>
      <h3 className="mt-1.5 text-[16px] font-extrabold leading-snug text-spark-ink">{title}</h3>
      <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-spark-muted">
        {post.points != null && (
          <span className="font-bold text-rose-600 tabular-nums">
            ▲ {post.points.toLocaleString()} {post.pointsLabel ? t(post.pointsLabel) : ''}
          </span>
        )}
        {post.comments != null && <span className="tabular-nums">💬 {post.comments.toLocaleString()}</span>}
        {post.author && <span>{post.author}</span>}
      </div>
    </a>
  );
}

/**
 * 같은 매체의 두 정렬을 한 카드에서 전환해 본다.
 * 두 목록을 위아래로 쌓으면 카드가 다른 칸의 두 배가 되므로, 안에서 탭으로 바꾼다 —
 * "같은 매체인데 정렬만 다르다"는 게 형태로 드러난다.
 */
function MergedCard({ label, why, variants, locale }: {
  label: string; why: string;
  variants: { source: SocialSource; tab: '인기순' | '최신순' }[];
  locale: string;
}) {
  const t = useT();
  const [tab, setTab] = useState(0);
  const cur = variants[tab] ?? variants[0];
  const style = SRC_STYLE[cur.source.id] ?? 'text-spark-ink-soft border-spark-border bg-white';

  return (
    <section className="rounded-xl border border-spark-border bg-white overflow-hidden">
      <div className="px-3.5 pt-3 pb-2.5 bg-spark-subtle border-b border-spark-border">
        <div className="flex items-center gap-2">
          <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded border ${style}`}>{label}</span>
          {/* 정렬 전환 — 배지가 아니라 누를 수 있는 세그먼트라는 게 보이게 한다. */}
          <div className="ml-auto flex gap-0.5 rounded-md bg-white p-0.5 border border-spark-border">
            {variants.map((v, i) => (
              <button
                key={v.tab} type="button" onClick={() => setTab(i)} aria-pressed={i === tab}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                  i === tab ? 'bg-spark-ink text-white' : 'text-spark-muted hover:text-spark-ink-soft'
                }`}
              >
                {t(v.tab)}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-spark-muted">{t(why)}</p>
      </div>
      <ol>
        {cur.source.posts.slice(0, RAIL_POSTS).map((p, i) => (
          <li key={p.url}><PostRow post={p} rank={i + 1} locale={locale} /></li>
        ))}
      </ol>
    </section>
  );
}

function RailCard({ source, locale, limit }: { source: SocialSource; locale: string; limit: number }) {
  const t = useT();
  const style = SRC_STYLE[source.id] ?? 'text-spark-ink-soft border-spark-border bg-white';

  return (
    <section className="rounded-xl border border-spark-border bg-white overflow-hidden">
      <div className="px-3.5 pt-3 pb-2.5 bg-spark-subtle border-b border-spark-border">
        <div className="flex items-center gap-2">
          <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded border ${style}`}>{source.label}</span>
          <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border ${
            !source.connected ? 'bg-amber-50 text-amber-700 border-amber-200'
            : source.ranked ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {source.connected ? (source.ranked ? t('인기순') : t('최신순')) : t('연결 필요')}
          </span>
        </div>
        {/* 매체 특징 한 줄 — "왜 이 매체냐"에 화면이 스스로 답한다. */}
        <p className="mt-1.5 text-[11px] leading-relaxed text-spark-muted">{t(source.why)}</p>
      </div>

      {source.posts.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-[12px] text-spark-muted">
          {source.connected ? t('해당 기간 글이 없습니다.') : t('연결되면 여기에 표시됩니다.')}
        </p>
      ) : (
        <ol>
          {source.posts.slice(0, limit).map((p, i) => (
            <li key={p.url}>
              <PostRow post={p} rank={i + 1} locale={locale} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PostRow({ post, rank, locale }: { post: SocialPost; rank: number; locale: string }) {
  return (
    <a href={post.url} target="_blank" rel="noopener noreferrer"
       className="flex gap-2 px-3.5 py-2 border-b border-spark-border last:border-b-0 hover:bg-spark-subtle">
      <span className="text-[11px] font-extrabold text-spark-muted tabular-nums pt-0.5 shrink-0">{rank}</span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold leading-snug line-clamp-2">
          {locale === 'ko' && post.titleKo ? post.titleKo : post.title}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10.5px] text-spark-muted">
          {/* 만든 곳 — AI 모델은 누가 냈는지가 제목만큼 중요하다. */}
          {post.author && <span className="font-semibold text-spark-ink-soft">{post.author}</span>}
          {post.origin && <span>{post.origin}</span>}
          {typeof post.points === 'number' && (
            <span className="tabular-nums">
              ▲ <b className="text-orange-600">{post.points.toLocaleString()}</b>
              {post.pointsLabel ? ` ${post.pointsLabel}` : ''}
            </span>
          )}
          {typeof post.comments === 'number' && post.comments > 0 && (
            <span className="tabular-nums">💬 {post.comments}</span>
          )}
          {post.date && <span className="tabular-nums">{post.date}</span>}
        </div>
      </div>
    </a>
  );
}

/** 히어로 아래 스트립. 접혀 있다가 누르면 그 자리에서 줄 전체를 차지하며 펼쳐진다. */
function StripCard({ item, locale, open, onToggle }: {
  item: DigestItem; locale: string; open: boolean; onToggle: () => void;
}) {
  const t = useT();
  const title = locale === 'ko' && item.summary?.titleKo ? item.summary.titleKo : item.title;

  return (
    <li className={`rounded-xl border bg-white px-3.5 py-3 transition-colors ${
      open ? 'sm:col-span-2 xl:col-span-3 border-spark-purple/40 bg-spark-subtle/40' : 'border-spark-border hover:border-spark-purple/30'
    }`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-spark-muted mb-1">
        <span className="font-semibold text-spark-ink-soft">{item.source}</span>
        {item.independent && (
          <span className="text-[10px] px-1 py-0.5 rounded border border-spark-border">{t('개인·뉴스레터')}</span>
        )}
        <span className="tabular-nums">{item.publishedAt}</span>
        {item.alsoIn.length > 0 && (
          <span className="font-semibold text-emerald-700">{t('+{n}개 매체', { n: item.alsoIn.length })}</span>
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full text-left text-[14px] font-semibold leading-snug hover:text-spark-purple"
      >
        {title}
        <span className="ml-1 text-[10px] text-spark-muted font-normal">{open ? '▲' : '▼'}</span>
      </button>

      {!item.summary ? (
        <p className="mt-1.5 text-[11.5px] text-spark-muted">{t('요약 준비 중 — 다음 조회에서 채워집니다.')}</p>
      ) : open ? (
        <div className="mt-2.5 rounded-xl bg-white border border-spark-border p-4">
          <div className="space-y-2.5">
            {(locale === 'en' ? item.summary.enLong : item.summary.koLong).map((para, k) => (
              <p key={k} className="text-[13px] leading-[1.78] text-spark-ink">{para}</p>
            ))}
          </div>
          {item.portfolio && item.portfolio.length > 0 && (
            <div className="mt-3 pt-3 border-t border-spark-border space-y-1.5">
              {item.portfolio.map(h => (
                <div key={h.company} className="text-[11.5px] leading-relaxed">
                  <span className="inline-block rounded bg-spark-light-purple text-spark-purple font-bold px-1.5 py-0.5 mr-1.5">
                    {h.company}
                  </span>
                  <span className="text-spark-ink-soft">{h.reason}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10.5px] text-spark-muted">
            {t('원문이 아니라 이해를 돕는 설명입니다. 전문은 원문에서 확인하세요.')}
            {item.grounding === 'headline' && ` · ${t('이 매체는 제목과 짧은 소개만 공개해, 아래 설명은 일반적인 배경 위주입니다.')}`}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[11.5px] leading-relaxed text-spark-ink-soft line-clamp-2">
          {locale === 'en' ? item.summary.en : item.summary.ko}
        </p>
      )}

      <a href={item.url} target="_blank" rel="noopener noreferrer"
         className="inline-block mt-2 text-[11px] font-semibold text-spark-purple hover:underline">
        {t('원문 보기')} ↗
      </a>
    </li>
  );
}
