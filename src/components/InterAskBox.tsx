'use client';
/**
 * 요약 밑에서 그 기사에 대해 바로 물어보는 상자.
 *
 * 근거는 화면에 떠 있는 것과 같다(요약·매체·다른 매체 보도·포트폴리오 매칭).
 * 원문 발췌는 응답 크기 때문에 브라우저까지 오지 않으므로, 답도 그만큼만
 * 할 수 있다. grounding='headline' 인 항목은 서버가 아예 답을 사양한다.
 */
import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import type { DigestItem } from '@/lib/sparkscope/news-digest';

export function InterAskBox({ item }: { item: DigestItem }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [grounded, setGrounded] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const ask = async () => {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const res = await fetch('/api/inter/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          title: item.title,
          source: item.source,
          publishedAt: item.publishedAt,
          url: item.url,
          summary: item.summary
            ? (locale === 'en' ? item.summary.enLong : item.summary.koLong)
            : [],
          alsoIn: item.alsoIn.map(a => a.source),
          grounding: item.grounding,
          portfolio: item.portfolio ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(
          data?.error === 'not_configured'
            ? t('질문 기능이 아직 설정되지 않았습니다.')
            : t('답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.'),
        );
        return;
      }
      setAnswer(data.answer ?? '');
      setGrounded(data.grounded !== false);
    } catch {
      setErr(t('답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-[11.5px] font-semibold text-spark-purple hover:underline"
      >
        💬 {t('이 기사에 대해 질문하기')}
      </button>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-spark-border">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={q}
          autoFocus
          maxLength={500}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }}
          placeholder={t('예: 왜 중요한가요? 우리 포트폴리오와 어떤 관련이 있나요?')}
          className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-spark-border text-[12.5px] focus:outline-none focus:border-spark-purple"
        />
        <button
          type="button"
          onClick={ask}
          disabled={busy || q.trim().length < 2}
          className="px-3 py-1.5 rounded-lg bg-spark-purple text-white text-[12.5px] font-semibold disabled:opacity-40 whitespace-nowrap"
        >
          {busy ? t('생각 중...') : t('질문')}
        </button>
      </div>

      {err && <p className="mt-2 text-[12px] text-rose-700">{err}</p>}

      {answer && (
        <div className="mt-2.5 rounded-lg bg-spark-subtle border border-spark-border px-3 py-2.5">
          <p className="text-[12.5px] leading-[1.75] text-spark-ink whitespace-pre-wrap">{answer}</p>
          {/* 근거 밖이면 그렇다고 표시한다 — 답이 그럴듯해 보일수록 필요하다. */}
          <p className="mt-2 text-[10.5px] text-spark-muted">
            {grounded
              ? t('이 기사에 수집된 내용만으로 답했습니다.')
              : t('수집된 내용만으로는 답하기 어려운 질문입니다 — 원문을 확인해 주세요.')}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => { setOpen(false); setQ(''); setAnswer(null); setErr(null); }}
        className="mt-2 text-[11px] text-spark-muted hover:text-spark-purple"
      >
        {t('닫기')}
      </button>
    </div>
  );
}
