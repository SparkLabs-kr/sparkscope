'use client';
import { articleTitle } from '@/lib/sparkscope/article-title';
// 회사명에 마우스를 올리면(모바일은 탭) 최근 기사 미리보기가 뜨는 컴포넌트.
import { useEffect, useRef, useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';

interface RecentArticle {
  title: string;
  titleEn?: string | null;
  link: string;
  source: string;
  pubDate: Date | string;
}

export function CompanyNameWithPreview({ name, articles }: { name: string; articles: RecentArticle[] }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // 모바일 등 마우스가 없는 환경에서 탭으로 열었을 때, 바깥을 탭하면 닫히게.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  if (articles.length === 0) {
    return <span className="w-28 truncate font-semibold text-gray-700" title={t(name)}>{t(name)}</span>;
  }

  return (
    // 바깥(이 span)엔 overflow를 걸지 않음 — 안쪽 이름만 잘라서(truncate) 보여주고,
    // 미리보기 팝오버는 이 바깥 기준으로 떠서 이름이 잘려도 팝오버까지 잘리지 않게 한다.
    <span
      ref={wrapperRef}
      className="relative w-28 shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className="block truncate font-semibold text-gray-700 cursor-pointer underline decoration-dotted decoration-gray-300 underline-offset-2"
        title={t(name)}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {t(name)}
      </span>
      {open && (
        <div
          className="absolute z-20 left-0 top-full mt-1 w-72 rounded-lg border border-spark-border bg-white shadow-lg p-1.5 space-y-0.5"
          onClick={e => e.stopPropagation()}
        >
          {articles.map((a, i) => {
            const d = new Date(a.pubDate);
            return (
              <a
                key={i}
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded px-2 py-1.5 hover:bg-spark-subtle"
              >
                <div className="text-xs text-gray-800 leading-snug line-clamp-2">{articleTitle(a, locale)}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{t(a.source)} · {d.getMonth() + 1}.{d.getDate()}</div>
              </a>
            );
          })}
        </div>
      )}
    </span>
  );
}
