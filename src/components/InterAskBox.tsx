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
  /** 주고받은 대화 — 이어지는 질문이 통하려면 화면이 들고 있어야 한다. */
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [headlineOnly, setHeadlineOnly] = useState(false);
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
          history: turns.slice(-8),
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
      setHeadlineOnly(data.headlineOnly === true);
      setTurns(prev => [
        ...prev,
        { role: 'user' as const, text: question },
        { role: 'assistant' as const, text: String(data.answer ?? '') },
      ]);
      setFollowUps(Array.isArray(data.followUps) ? data.followUps.slice(0, 3) : []);
      setQ('');
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
        aria-expanded={false}
        className="mt-3 w-full flex items-center gap-2 rounded-xl border border-spark-border bg-spark-subtle px-3.5 py-2.5 text-left hover:border-spark-purple transition"
      >
        <span className="text-[13px]">💬</span>
        <span className="flex-1 text-[12.5px] font-semibold text-spark-ink-soft">
          {t('SparkScope AI에게 물어보기')}
        </span>
        <span className="text-[10px] text-spark-muted">▼</span>
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-spark-purple/40 bg-spark-subtle overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-expanded
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left border-b border-spark-border"
      >
        <span className="text-[13px]">💬</span>
        <span className="flex-1 text-[12.5px] font-semibold text-spark-purple">
          {t('SparkScope AI에게 물어보기')}
        </span>
        <span className="text-[10px] text-spark-muted">▲</span>
      </button>
      <div className="px-3.5 py-3">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={q}
          autoFocus
          maxLength={500}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }}
          placeholder={
            turns.length > 0
              ? t('이어서 물어보세요')
              : t('예: 왜 중요한가요? 우리 포트폴리오와 어떤 관련이 있나요?')
          }
          className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-spark-border text-[12.5px] focus:outline-none focus:border-spark-purple"
        />
        <button
          type="button"
          onClick={ask}
          disabled={busy || q.trim().length < 2}
          className="px-3 py-1.5 rounded-lg bg-spark-purple text-white text-[12.5px] font-semibold disabled:opacity-40 whitespace-nowrap"
        >
          {busy ? t('찾는 중...') : t('질문')}
        </button>
      </div>

      {err && <p className="mt-2 text-[12px] text-rose-700">{err}</p>}

      {answer && (
        <div className="mt-2.5 rounded-lg bg-spark-subtle border border-spark-border px-3 py-2.5">
          <p className="text-[12.5px] leading-[1.75] text-spark-ink whitespace-pre-wrap">{answer}</p>
          {/* 근거 밖이면 그렇다고 표시한다 — 답이 그럴듯해 보일수록 필요하다. */}
          {/* 챗봇과 같은 엔진이라 후속 질문 제안도 그대로 온다. */}
          {followUps.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {followUps.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setQ(f); }}
                  className="rounded-full bg-spark-light-purple text-spark-purple px-2.5 py-1 text-[11px] font-medium hover:opacity-80"
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {headlineOnly && (
            <p className="mt-2 text-[10.5px] text-spark-muted">
              {t('이 기사는 제목만 수집되어 있습니다.')}
            </p>
          )}
        </div>
      )}

      </div>
    </div>
  );
}
