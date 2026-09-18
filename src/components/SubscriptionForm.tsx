'use client';

/**
 * 다이제스트 구독 설정 폼.
 * 로그인해서 들어온 경우(/dashboard/subscriptions)와 메일 링크로 들어온 경우(/subscribe)가
 * 같은 화면을 쓴다 — 다른 건 본인 확인 방법(token 유무)뿐이라 폼은 하나로 둔다.
 */
import { useState } from 'react';
import { SECTIONS, type SectionKey } from '@/lib/sparkscope/subscription';

export interface SubscriptionFormProps {
  email: string;
  /** 메일 링크로 들어온 경우에만 있다. 없으면 로그인 세션으로 저장한다. */
  token?: string;
  initialSections: Record<SectionKey, boolean>;
  initialActive: boolean;
}

export default function SubscriptionForm({
  email, token, initialSections, initialActive,
}: SubscriptionFormProps) {
  const [sections, setSections] = useState(initialSections);
  const [active, setActive] = useState(initialActive);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const noneSelected = SECTIONS.every(s => !sections[s.key]);

  async function save(next: { sections: Record<SectionKey, boolean>; active: boolean }) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sections: next.sections, active: next.active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '저장에 실패했습니다.');
      setMsg({ kind: 'ok', text: '저장했습니다. 다음 메일부터 적용됩니다.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: String(e?.message ?? e) });
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: SectionKey) {
    const next = { ...sections, [key]: !sections[key] };
    setSections(next);
    save({ sections: next, active });
  }

  function toggleActive() {
    const next = !active;
    setActive(next);
    save({ sections, active: next });
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-spark-ink">다이제스트 구독 설정</h1>
        <p className="mt-1.5 text-sm text-spark-muted">
          {email} · 받고 싶은 항목만 켜 두세요. 바꾸면 바로 저장되고, 다음 발송분부터 적용됩니다.
        </p>
      </div>

      <div className="rounded-2xl border border-spark-border bg-white p-2 shadow-card">
        {SECTIONS.map(s => {
          const on = sections[s.key] && active;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              disabled={saving || !active}
              className={`flex w-full items-start gap-3 rounded-xl p-4 text-left transition-colors ${
                active ? 'hover:bg-spark-subtle' : 'cursor-not-allowed opacity-50'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                  on ? 'bg-spark-purple' : 'bg-gray-300'
                }`}
              >
                <span className={`h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold text-spark-ink">{s.label}</span>
                <span className="block text-[13px] text-spark-muted">{s.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {noneSelected && active && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          항목을 하나도 켜지 않으면 메일이 오지 않습니다.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-spark-border bg-white p-4 shadow-card">
        <button
          type="button"
          onClick={toggleActive}
          disabled={saving}
          className="text-sm font-semibold text-spark-muted underline hover:text-spark-ink"
        >
          {active ? '다이제스트 전체 수신 거부' : '다이제스트 다시 받기'}
        </button>
        {!active && (
          <p className="mt-2 text-[13px] text-spark-muted">
            지금은 메일을 받지 않는 상태입니다.
          </p>
        )}
      </div>

      {msg && (
        <p className={`mt-4 text-sm font-semibold ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
