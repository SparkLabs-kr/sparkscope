'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>오류 발생</h1>
      <p>{error.message}</p>
      <button onClick={reset} style={{ padding: '10px', backgroundColor: '#7c3aed', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
        다시 시도
      </button>
    </div>
  );
}
