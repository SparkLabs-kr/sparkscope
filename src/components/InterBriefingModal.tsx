'use client';

// 포트폴리오사 브리핑 미리보기 모달.
// Inter 탭 "판정 근거"의 회사 줄에서 '브리핑 생성'을 누르면 열린다.
//
// 1단계에는 포폴사 수신자 DB가 없어서 "바로 발송"은 없다 — 여기서 내용을 확인하고
// (1) HTML을 클립보드로 복사하거나 (2) 본인 메일로 받아 직접 포워딩한다.
// contactEmail이 생기면 이 모달 하단에 버튼 하나만 추가하면 된다.

import { useEffect, useState } from 'react';

export interface BriefingPayload {
  company: string;
  domainLabel: string;
  periodLabel: string;
  sector: {
    name: string;
    badgeLabel: string;
    badgeWhy: string;
    count: number;
    deltaPct: number | null;
    share: number;
    sourceCount: number;
    paperCount: number;
    matchCount: number;
  };
  overview: {
    total: number;
    deltaPct: number | null;
    sourceCount: number;
    matchCount: number;
    matchedCompanyCount: number;
    topSectors: { name: string; count: number; deltaPct: number | null }[];
  };
  articles: { title: string; url: string; media: string; date: string; reason: string; eventKey?: string | null }[];
}

export function InterBriefingModal({ payload, onClose }: { payload: BriefingPayload; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [isAi, setIsAi] = useState(false);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    fetch('/api/inter/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async res => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json?.html) {
          setError(json?.error ?? '브리핑을 만들지 못했습니다.');
          return;
        }
        setHtml(json.html);
        setIsAi(!!json.isAi);
        setCached(!!json.cached);
      })
      .catch(() => { if (!cancelled) setError('브리핑을 만들지 못했습니다.'); });
    return () => { cancelled = true; };
    // payload는 열릴 때 한 번만 쓴다(회사가 바뀌면 모달 자체가 새로 마운트됨).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC로 닫기 — 다른 모달 없이 단독으로 뜨는 화면이라 키 하나로 충분하다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    if (!html) return;
    try {
      // 메일에 붙여넣을 땐 서식이 살아야 해서 text/html로 넣고, 지원 안 되면 소스라도 넘긴다.
      if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([html], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      setNotice('복사했습니다 — 메일 본문에 붙여넣으세요.');
    } catch {
      setNotice('복사에 실패했습니다.');
    }
  }

  async function sendToMe() {
    if (sending) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch('/api/inter/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, send: true }),
      });
      const json = await res.json().catch(() => null);
      setNotice(res.ok && json?.sentTo ? `${json.sentTo} 로 보냈습니다.` : (json?.error ?? '발송에 실패했습니다.'));
    } catch {
      setNotice('발송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${payload.company} 브리핑 미리보기`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-spark-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-spark-ink">{payload.company} 브리핑</div>
            <div className="truncate text-[11px] text-spark-muted">
              {payload.domainLabel} · {payload.sector.name} · {payload.periodLabel} · 기사 {payload.articles.length}건
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 rounded px-2 py-1 text-[13px] text-spark-muted hover:bg-spark-subtle"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-slim bg-spark-subtle/50 p-3">
          {/* 안내는 미리보기 화면에만 둔다 — 아래 HTML 안에 넣으면 복사·발송될 때
              포폴사 대표에게 이 안내까지 그대로 딸려가 버린다. */}
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
            <b>보내는 방법</b> · 아래 <b>복사</b>를 누르면 서식이 살아 있는 상태로 클립보드에 담깁니다.
            Gmail·Outlook 새 메일 본문에 그대로 붙여넣어 포트폴리오사에 보내세요.
            <b>내 메일로 받기</b>를 쓰면 본인 메일함으로 받아 전달(Forward)할 수도 있습니다.
            <span className="text-amber-700"> (이 안내문은 복사·발송되는 내용에는 포함되지 않습니다.)</span>
          </div>
          {error ? (
            <div className="py-12 text-center text-[13px] text-red-600">{error}</div>
          ) : !html ? (
            <div className="py-12 text-center text-[13px] text-spark-muted">
              브리핑을 만드는 중입니다… (AI 요약에 10초 안팎 걸립니다)
            </div>
          ) : (
            <div className="rounded-lg bg-white p-2 shadow-sm" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-spark-border px-4 py-3">
          <span className="text-[11px] text-spark-muted">
            {html
              ? isAi
                ? `🤖 AI 요약 포함${cached ? ' · 이전에 만든 요약 재사용' : ''}`
                : '⚙️ 기본 요약(AI 호출 실패 — 지표 기반 문구)'
              : ''}
          </span>
          {notice && <span className="text-[11px] font-semibold text-emerald-700">{notice}</span>}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={copy}
              disabled={!html}
              className="rounded-lg border border-spark-border px-3 py-1.5 text-[12px] font-semibold text-spark-ink-soft hover:bg-spark-subtle disabled:opacity-40"
            >
              복사
            </button>
            <button
              type="button"
              onClick={sendToMe}
              disabled={!html || sending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {sending ? '보내는 중…' : '내 메일로 받기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
