import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="text-xs font-bold tracking-wider text-spark-purple mb-2">SPARKSCOPE</div>
        <h1 className="text-4xl font-bold mb-3">스파크랩 미디어 인사이트</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">
          스파크랩 임직원 전용 뉴스 모니터링·인사이트 대시보드입니다.
          <br />
          @sparklabs.co.kr 이메일로 접속하세요.
        </p>
        <Link
          href="/login"
          className="inline-block px-8 py-3 bg-spark-purple text-white font-semibold rounded-lg hover:opacity-90 transition"
        >
          로그인하기
        </Link>
        <div className="mt-12 text-xs text-gray-400">v0.1 시범 운영 · 외부 공유 금지</div>
      </div>
    </main>
  );
}
