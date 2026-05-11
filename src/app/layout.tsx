import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SparkScope · 스파크랩 미디어 인사이트',
  description: '스파크랩 커뮤니케이션 본부 전용 뉴스 모니터링 시스템',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
