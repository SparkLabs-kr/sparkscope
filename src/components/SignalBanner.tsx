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
import type { TrendKeyword } from '@/lib/sparkscope/news-keywords';
import type { EntityCard } from '@/lib/sparkscope/entity-cards';
import { DISPLAY_COUNT } from '@/lib/sparkscope/signal-display';

type DigestResp = {
  items: DigestItem[];
  feeds: { name: string; ok: boolean; count: number }[];
  keywords: TrendKeyword[];
  entities: EntityCard[];
};

const RANGES = [
  { days: 1, label: '오늘' },
  { days: 7, label: '이번 주' },
  { days: 30, label: '이번 달' },
] as const;

/** 커뮤니티 카드 하나에 보여줄 글 수. */
const RAIL_POSTS = 3;
/**
 * 히어로를 뺀 나머지 뉴스 중 스트립에 깔 개수.
 *
 * 총 표시 수는 signal-display.ts의 DISPLAY_COUNT 한 곳에서 정한다 — 이름 카드도
 * 같은 값을 보고 만들어지므로, 여기서만 바꾸면 카드에는 떠 있는데 목록에는 없는
 * 기사가 생긴다(그 주석 참고).
 */
const STRIP = DISPLAY_COUNT - 1;

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
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDigest(null);
    fetch(`/api/inter/digest?domain=${domain}&days=${days}`)
      .then(r => r.json())
      .then(d => { if (alive) setDigest({ items: d.items ?? [], feeds: d.feeds ?? [], keywords: d.keywords ?? [], entities: d.entities ?? [] }); })
      .catch(() => { if (alive) setDigest({ items: [], feeds: [], keywords: [], entities: [] }); });
    return () => { alive = false; };
  }, [domain, days]);

  // 커뮤니티는 기간 버튼과 무관하게 각 소스의 갱신 주기를 따른다 —
  // 여기서 days를 넘기면 캐시가 기간마다 쪼개져 같은 데이터를 세 번 받아 온다.
  useEffect(() => {
    let alive = true;
    return () => { alive = false; };
  }, [domain, locale]);

  const items = digest?.items ?? [];
  const hero = items[0];
  const strip = items.slice(1, 1 + STRIP);
  const live = (digest?.feeds ?? []).filter(f => f.ok && f.count > 0);


  return (
    /* 넓은 화면에서는 뉴스(왼쪽)와 이름 카드(오른쪽)를 나란히 둔다(2026-09-09).
       위아래로 쌓았을 때 이름 카드가 3열로 퍼지면서 카드마다 높이가 달라 아래쪽에
       빈 자리가 크게 남았다. 오른쪽 한 줄로 세우면 그 빈 자리가 사라지고,
       뉴스를 읽다가 바로 옆에서 반응을 확인할 수 있다.
       좁은 화면에서는 그대로 위아래로 쌓인다. */
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_384px] gap-4 items-start">
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

      {/* 키워드 칩 줄은 없앴다(2026-09-09) — 오른쪽 '지금 핫한 키워드' 열이 같은 것을
          기사·반응까지 붙여서 보여주므로, 칩만 있는 줄은 같은 정보를 두 번 말하는 셈이었다. */}

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

      {/* ═══ 지금 화제인 이름 ═══
          '소셜 시그널' 패널을 없애고 그 자리에 넣었다(2026-09-09).

          왜 합쳤나: 두 패널이 결국 같은 일을 하고 있었다 — 무엇이 중요한가를 말하는
          것. 다만 각도가 달라서, 뉴스는 "매체가 다뤘다"이고 커뮤니티는 "사람들이
          실제로 반응했다"이다. 뒤쪽이 영향력의 더 단단한 증거인데, 따로 놓여 있으니
          어느 기사에 대한 반응인지 알 수 없었다.

          잇는 열쇠는 URL이 아니라 이름이다. 실측(2026-09-09)으로 뉴스와 커뮤니티가
          기사 단위로 겹친 건 상위 40건 중 0건이었다 — Hacker News가 로이터 기사를
          그대로 올리지 않기 때문이다. 반면 이름 단위로는 겹친다(AI 상위 8개 중 4개).
          그래서 카드 하나가 기사가 아니라 이름이다(entity-cards.ts).

          기사가 없는 카드를 남겨 두는 것이 이 자리의 핵심이다 — 커뮤니티가 매체보다
          먼저 아는 주제(CRISPR 암세포 선택 파괴, 1,002업보트)가 거기서 나온다. */}
      <div className="bg-white border border-spark-border rounded-2xl p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-extrabold tracking-tight">🔥 {t('지금 핫한 키워드')}</h2>
          <span className="text-[12.5px] leading-snug text-spark-muted">
            {t('여러 매체가 함께 말한 이름과, 커뮤니티에서 실제로 다뤄진 정도.')}
          </span>
        </div>

        {digest === null ? (
          <div className="mt-4 h-40 rounded-xl bg-spark-subtle animate-pulse" />
        ) : (digest.entities ?? []).length === 0 ? (
          <p className="mt-4 text-[12.5px] text-spark-muted">{t('아직 여러 곳에서 함께 언급된 이름이 없습니다.')}</p>
        ) : (
          /* 좁은 열이라 한 줄로 세운다. 좁은 화면에서는 아래로 내려가므로 2열까지 허용해
             가로로 늘어지는 것을 막는다. */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-2 mt-3.5 items-start">
            {digest.entities.map(c => <EntityCardView key={c.key} card={c} locale={locale} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 이름 카드 — 한 이름에 달린 기사와 커뮤니티 글.
 *
 * 커뮤니티 쪽 이름표가 두 가지인 이유: AI는 Hacker News·Reddit이라 "반응"이 맞지만,
 * 바이오는 bioRxiv·PubMed·임상등록이라 반응이 아니라 1차 자료다. 실제로 바이오 상위
 * 6건 중 반응이 붙은 건 0건이었다 — 논문 제목에 회사명이 나올 일이 거의 없다.
 */
function EntityCardView({ card, locale }: { card: EntityCard; locale: string }) {
  const t = useT();
  // 기본은 접힌 상태다(2026-09-09). 여섯 카드를 다 펼치면 오른쪽 열이 뉴스보다 세 배
  // 길어져서 왼쪽 아래가 빈칸으로 남았다. 이름과 숫자만 보이면 "지금 무엇이 화제인가"는
  // 그대로 읽히고, 근거가 궁금할 때만 펼치면 된다.
  const [open, setOpen] = useState(false);
  const communityLabel = card.communityKind === 'reaction' ? t('커뮤니티 반응') : t('새로 등록된 연구·임상');
  const topPoints = card.community[0]?.points ?? 0;

  return (
    <article className="rounded-xl border border-spark-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left bg-spark-subtle hover:bg-spark-light-purple/40 transition-colors"
      >
        <span className="text-[15px] font-extrabold tracking-tight">{card.label}</span>
        {/* 접힌 상태에서도 근거의 크기는 보여준다 — 숫자가 없으면 왜 이 이름이
            여기 있는지 알 수 없다. */}
        <span className="flex items-center gap-1.5 text-[10.5px] font-bold tabular-nums">
          {card.outlets > 0 && (
            <span className="rounded-md bg-white border border-spark-border px-1.5 py-0.5 text-spark-ink-soft">
              {t('매체 {n}', { n: card.outlets })}
            </span>
          )}
          {topPoints > 0 && (
            <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-rose-600">
              {topPoints.toLocaleString()}▲
            </span>
          )}
        </span>
        <span className={`ml-auto shrink-0 text-spark-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="px-3.5 py-3 flex flex-col gap-2.5 border-t border-spark-border">
          {card.articles.length > 0 ? (
            <>
              <span className="text-[10.5px] font-extrabold tracking-wider uppercase text-spark-muted">{t('기사')}</span>
              {card.articles.map(a => (
                <div key={a.url} className="flex flex-col gap-1">
                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                     className="flex gap-2 text-[12.5px] leading-snug text-spark-ink-soft hover:text-spark-purple">
                    <span className="shrink-0 w-[68px] text-[10.5px] font-bold text-spark-muted truncate">{a.source}</span>
                    <span className="line-clamp-2">{a.title}</span>
                  </a>
                  {/* 함께 보도한 매체를 여기서 밝힌다 — 헤더의 "매체 N곳"에 세어져 있으면서
                      목록에는 안 보이던 곳들이다. */}
                  {a.alsoIn?.length > 0 && (
                    <div className="ml-[76px] flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px]">
                      {/* 회색으로 두었더니 링크로 보이지 않아 "매체 5곳인데 한 곳뿐"으로
                          읽혔다(2026-09-09 피드백). 보라색 + 밑줄로 링크임을 분명히 한다. */}
                      {a.alsoIn.map(x => (
                        <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer"
                           className="font-semibold text-spark-purple/85 underline decoration-spark-purple/30 underline-offset-2 hover:decoration-spark-purple">
                          {t('{s} 원문 보기', { s: x.source })} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            // 기사가 없는 카드 — 커뮤니티가 매체보다 먼저 아는 주제다. 그 사실을 그대로 말한다.
            <p className="text-[11.5px] text-spark-muted">{t('아직 우리 매체 목록에서는 다뤄지지 않았습니다.')}</p>
          )}

          {card.community.length > 0 && (
            <div className="border-t border-dashed border-spark-border-strong pt-2.5 flex flex-col gap-2">
              <span className={`text-[10.5px] font-extrabold tracking-wider uppercase ${
                card.communityKind === 'reaction' ? 'text-rose-600' : 'text-spark-muted'}`}>
                {communityLabel}
              </span>
              {card.community.map(r => (
                <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer"
                   className="flex gap-2 items-baseline text-[12.5px] leading-snug text-spark-ink-soft hover:text-spark-purple">
                  {r.points > 0 ? (
                    <span className="shrink-0 min-w-[54px] text-center rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-600 tabular-nums">
                      {r.points.toLocaleString()}▲
                    </span>
                  ) : (
                    <span className="shrink-0 min-w-[54px] text-center text-[10.5px] font-bold text-spark-muted">{r.source}</span>
                  )}
                  <span className="line-clamp-2">{locale === 'ko' && r.titleKo ? r.titleKo : r.title}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
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
    /* 히어로에 색을 준다(2026-09-09 피드백). 예전에는 스트립 카드와 배경만 살짝
       달라서, 그날 제일 중요한 기사가 나머지 여섯 칸과 비슷한 무게로 읽혔다.
       왼쪽 보랏빛 굵은 띠 + 연한 보라 배경으로 "여기가 1위"를 형태로 말한다.
       색은 한 곳에만 쓴다 — 카드마다 색을 주면 강조가 사라진다. */
    <article className="rounded-xl border border-spark-purple/25 border-l-4 border-l-spark-purple bg-gradient-to-br from-spark-light-purple/55 via-white to-white p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md border border-spark-purple/30 bg-white text-spark-purple">
          {item.source}
        </span>
        {item.independent && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-spark-border text-spark-muted">
            {t('개인·뉴스레터')}
          </span>
        )}
        {/* 경쟁 매체 여럿이 같은 사안을 1면에 걸었다 — 함께 보도한 것보다 강한 근거라
            먼저 보여준다(news-digest.ts의 headlineOutlets). */}
        {item.headlineOutlets >= 2 ? (
          <span className="text-[11.5px] font-bold text-rose-600">
            📰 {t('{n}개 매체가 1면 헤드라인', { n: item.headlineOutlets })}
          </span>
        ) : item.headlineRank === 1 ? (
          <span className="text-[11.5px] font-bold text-rose-600">
            📰 {t('{s} 머리기사', { s: item.headlineSource ?? item.source })}
          </span>
        ) : null}
        {/* 지표 소스(리포트·벤더 블로그·뉴스레터)는 뉴스로 띄우지 않는다. 대신 같은
            사안을 다뤘다는 사실만 근거로 밝힌다 — 1차 출처 확인이나 의제 신호다. */}
        {item.indicators.length > 0 && (
          <span className="text-[11px] text-spark-muted" title={item.indicators.map(i => i.title).join('\n')}>
            🧭 {item.indicators.map(i => i.source).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).join(' · ')}
          </span>
        )}
        {/* 여러 매체가 동시에 다뤘다는 것 자체가 이 기사를 1위로 만든 근거다.
            1면 배지와 함께 보여준다 — 둘은 다른 사실이고, 서로를 가리면 안 된다. */}
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
        {/* 같은 사안을 다룬 다른 매체의 원문도 각각 연다. 매체명만 있던 때는 그게
            링크인지, 눌렀을 때 어디로 가는지 알기 어려웠다(2026-09-09 피드백). */}
        {item.alsoIn.map(a => (
          <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"
             className="font-semibold text-spark-purple/85 underline decoration-spark-purple/30 underline-offset-2 hover:decoration-spark-purple">
            {t('{s} 원문 보기', { s: a.source })} ↗
          </a>
        ))}
      </div>
    </article>
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
        {/* 한 줄 설명 — 제목이 모델 id거나 맥락을 전제한 글은 이게 없으면 판단이 안 된다.
            근거를 못 구한 항목은 비어 있고, 그때는 아무것도 그리지 않는다. */}
        {post.blurb && (
          <p className="mt-1 text-[11px] leading-relaxed text-spark-ink-soft line-clamp-2">{post.blurb}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10.5px] text-spark-muted">
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
        {/* 1면 배지와 매체 수는 서로 다른 사실이라 각각 보여준다.
            예전에는 if/else 체인이라 "머리기사"가 붙으면 "+6개 매체"가 밀려났다 —
            여섯 매체가 다뤘다는 더 강한 근거가 화면에서 사라졌다(2026-09-10 지적). */}
        {item.headlineOutlets >= 2 ? (
          <span className="font-semibold text-rose-600">{t('{n}개 1면', { n: item.headlineOutlets })}</span>
        ) : item.headlineRank === 1 ? (
          <span className="font-semibold text-rose-600">{t('머리기사')}</span>
        ) : null}
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

      {/* 원문 링크는 대표 매체와 함께 보도한 매체를 모두 나열한다 — "+2개 매체"라고만
          써 두면 그 두 곳이 어디인지, 어떻게 가는지 알 수 없었다(2026-09-09 피드백).
          접힌 상태에서는 대표만, 펼치면 전부 보여준다. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <a href={item.url} target="_blank" rel="noopener noreferrer"
           className="font-semibold text-spark-purple hover:underline">
          {t('원문 보기')} ↗
        </a>
        {open && item.alsoIn.map(a => (
          <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"
             className="font-semibold text-spark-purple/85 underline decoration-spark-purple/30 underline-offset-2 hover:decoration-spark-purple">
            {t('{s} 원문 보기', { s: a.source })} ↗
          </a>
        ))}
      </div>
    </li>
  );
}
