import type { Metadata } from 'next';
import './globals.css';
import { LocaleProvider } from '@/lib/i18n/client';
import { getLocale, getT } from '@/lib/i18n/server';

// 탭 제목·설명도 언어 설정을 따른다(쿠키를 읽으므로 요청마다 계산).
export function generateMetadata(): Metadata {
  const t = getT();
  return {
    title: t('SparkScope · 스파크랩 미디어 인사이트'),
    description: t('스파크랩 커뮤니케이션 본부 전용 뉴스 모니터링 시스템'),
    robots: 'noindex, nofollow',
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  return (
    <html lang={locale}>
      <body className="font-sans antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
