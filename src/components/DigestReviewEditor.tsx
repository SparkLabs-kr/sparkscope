'use client';
// 다이제스트 검수 에디터 — TOP3 순서·포함 조정, 카테고리 요약, 편집자 한 줄, 실시간 미리보기, 발송.
import { useEffect, useMemo, useRef, useState } from 'react';

interface Cand {
  id: string;
  title: string;
  source: string;
  category: string;
  oneLiner: string;
  pitchScore: number;
  isScrapped: boolean;
  priorityScore: number;
  matchedKeyword: string;
  pubDate: string;
}

const CATS: [string, string][] = [
  ['sparklabs_self', '🏢 스파크랩 뉴스'],
  ['portfolio_company', '💼 포트폴리오사'],
  ['competitor', '🤝 AC·VC 업계 동향'],
  ['industry_trend', '🌐 스타트업계 뉴스'],
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS);

export function DigestReviewEditor({
  candidates,
  initialTop3Ids,
  initialEditorIntro,
  canSend,
  recipient,
}: {
  candidates: Cand[];
  initialTop3Ids: string[];
  initialEditorIntro: string;
  canSend: boolean;
  recipient: string;
}) {
  const [editorIntro, setEditorIntro] = useState(initialEditorIntro);
  const [top3Ids, setTop3Ids] = useState<string[]>(initialTop3Ids.slice(0, 3));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');

  const byId = useMemo(() => new Map(candidates.map(c => [c.id, c])), [candidates]);

  const payload = useMemo(() => ({
    editorIntro,
    top3Ids,
    excludedIds: Array.from(excluded),
    categorySummaries: {
      sparklabs_self: summaries.sparklabs_self || undefined,
      portfolio_company: summaries.portfolio_company || undefined,
      competitor: summaries.competitor || undefined,
      industry_trend: summaries.industry_trend || undefined,
    },
  }), [editorIntro, top3Ids, excluded, summaries]);

  // 상태 변경 시 미리보기 자동 갱신 (디바운스)
  const payloadKey = JSON.stringify(payload);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch('/api/digest/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadKey,
        });
        const data = await res.json();
        setPreviewHtml(data.html ?? '');
      } catch {
        /* 미리보기 실패는 조용히 무시 */
      } finally {
        setPreviewLoading(false);
      }
    }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [payloadKey]);

  function moveTop3(idx: number, dir: -1 | 1) {
    setTop3Ids(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function removeTop3(id: string) {
    setTop3Ids(prev => prev.filter(x => x !== id));
  }
  function addTop3(id: string) {
    setTop3Ids(prev => (prev.includes(id) || prev.length >= 3 ? prev : [...prev, id]));
  }
  function toggleExclude(id: string) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); }
      return next;
    });
    // 제외되면 TOP3에서도 제거
    setTop3Ids(prev => (excluded.has(id) ? prev : prev.filter(x => x !== id)));
  }

  async function onSend() {
    const chosen = top3Ids.map(id => byId.get(id)?.title).filter(Boolean);
    const actualRecipient = testEmail.trim() || recipient || '(환경변수 수신자)';
    const msg = `실제로 다이제스트를 발송합니다.\n\n수신: ${actualRecipient}${testEmail.trim() ? ' (테스트)' : ''}\nTOP 3:\n${chosen.map((t, i) => `  ${i + 1}. ${t}`).join('\n') || '  (자동 선정)'}\n\n발송하시겠습니까?`;
    if (!window.confirm(msg)) return;
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch('/api/digest/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...(testEmail.trim() ? { testRecipient: testEmail.trim() } : {}) }),
      });
      const data = await res.json();
      if (res.ok && data.ok) setSendMsg({ ok: true, text: `발송 완료: ${data.recipient ?? recipient}` });
      else setSendMsg({ ok: false, text: data.error ?? '발송 실패' });
    } catch (e: any) {
      setSendMsg({ ok: false, text: String(e?.message ?? e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* 좌: 편집 컨트롤 */}
      <div className="space-y-5">
        {/* 편집자 한 줄 */}
        <section className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-2">✍️ 편집자 한 줄</div>
          <textarea
            value={editorIntro}
            onChange={e => setEditorIntro(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:border-spark-purple focus:outline-none focus:ring-1 focus:ring-spark-purple"
            placeholder="메일 상단에 들어갈 편집자 한 줄 인사"
          />
        </section>

        {/* TOP 3 */}
        <section className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-1">⭐ 오늘의 핵심 TOP 3 <span className="text-xs font-normal text-gray-400">(스크랩 우선 자동 선정 · 순서/포함 조정 가능)</span></div>
          {top3Ids.length === 0 && <p className="text-sm text-gray-400 py-2">선택된 TOP 3가 없습니다. 아래 후보에서 <b>TOP3 추가</b>로 최대 3개까지 올리세요.</p>}
          <div className="space-y-2 mt-2">
            {top3Ids.map((id, idx) => {
              const a = byId.get(id);
              if (!a) return null;
              return (
                <div key={id} className="flex items-start gap-2 rounded-lg border border-spark-light-purple bg-spark-light-purple/20 p-2.5">
                  <div className="text-sm font-bold text-spark-purple w-6 text-center">#{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{a.isScrapped ? '⭐ ' : ''}{a.title}</div>
                    <div className="text-xs text-gray-500">{CAT_LABEL[a.category] ?? a.category} · {a.source}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => moveTop3(idx, -1)} disabled={idx === 0} className="px-1.5 py-0.5 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30">▲</button>
                    <button onClick={() => moveTop3(idx, 1)} disabled={idx === top3Ids.length - 1} className="px-1.5 py-0.5 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30">▼</button>
                    <button onClick={() => removeTop3(id)} className="px-1.5 py-0.5 text-xs rounded border border-red-200 text-red-600 hover:bg-red-50">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 카테고리별 요약 + 후보 기사 */}
        {CATS.map(([cat, label]) => {
          const list = candidates.filter(c => c.category === cat);
          return (
            <section key={cat} className="bg-white p-5 rounded-xl border border-gray-200">
              <div className="font-bold mb-2">{label} <span className="text-xs font-normal text-gray-400">({list.length}건)</span></div>
              <textarea
                value={summaries[cat] ?? ''}
                onChange={e => setSummaries(s => ({ ...s, [cat]: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-gray-200 p-2.5 text-sm mb-3 focus:border-spark-purple focus:outline-none focus:ring-1 focus:ring-spark-purple"
                placeholder={`${label} 섹션 상단에 넣을 요약 한 줄 (선택)`}
              />
              {list.length === 0 ? (
                <p className="text-xs text-gray-400">이 카테고리 후보 기사가 없습니다.</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {list.map(a => {
                    const isExcluded = excluded.has(a.id);
                    const inTop3 = top3Ids.includes(a.id);
                    return (
                      <div key={a.id} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${isExcluded ? 'border-gray-100 bg-gray-50 opacity-50' : 'border-gray-100'}`}>
                        <div className="flex-1 min-w-0">
                          <div className={`truncate ${isExcluded ? 'line-through text-gray-400' : 'text-gray-800'}`}>{a.isScrapped ? '⭐ ' : ''}{a.title}</div>
                          <div className="text-[11px] text-gray-400">{a.source} · {a.matchedKeyword}{a.pitchScore >= 60 ? ` · 피칭 ${a.pitchScore}` : ''}</div>
                        </div>
                        {!inTop3 && !isExcluded && (
                          <button onClick={() => addTop3(a.id)} disabled={top3Ids.length >= 3} className="shrink-0 px-2 py-0.5 text-[11px] rounded border border-spark-purple text-spark-purple hover:bg-spark-light-purple/30 disabled:opacity-30" title={top3Ids.length >= 3 ? 'TOP3가 이미 3개입니다' : ''}>TOP3 추가</button>
                        )}
                        <button onClick={() => toggleExclude(a.id)} className={`shrink-0 px-2 py-0.5 text-[11px] rounded border ${isExcluded ? 'border-gray-300 text-gray-500' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
                          {isExcluded ? '되돌리기' : '제외'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* 우: 미리보기 + 발송 */}
      <div className="lg:sticky lg:top-20 self-start space-y-3">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div className="font-bold">👁 실제 발송 미리보기 {previewLoading && <span className="text-xs font-normal text-gray-400">갱신 중…</span>}</div>
          </div>
          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <iframe title="digest-preview" srcDoc={previewHtml} className="w-full" style={{ height: '70vh', border: 0 }} />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200">
          {canSend ? (
            <>
              <button
                onClick={onSend}
                disabled={sending}
                className="w-full rounded-lg bg-spark-purple py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {sending ? '발송 중…' : '📤 지금 발송하기'}
              </button>
              <div className="mt-2 flex gap-2 items-center">
                <input
                  type="email"
                  placeholder="테스트 수신 이메일 (비우면 실제 수신자)"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-spark-purple"
                />
              </div>
              <p className="mt-1 text-center text-xs text-gray-400">
                {testEmail.trim() ? `테스트 수신: ${testEmail.trim()}` : `수신: ${recipient || '(환경변수 수신자)'}`}
              </p>
            </>
          ) : (
            <p className="text-center text-sm text-gray-500 py-2">발송 권한이 없습니다. (SCRAP_ALLOWED_EMAILS 지정 계정만 발송 가능)</p>
          )}
          {sendMsg && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${sendMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {sendMsg.ok ? '✅ ' : '⚠️ '}{sendMsg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
