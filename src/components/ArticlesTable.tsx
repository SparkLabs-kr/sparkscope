import { ScrapStar } from '@/components/ScrapStar';

interface Article {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date | string;
  matchedKeyword: string;
  category: string;
  importance: string | null;
  tone: string | null;
  pitchScore: number | null;
  isScrapped?: boolean;
  companyName?: string;
  portfolioStatus?: string | null;
  titleOnlyFallback?: boolean;
}

const CATEGORY_BADGE: Record<string, { label: string; cls: string }> = {
  sparklabs_self: { label: '스파크랩', cls: 'bg-green-100 text-green-800' },
  portfolio_company: { label: '포트폴리오', cls: 'bg-spark-light-purple text-spark-purple' },
  competitor: { label: 'AC·VC', cls: 'bg-red-100 text-red-800' },
  industry_trend: { label: '스타트업계', cls: 'bg-amber-100 text-amber-800' },
};

const TONE_DOT: Record<string, string> = {
  POSITIVE: 'bg-green-500',
  NEGATIVE: 'bg-red-500',
  NEUTRAL: 'bg-gray-400',
  MIXED: 'bg-gray-400',
};

const IMP_STYLE: Record<string, string> = { HIGH: 'text-red-600 font-bold', CRITICAL: 'text-red-700 font-bold', MEDIUM: 'text-amber-600 font-semibold', LOW: 'text-gray-400' };

const STATUS_BADGE: Record<string, string> = {
  Live: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Exit: 'bg-amber-50 text-amber-700 border border-amber-200',
};

function ToneDot({ tone }: { tone: string | null }) {
  const cls = TONE_DOT[tone ?? 'NEUTRAL'] ?? TONE_DOT.NEUTRAL;
  return <span className={`inline-block shrink-0 w-2 h-2 rounded-full ${cls}`} title={tone ?? 'NEUTRAL'} />;
}

// 본문 스크래핑 실패로 title만으로 분석된 기사 표시 — 조용히 넘기지 않고 눈에 띄게 경고.
function TitleOnlyBadge() {
  return (
    <span
      title="본문을 읽지 못해 제목만으로 분석했습니다. 요약·톤 판정 정확도가 낮을 수 있습니다."
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap bg-amber-50 text-amber-700 border border-amber-200"
    >
      ⚠️ 본문 미확인
    </span>
  );
}

export function ArticlesTable({ articles, canScrap = false, emptyText, showCategoryColumn = true }: { articles: Article[]; canScrap?: boolean; emptyText?: string; showCategoryColumn?: boolean }) {
  if (articles.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">{emptyText ?? '선택 기간 내 기사가 없습니다.'}</p>;
  }

  const hasCompanyName = articles.some(a => a.companyName);

  return (
    <>
      {/* 톤 범례 */}
      <div className="flex items-center gap-3 mb-2 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />긍정</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />부정</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gray-400" />중립</span>
      </div>

      {/* 데스크톱 테이블 (md 이상) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-spark-subtle text-spark-muted text-[10px] uppercase tracking-wider border-b border-spark-border">
              {canScrap && <th className="text-center px-2 py-2 w-8">★</th>}
              <th className="text-left px-3 py-2 w-20">날짜</th>
              {showCategoryColumn && <th className="text-left px-3 py-2 w-24">분류</th>}
              {hasCompanyName && <th className="text-left px-3 py-2 w-28">회사명</th>}
              {hasCompanyName && <th className="text-left px-3 py-2 w-16">상태</th>}
              <th className="text-left px-3 py-2">제목</th>
              <th className="text-left px-3 py-2 w-28">매체</th>
              <th className="text-center px-3 py-2 w-16">중요도</th>
              <th className="text-center px-3 py-2 w-16">피칭</th>
            </tr>
          </thead>
          <tbody>
            {articles.map(a => {
              const cat = CATEGORY_BADGE[a.category] ?? { label: a.category, cls: 'bg-gray-100' };
              const date = new Date(a.pubDate);
              const statusCls = STATUS_BADGE[a.portfolioStatus ?? ''];
              return (
                <tr key={a.id} className="border-b border-spark-border/60 hover:bg-spark-subtle transition-colors">
                  {canScrap && <td className="px-2 py-3 text-center"><ScrapStar id={a.id} initial={!!a.isScrapped} /></td>}
                  <td className="px-3 py-3 text-xs text-gray-500">{date.getMonth() + 1}/{date.getDate()}</td>
                  {showCategoryColumn && <td className="px-3 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cat.cls}`}>{cat.label}</span></td>}
                  {hasCompanyName && <td className="px-3 py-3 text-xs font-medium text-gray-800 whitespace-nowrap">{a.companyName ?? a.matchedKeyword}</td>}
                  {hasCompanyName && <td className="px-3 py-3">{statusCls ? <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${statusCls}`}>{a.portfolioStatus}</span> : <span className="text-gray-300 text-xs">—</span>}</td>}
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <ToneDot tone={a.tone} />
                      <a href={a.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple">{a.title}</a>
                      {a.titleOnlyFallback && <TitleOnlyBadge />}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-600">{a.source}</td>
                  <td className={`px-3 py-3 text-center text-xs ${IMP_STYLE[a.importance ?? 'LOW']}`}>{a.importance === 'HIGH' || a.importance === 'CRITICAL' ? '높음' : a.importance === 'MEDIUM' ? '중' : '낮음'}</td>
                  <td className="px-3 py-3 text-center text-xs font-bold text-amber-700">{a.pitchScore && a.pitchScore >= 60 ? a.pitchScore : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 모바일 카드 리스트 (md 미만) */}
      <div className="md:hidden space-y-3">
        {articles.map(a => {
          const cat = CATEGORY_BADGE[a.category] ?? { label: a.category, cls: 'bg-gray-100' };
          const date = new Date(a.pubDate);
          const statusCls = STATUS_BADGE[a.portfolioStatus ?? ''];
          return (
            <div key={a.id} className="border border-spark-border/60 rounded-lg p-3.5 bg-white hover:shadow-sm transition-shadow">
              {/* 상단: 분류 배지 + 날짜 + 별표 */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  {showCategoryColumn && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cat.cls}`}>{cat.label}</span>}
                  {a.companyName && <span className="text-xs font-medium text-gray-800">{a.companyName}</span>}
                  {statusCls && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusCls}`}>{a.portfolioStatus}</span>}
                  <span className="text-xs text-gray-500 whitespace-nowrap">{date.getMonth() + 1}/{date.getDate()}</span>
                </div>
                {canScrap && <div className="flex-shrink-0"><ScrapStar id={a.id} initial={!!a.isScrapped} /></div>}
              </div>

              {/* 제목 */}
              <a href={a.link} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 text-sm font-medium text-gray-900 hover:text-spark-purple mb-2">
                <ToneDot tone={a.tone} />
                <span className="line-clamp-2">{a.title}</span>
              </a>
              {a.titleOnlyFallback && <div className="mb-2"><TitleOnlyBadge /></div>}

              {/* 하단: 매체 + 중요도 + 피칭 */}
              <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
                <span className="truncate">{a.source}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {(a.importance === 'HIGH' || a.importance === 'CRITICAL') && <span className={IMP_STYLE[a.importance]}>높</span>}
                  {a.pitchScore && a.pitchScore >= 60 && <span className="text-amber-700 font-bold">{a.pitchScore}점</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
