'use client';
// 톤 분석 — 클릭 없이 세 논조(긍정/중립/부정)의 비율과 기사 목록이 한 화면에 바로 보인다.
import { useState } from 'react';

interface ToneArticle {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date | string;
  tone: string;
}

const TONES = [
  { key: 'POSITIVE', label: '긍정', dot: 'bg-emerald-600', bar: 'bg-emerald-600', border: 'border-emerald-200', head: 'text-emerald-700', soft: 'bg-emerald-50/60 hover:bg-emerald-50' },
  { key: 'NEUTRAL', label: '중립', dot: 'bg-slate-400', bar: 'bg-slate-400', border: 'border-spark-border', head: 'text-spark-ink-soft', soft: 'bg-spark-subtle hover:bg-spark-subtle/70' },
  { key: 'NEGATIVE', label: '부정', dot: 'bg-red-500', bar: 'bg-red-500', border: 'border-red-200', head: 'text-red-700', soft: 'bg-red-50/60 hover:bg-red-50' },
];

// 제목이 글자 하나까지 같지 않아도 같은 사건을 다룬 기사면 한 카드로 묶기 위한 문자 bigram
// 유사도. 형태소 분석기 없이도 "로브스터, 스파크랩 시드 투자 유치" vs "토스 창업자 설립
// 프라이빗 메신저 '로브스터', 스파크랩서 시드 투자 유치" 같은 케이스를 잡아낸다.
function normalizeTitle(title: string): string {
  return title.replace(/[\[\]'"‘’“”()·,.\-–—0-9\s]/g, '').toLowerCase();
}
function bigramSet(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
// containment 계수(교집합/짧은쪽 크기) — 부제가 붙어 길이가 크게 달라도, 짧은 제목의
// bigram이 긴 제목 안에 거의 다 들어있으면 같은 사건으로 판단.
function titleSimilarity(a: string, b: string): number {
  const A = bigramSet(normalizeTitle(a));
  const B = bigramSet(normalizeTitle(b));
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  for (const g of A) if (B.has(g)) overlap++;
  return overlap / Math.min(A.size, B.size);
}

const DUPLICATE_THRESHOLD = 0.65;

interface ArticleCluster {
  rep: ToneArticle;
  others: ToneArticle[];
}

// 같은 이벤트를 다룬 기사(매체만 다름)를 대표 기사 1개 + 나머지로 묶는다.
// 대표는 그룹 내 가장 간결한(짧은) 제목 — 부제가 덕지덕지 붙은 제목보다 핵심만 담겨 있어 대표로 적합.
function clusterArticles(list: ToneArticle[]): ArticleCluster[] {
  const clusters: ArticleCluster[] = [];
  for (const article of list) {
    let bestCluster: ArticleCluster | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = titleSimilarity(article.title, cluster.rep.title);
      if (score > bestScore) { bestScore = score; bestCluster = cluster; }
    }
    if (bestCluster && bestScore >= DUPLICATE_THRESHOLD) {
      if (article.title.length < bestCluster.rep.title.length) {
        bestCluster.others.push(bestCluster.rep);
        bestCluster.rep = article;
      } else {
        bestCluster.others.push(article);
      }
    } else {
      clusters.push({ rep: article, others: [] });
    }
  }
  return clusters;
}

export function ToneBreakdown({ articles }: { articles: ToneArticle[] }) {
  // 펼쳐진 클러스터(대표 기사 id) 집합 — "+N개 매체 더보기" 토글 상태.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const total = articles.length || 1;
  const groups = TONES.map(t => ({
    ...t,
    // 비율/건수는 클러스터링 전 전체 기사 수 기준 유지 — "몇 건이 보도됐는지"라는 의미가 왜곡되지 않게.
    list: articles.filter(a => (a.tone || 'NEUTRAL') === t.key),
  }));

  return (
    <div className="space-y-4 mt-1">
      {/* 한눈에 보는 비율 — 하나의 막대에 세 논조를 이어붙여 전체 대비를 바로 비교 */}
      <div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-spark-subtle">
          {groups.map(g => (
            g.list.length > 0 && (
              <span key={g.key} className={g.bar} style={{ width: `${(g.list.length / total) * 100}%` }} title={`${g.label} ${g.list.length}건`} />
            )
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          {groups.map(g => (
            <span key={g.key} className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${g.dot}`} />
              <span className="text-spark-ink-soft">{g.label}</span>
              <span className="font-semibold tabular-nums text-spark-ink">{g.list.length}</span>
              <span className="text-spark-muted">({Math.round((g.list.length / total) * 100)}%)</span>
            </span>
          ))}
        </div>
      </div>

      {/* 논조별 기사 — 클릭 없이 3열로 항상 펼쳐서 표시 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {groups.map(g => (
          <div key={g.key} className={`rounded-xl border ${g.border} overflow-hidden`}>
            <div className={`flex items-center justify-between px-3 py-2 text-xs font-bold ${g.head} bg-white`}>
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${g.dot}`} />
                {g.label}
              </span>
              <span className="tabular-nums">{g.list.length}건</span>
            </div>
            <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto scroll-slim">
              {g.list.length === 0 ? (
                <p className="text-[11px] text-spark-muted px-1 py-2">해당 논조 기사 없음</p>
              ) : clusterArticles(g.list).map(c => {
                const d = new Date(c.rep.pubDate);
                const isOpen = expanded.has(c.rep.id);
                return (
                  <div key={c.rep.id} className={`rounded-lg border border-transparent ${g.soft} transition`}>
                    <a href={c.rep.link} target="_blank" rel="noopener noreferrer" className="block p-2">
                      <div className="text-xs text-spark-ink leading-snug line-clamp-2">{c.rep.title}</div>
                      <div className="text-[10px] text-spark-muted mt-0.5">{c.rep.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                    </a>
                    {c.others.length > 0 && (
                      <div className="px-2 pb-1.5 -mt-1">
                        <button
                          type="button"
                          onClick={() => toggle(c.rep.id)}
                          className="text-[10px] font-semibold text-spark-purple hover:underline"
                        >
                          {isOpen ? '접기 ▲' : `+${c.others.length}개 매체 더보기 ▼`}
                        </button>
                        {isOpen && (
                          <div className="mt-1 space-y-1 border-l-2 border-spark-border pl-2">
                            {c.others.map(o => {
                              const od = new Date(o.pubDate);
                              return (
                                <a key={o.id} href={o.link} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-spark-muted hover:text-spark-ink">
                                  {o.source} · {od.getMonth() + 1}.{od.getDate()}
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
