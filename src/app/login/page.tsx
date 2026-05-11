'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const checkEmail = params.get('check') === 'email';

  if (checkEmail) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">📬</div>
          <h1 className="text-2xl font-bold mb-3">메일을 확인하세요</h1>
          <p className="text-gray-600 leading-relaxed">
            로그인 링크를 보냈습니다. 받은편지함에서 SparkScope 메일을 열어 링크를 클릭하세요.
            <br />
            <span className="text-xs text-gray-400 mt-4 block">(스팸함도 확인해주세요)</span>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form
        onSubmit={async e => {
          e.preventDefault();
          setSubmitting(true);
          await signIn('email', { email, callbackUrl: '/dashboard' });
        }}
        className="max-w-md w-full"
      >
        <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>
        <h1 className="text-2xl font-bold mb-2 text-center">로그인</h1>
        <p className="text-sm text-gray-600 mb-6 text-center">
          @sparklabs.co.kr 이메일을 입력하면 로그인 링크를 보내드립니다
        </p>
        <input
          type="email"
          required
          placeholder="name@sparklabs.co.kr"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full px-4 py-3 border border-gray-200 rounded-lg mb-3 focus:outline-none focus:border-spark-purple"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-spark-purple text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? '전송 중...' : '로그인 링크 받기'}
        </button>
      </form>
    </main>
  );
}
