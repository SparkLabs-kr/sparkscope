// 데일리 브리핑 페이지 — 잔디 링크가 여기로 온다. 로그인 없이 열린다(출근길 휴대폰에서 바로 재생).
// 보여주는 건 공개 기사 헤드라인과 영상뿐이다 — 내부 분석(ourTake·포트폴리오 매칭)은 없다.
import { notFound } from 'next/navigation';
import { loadBriefingVideo } from '@/lib/briefing-video/publish';
import { spokenDate } from '@/lib/briefing-video/script';

export const dynamic = 'force-dynamic';

export default async function BriefingPage({ params }: { params: { date: string } }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) notFound();
  const video = await loadBriefingVideo(params.date);
  if (!video) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="text-sm font-semibold text-spark-purple">SparkScope 데일리 브리핑</div>
      <h1 className="mt-1 text-2xl font-bold text-spark-ink">{spokenDate(video.dateKey)}</h1>
      <video src={video.url} controls playsInline preload="metadata" className="mt-4 w-full rounded-xl bg-black aspect-video" />
      <ol className="mt-6 space-y-3">
        {video.headlines.map((h, i) => (
          <li key={h.url} className="rounded-xl border border-spark-border bg-white p-4">
            <div className="text-xs text-spark-muted">{i + 1}. {h.label} · {h.source}</div>
            <a href={h.url} target="_blank" rel="noopener noreferrer" className="mt-1 block font-semibold text-spark-ink hover:text-spark-purple">
              {h.title}
            </a>
          </li>
        ))}
      </ol>
      <details className="mt-6 text-sm text-spark-ink-soft">
        <summary className="cursor-pointer font-semibold">대본 보기</summary>
        <div className="mt-2 space-y-2">{video.script.map((t, i) => <p key={i}>{t}</p>)}</div>
      </details>
    </main>
  );
}
