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
}

const CATEGORY_BADGE: Record<string, { label: string; cls: string }> = {
  sparklabs_self: { label: '스파크랩', cls: 'bg-green-100 text-green-800' },
  portfolio_company: { label: '포트폴리오', cls: 'bg-spark-light-purple text-spark-purple' },
  competitor: { label: 'AC·VC', cls: 'bg-red-100 text-red-800' },
  industry_trend: { label: '스타트업계', cls: 'bg-amber-100 text-amber-800' },
};

const TONE_EMOJI: Record<string, string> = { POSITIVE: '😊', NEGATIVE: '😟', NEUTRAL: '😐', MIXED: '😶' };
const IMP_STYLE: Record<string, string> = { HIGH: 'text-red-600 font-bold', CRITICAL: 'text-red-700 font-bold', MEDIUM: 'text-amber-600 font-semibold', LOW: 'text-gray-400' };

export function ArticlesTable({ articles, canScrap = false, emptyText }: { articles: Article[]; canScrap?: boolean; emptyText?: string }) {
  if (articles.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">{emptyText ?? '선택 기간 내 기사가 없습니다.'}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
            {canScrap && <th className="text-center px-2 py-2 w-8">★</th>}
            <th className="text-left px-3 py-2 w-20">날짜</th>
            <th className="text-left px-3 py-2 w-24">분류</th>
            <th className="text-left px-3 py-2">제목</th>
            <th className="text-left px-3 py-2 w-28">매체</th>
            <th className="text-center px-3 py-2 w-12">톤</th>
            <th className="text-center px-3 py-2 w-16">중요도</th>
            <th className="text-center px-3 py-2 w-16">피칭</th>
          </tr>
        </thead>
        <tbody>
          {articles.map(a => {
            const cat = CATEGORY_BADGE[a.category] ?? { label: a.category, cls: 'bg-gray-100' };
            const date = new Date(a.pubDate);
            return (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                {canScrap && <td className="px-2 py-3 text-center"><ScrapStar id={a.id} initial={!!a.isScrapped} /></td>}
                <td className="px-3 py-3 text-xs text-gray-500">{date.getMonth() + 1}/{date.getDate()}</td>
                <td className="px-3 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cat.cls}`}>{cat.label}</span></td>
                <td className="px-3 py-3"><a href={a.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple">{a.title}</a></td>
                <td className="px-3 py-3 text-xs text-gray-600">{a.source}</td>
                <td className="px-3 py-3 text-center">{TONE_EMOJI[a.tone ?? 'NEUTRAL']}</td>
                <td className={`px-3 py-3 text-center text-xs ${IMP_STYLE[a.importance ?? 'LOW']}`}>{a.importance === 'HIGH' || a.importance === 'CRITICAL' ? '높음' : a.importance === 'MEDIUM' ? '중' : '낮음'}</td>
                <td className="px-3 py-3 text-center text-xs font-bold text-amber-700">{a.pitchScore && a.pitchScore >= 60 ? a.pitchScore : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
