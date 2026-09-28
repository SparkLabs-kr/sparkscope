'use client';
import { articleTitle } from '@/lib/sparkscope/article-title';
import { useT, useLocale } from '@/lib/i18n/client';
// 다이제스트 검수 에디터 — TOP3 순서·포함 조정, 카테고리 요약, 편집자 한 줄, 실시간 미리보기, 발송.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BriefingHeadline } from '@/lib/sparkscope/briefing';
import type { BriefingCandidate, BriefingRecommendation } from '@/lib/sparkscope/briefing-reco';

const BRIEFING_MAX = 5;

interface Cand {
  id: string;
  title: string;
  titleEn?: string | null;
  link: string;
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
  briefingCandidates,
  initialReco,
  initialExcludedIds,
  autoTop3Ids,
  savedBriefing,
  hasSavedEdits,
  suggestedBriefing,
}: {
  candidates: Cand[];
  initialTop3Ids: string[];
  initialEditorIntro: string;
  canSend: boolean;
  recipient: string;
  briefingCandidates: BriefingCandidate[];
  initialReco: BriefingRecommendation | null;
  initialExcludedIds: string[];
  autoTop3Ids: string[];
  savedBriefing: BriefingHeadline[];
  hasSavedEdits: boolean;
  suggestedBriefing: BriefingHeadline[];
}) {
  const tr = useT();
  const locale = useLocale();
  const [editorIntro, setEditorIntro] = useState(initialEditorIntro);
  const [top3Ids, setTop3Ids] = useState<string[]>(initialTop3Ids.slice(0, 3));
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initialExcludedIds));
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');

  const byId = useMemo(() => new Map(candidates.map(c => [c.id, c])), [candidates]);

  // 오늘 편집(메일 TOP 3 · 제외 · 브리핑 헤드라인) — 저장해야 10:30 자동 발송과 영상에 반영된다.
  // 저장 전까지 브리핑은 "자동 선정 예상"을 보여준다.
  // 저장 전까지 브리핑은 🤖 추천 5개를 보여준다. [추천 다시 받기]로 바뀔 수 있어 상태로 둔다.
  const [reco, setReco] = useState<BriefingRecommendation | null>(initialReco);
  const [suggested, setSuggested] = useState<BriefingHeadline[]>(suggestedBriefing);
  const recoUrls = useMemo(() => new Set((reco?.headlines ?? []).map(h => h.url)), [reco]);
  const [recoBusy, setRecoBusy] = useState(false);
  const [briefing, setBriefing] = useState<BriefingHeadline[]>(savedBriefing.length > 0 ? savedBriefing : suggestedBriefing);
  const [briefingSaved, setBriefingSaved] = useState(hasSavedEdits);
  const [briefingDirty, setBriefingDirty] = useState(false);
  // TOP 3·제외는 처음 값과 달라지면 "저장 안 됨"으로 본다.
  const initialEditKey = useRef(JSON.stringify([initialTop3Ids.slice(0, 3), [...initialExcludedIds].sort()]));
  const editKey = JSON.stringify([top3Ids, Array.from(excluded).sort()]);
  const [savedEditKey, setSavedEditKey] = useState(initialEditKey.current);
  const mailDirty = editKey !== savedEditKey;
  const [briefingMsg, setBriefingMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [briefingBusy, setBriefingBusy] = useState(false);
  // ref(id)와 url 둘 다로 중복을 본다 — 발송 크론이 만든 자동 선정분은 ref가 링크일 수 있다.
  const inBriefing = useMemo(() => new Set(briefing.flatMap(h => [h.ref, h.url])), [briefing]);

  function editBriefing(fn: (prev: BriefingHeadline[]) => BriefingHeadline[]) {
    setBriefing(fn);
    setBriefingDirty(true);
    setBriefingMsg(null);
  }
  function addBriefing(h: BriefingHeadline) {
    editBriefing(prev => (prev.some(x => x.ref === h.ref || x.url === h.url) || prev.length >= BRIEFING_MAX ? prev : [...prev, h]));
  }
  function moveBriefing(idx: number, dir: -1 | 1) {
    editBriefing(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  // 교체 후보 고르기 — replaceIdx가 있으면 그 자리를 바꾸고, 없으면 빈자리에 추가한다.
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [pickKind, setPickKind] = useState<'all' | 'intra' | 'inter'>('all');
  const pickList = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    const excludedLinks = new Set(Array.from(excluded).map(id => byId.get(id)?.link));
    return briefingCandidates
      .filter(c => !inBriefing.has(c.ref) && !inBriefing.has(c.url) && !excludedLinks.has(c.url))
      .filter(c => pickKind === 'all' || c.kind === pickKind)
      .filter(c => !q || [c.title, c.source, c.summary].some(t => t.toLowerCase().includes(q)))
      .slice(0, 60);
  }, [briefingCandidates, inBriefing, excluded, byId, pickKind, pickQuery]);
  function pickCandidate(c: BriefingCandidate) {
    const { pubDate: _p, importance: _i, matchCount: _m, ...h } = c;
    if (replaceIdx !== null) {
      const idx = replaceIdx;
      editBriefing(prev => prev.map((x, i) => (i === idx ? h : x)));
      setReplaceIdx(null);
    } else {
      addBriefing(h);
    }
  }
  async function refreshReco() {
    setRecoBusy(true);
    setBriefingMsg(null);
    try {
      const res = await fetch('/api/digest/briefing-reco', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.reco) throw new Error(data.error ?? tr('추천을 받지 못했습니다.'));
      setReco(data.reco);
      setSuggested(data.reco.headlines);
      // 아직 손대지 않았으면 새 추천으로 바로 갈아 끼운다. 편집 중이면 편집을 지키고 🤖 표시만 바뀐다.
      if (!briefingSaved && !briefingDirty) setBriefing(data.reco.headlines);
    } catch (e: any) {
      setBriefingMsg({ ok: false, text: String(e?.message ?? e) });
    } finally {
      setRecoBusy(false);
    }
  }
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
  const linkOf = (id: string) => byId.get(id)?.link;
  async function saveEdits(reset = false) {
    setBriefingBusy(true);
    setBriefingMsg(null);
    try {
      const body = reset
        ? { headlines: [], top3Links: [], excludedLinks: [] }
        : {
            headlines: briefing,
            top3Links: top3Ids.map(linkOf).filter(Boolean),
            excludedLinks: Array.from(excluded).map(linkOf).filter(Boolean),
            // 자동 선정과 사람 수정의 차이를 날짜별로 남긴다 — 랭킹을 고칠 근거(briefing.ts DailyEdits)
            autoSuggested: {
              headlines: suggested.map(h => h.url),
              top3Links: autoTop3Ids.map(linkOf).filter(Boolean),
            },
          };
      const res = await fetch('/api/digest/edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? tr('저장 실패'));
      if (reset) {
        setBriefing(suggested);
        setTop3Ids(autoTop3Ids.slice(0, 3));
        setExcluded(new Set());
        setSavedEditKey(JSON.stringify([autoTop3Ids.slice(0, 3), []]));
        setBriefingSaved(false);
        setBriefingMsg({ ok: true, text: tr('편집을 지웠습니다. 발송 시점에 자동 선정됩니다.') });
      } else {
        setSavedEditKey(editKey);
        setBriefingSaved(true);
        setBriefingMsg({ ok: true, text: tr('저장했습니다. 오늘 10:30 메일과 브리핑에 반영됩니다.') });
      }
      setBriefingDirty(false);
    } catch (e: any) {
      setBriefingMsg({ ok: false, text: String(e?.message ?? e) });
    } finally {
      setBriefingBusy(false);
    }
  }

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
    const chosen = top3Ids.map(id => { const a = byId.get(id); return a && articleTitle(a, locale); }).filter(Boolean);
    const actualRecipient = testEmail.trim() || recipient || tr('(환경변수 수신자)');
    const msg = `${tr('실제로 다이제스트를 발송합니다.')}\n\n${tr('수신')}: ${actualRecipient}${testEmail.trim() ? ` (${tr('테스트')})` : ''}\nTOP 3:\n${chosen.map((t, i) => `  ${i + 1}. ${t}`).join('\n') || `  (${tr('자동 선정')})`}\n\n${tr('발송하시겠습니까?')}`;
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
      if (res.ok && data.ok) setSendMsg({ ok: true, text: `${tr('발송 완료')}: ${data.recipient ?? recipient}` });
      else setSendMsg({ ok: false, text: data.error ?? tr('발송 실패') });
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
          <div className="font-bold mb-2">✍️ {tr('편집자 한 줄')}</div>
          <textarea
            value={editorIntro}
            onChange={e => setEditorIntro(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:border-spark-purple focus:outline-none focus:ring-1 focus:ring-spark-purple"
            placeholder={tr('메일 상단에 들어갈 편집자 한 줄 인사')}
          />
        </section>

        {/* TOP 3 */}
        <section className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-1">⭐ {tr('오늘의 핵심 TOP 3')} <span className="text-xs font-normal text-gray-400">{tr('(스크랩 우선 자동 선정 · 순서/포함 조정 가능)')}</span></div>
          <p className={`text-xs mb-1 ${mailDirty ? 'text-amber-600' : 'text-gray-400'}`}>
            {mailDirty
              ? tr('바뀐 내용이 아직 저장되지 않았습니다 — 아래 [오늘 편집 저장]을 눌러야 10:30 자동 메일에 반영됩니다.')
              : tr('[오늘 편집 저장]한 TOP 3·제외 기사는 10:30 자동 메일에도 그대로 반영됩니다.')}
          </p>
          {top3Ids.length === 0 && <p className="text-sm text-gray-400 py-2">{tr('선택된 TOP 3가 없습니다. 아래 후보에서')} <b>{tr('TOP3 추가')}</b>{tr('로 최대 3개까지 올리세요.')}</p>}
          <div className="space-y-2 mt-2">
            {top3Ids.map((id, idx) => {
              const a = byId.get(id);
              if (!a) return null;
              return (
                <div key={id} className="flex items-start gap-2 rounded-lg border border-spark-light-purple bg-spark-light-purple/20 p-2.5">
                  <div className="text-sm font-bold text-spark-purple w-6 text-center">#{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{a.isScrapped ? '⭐ ' : ''}{articleTitle(a, locale)}</div>
                    <div className="text-xs text-gray-500">{tr(CAT_LABEL[a.category] ?? a.category)} · {tr(a.source)}</div>
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

        {/* 데일리 브리핑 헤드라인 — 추천 5개가 기본, 슬롯마다 [바꾸기]로 다른 기사와 교체 */}
        <section className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="font-bold">🎬 {tr('오늘 브리핑 헤드라인')} <span className="text-xs font-normal text-gray-400">({briefing.length}/{BRIEFING_MAX})</span></div>
            <button onClick={refreshReco} disabled={recoBusy} className="shrink-0 rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {recoBusy ? tr('추천 계산 중…') : `🔄 ${tr('추천 다시 받기')}`}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            {briefingSaved && !briefingDirty && !mailDirty
              ? tr('저장됨 — 발송 때 이 목록으로 영상을 만듭니다.')
              : tr('아직 저장 안 됨 — 저장하지 않으면 🤖 추천 5개가 그대로 나갑니다.')}
            {reco && <span className="text-gray-400"> · {reco.method === 'ai' ? tr('🤖 AI 추천') : tr('⚙️ 중요도 순 추천')} {fmtTime(reco.computedAt)} {tr('기준')}</span>}
          </p>
          <div className="space-y-2">
            {briefing.map((h, idx) => (
              <div key={h.ref} className={`flex items-start gap-2 rounded-lg border p-2.5 ${replaceIdx === idx ? 'border-spark-purple bg-spark-light-purple/20' : 'border-gray-200'}`}>
                <div className="text-sm font-bold text-spark-purple w-6 text-center">{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{recoUrls.has(h.url) && <span title={tr('추천')}>🤖 </span>}{h.title}</div>
                  <div className="text-xs text-gray-500">{tr(h.label)} · {tr(h.source)}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setReplaceIdx(replaceIdx === idx ? null : idx)} className={`px-2 py-0.5 text-xs rounded border ${replaceIdx === idx ? 'border-spark-purple bg-spark-purple text-white' : 'border-spark-purple text-spark-purple hover:bg-spark-light-purple/30'}`}>{replaceIdx === idx ? tr('취소') : tr('바꾸기')}</button>
                  <button onClick={() => moveBriefing(idx, -1)} disabled={idx === 0} className="px-1.5 py-0.5 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30">▲</button>
                  <button onClick={() => moveBriefing(idx, 1)} disabled={idx === briefing.length - 1} className="px-1.5 py-0.5 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30">▼</button>
                  <button onClick={() => { setReplaceIdx(null); editBriefing(prev => prev.filter(x => x.ref !== h.ref)); }} className="px-1.5 py-0.5 text-xs rounded border border-red-200 text-red-600 hover:bg-red-50">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* 교체·추가 후보 — [바꾸기]를 누른 자리가 있으면 그 자리를 바꾸고, 없으면 빈자리에 추가한다 */}
          {(replaceIdx !== null || briefing.length < BRIEFING_MAX) && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">
                {replaceIdx !== null
                  ? tr('{n}번 자리에 넣을 기사를 고르세요', { n: replaceIdx + 1 })
                  : tr('빈자리에 넣을 기사를 고르세요')}
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  value={pickQuery}
                  onChange={e => setPickQuery(e.target.value)}
                  placeholder={tr('제목·매체·요약 검색')}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-spark-purple"
                />
                {(['all', 'intra', 'inter'] as const).map(k => (
                  <button key={k} onClick={() => setPickKind(k)} className={`rounded-lg border px-2 py-1 text-[11px] ${pickKind === k ? 'border-spark-purple bg-spark-purple text-white' : 'border-gray-300 bg-white text-gray-600'}`}>
                    {k === 'all' ? tr('전체') : k === 'intra' ? tr('국내') : tr('해외')}
                  </button>
                ))}
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {pickList.length === 0 && <p className="text-xs text-gray-400 py-2">{tr('조건에 맞는 기사가 없습니다.')}</p>}
                {pickList.map(c => (
                  <div key={c.ref} className="flex items-center gap-2 rounded border border-gray-100 bg-white p-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-gray-800">{recoUrls.has(c.url) && '🤖 '}{c.title}</div>
                      <div className="text-[11px] text-gray-400">
                        {tr(c.label)} · {tr(c.source)} · {c.pubDate.slice(5, 10).replace('-', '/')}
                        {c.importance && (c.importance === 'HIGH' || c.importance === 'CRITICAL') && <span className="ml-1 font-semibold text-amber-600">{c.importance}</span>}
                        {c.matchCount ? ` · ${tr('포트폴리오 연결 {n}', { n: c.matchCount })}` : ''}
                      </div>
                    </div>
                    <button onClick={() => pickCandidate(c)} className="shrink-0 px-2 py-0.5 text-[11px] rounded border border-spark-purple text-spark-purple hover:bg-spark-light-purple/30">
                      {replaceIdx !== null ? tr('이걸로 바꾸기') : tr('추가')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button onClick={() => saveEdits()} disabled={briefingBusy} className="flex-1 rounded-lg bg-spark-purple py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
              {briefingBusy ? tr('저장 중…') : `💾 ${tr('오늘 편집 저장 (메일 TOP 3 · 제외 · 브리핑)')}`}
            </button>
            {briefingSaved && (
              <button onClick={() => saveEdits(true)} disabled={briefingBusy} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">{tr('자동 선정으로 되돌리기')}</button>
            )}
          </div>
          {briefingMsg && (
            <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${briefingMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{briefingMsg.text}</div>
          )}
        </section>

        {/* 카테고리별 요약 + 후보 기사 */}
        {CATS.map(([cat, label]) => {
          const list = candidates.filter(c => c.category === cat);
          return (
            <section key={cat} className="bg-white p-5 rounded-xl border border-gray-200">
              <div className="font-bold mb-2">{tr(label)} <span className="text-xs font-normal text-gray-400">({tr('{n}건', { n: list.length })})</span></div>
              <textarea
                value={summaries[cat] ?? ''}
                onChange={e => setSummaries(s => ({ ...s, [cat]: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-gray-200 p-2.5 text-sm mb-3 focus:border-spark-purple focus:outline-none focus:ring-1 focus:ring-spark-purple"
                placeholder={tr('{label} 섹션 상단에 넣을 요약 한 줄 (선택)', { label: tr(label) })}
              />
              {list.length === 0 ? (
                <p className="text-xs text-gray-400">{tr('이 카테고리 후보 기사가 없습니다.')}</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {list.map(a => {
                    const isExcluded = excluded.has(a.id);
                    const inTop3 = top3Ids.includes(a.id);
                    return (
                      <div key={a.id} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${isExcluded ? 'border-gray-100 bg-gray-50 opacity-50' : 'border-gray-100'}`}>
                        <div className="flex-1 min-w-0">
                          <div className={`truncate ${isExcluded ? 'line-through text-gray-400' : 'text-gray-800'}`}>{a.isScrapped ? '⭐ ' : ''}{articleTitle(a, locale)}</div>
                          <div className="text-[11px] text-gray-400">{tr(a.source)} · {tr(a.matchedKeyword)}{a.pitchScore >= 60 ? ` · ${tr('피칭')} ${a.pitchScore}` : ''}</div>
                        </div>
                        {!inTop3 && !isExcluded && (
                          <button onClick={() => addTop3(a.id)} disabled={top3Ids.length >= 3} className="shrink-0 px-2 py-0.5 text-[11px] rounded border border-spark-purple text-spark-purple hover:bg-spark-light-purple/30 disabled:opacity-30" title={top3Ids.length >= 3 ? tr('TOP3가 이미 3개입니다') : ''}>{tr('TOP3 추가')}</button>
                        )}
                        <button onClick={() => toggleExclude(a.id)} className={`shrink-0 px-2 py-0.5 text-[11px] rounded border ${isExcluded ? 'border-gray-300 text-gray-500' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
                          {isExcluded ? tr('되돌리기') : tr('제외')}
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
            <div className="font-bold">👁 {tr('실제 발송 미리보기')} {previewLoading && <span className="text-xs font-normal text-gray-400">{tr('갱신 중…')}</span>}</div>
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
                {sending ? tr('발송 중…') : `📤 ${tr('지금 발송하기')}`}
              </button>
              <div className="mt-2 flex gap-2 items-center">
                <input
                  type="email"
                  placeholder={tr('테스트 수신 이메일 (비우면 실제 수신자)')}
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-spark-purple"
                />
              </div>
              <p className="mt-1 text-center text-xs text-gray-400">
                {testEmail.trim() ? `${tr('테스트 수신')}: ${testEmail.trim()}` : `${tr('수신')}: ${recipient || tr('(환경변수 수신자)')}`}
              </p>
            </>
          ) : (
            <p className="text-center text-sm text-gray-500 py-2">{tr('발송 권한이 없습니다. (관리자 계정만 발송 가능)')}</p>
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
