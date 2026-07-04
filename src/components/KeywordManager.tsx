'use client';
import { useEffect, useMemo, useState } from 'react';

interface Target {
  id: string;
  name: string;
  englishName: string | null;
  category: string;
  status: string;
  primaryKeyword: string;
  helperKeywords: string | null;
  excludeWords: string | null;
}

const CATS = [
  { key: 'sparklabs_self', label: '스파크랩 뉴스' },
  { key: 'portfolio_company', label: '포트폴리오사' },
  { key: 'competitor', label: 'AC·VC 업계 동향' },
  { key: 'industry_trend', label: '스타트업계 뉴스' },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.key, c.label]));

const emptyForm = { name: '', englishName: '', category: 'portfolio_company', helperKeywords: '', excludeWords: '' };

export function KeywordManager() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Target>>({});

  async function load() {
    setLoading(true);
    const res = await fetch('/api/keywords', { cache: 'no-store' });
    const data = await res.json();
    setTargets(data.targets ?? []);
    setCounts(data.counts ?? {});
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    let list = targets;
    if (filter !== 'all') list = list.filter(t => t.category === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.englishName ?? '').toLowerCase().includes(q) ||
        (t.helperKeywords ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [targets, filter, search]);

  async function add() {
    setErr('');
    if (!form.name.trim()) { setErr('기업/키워드명을 입력하세요.'); return; }
    const res = await fetch('/api/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    if (!res.ok) { setErr((await res.json()).error ?? '추가 실패'); return; }
    setForm(emptyForm);
    load();
  }

  async function saveEdit() {
    if (!editId) return;
    const res = await fetch('/api/keywords', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editId, ...editForm }) });
    if (!res.ok) { setErr((await res.json()).error ?? '수정 실패'); return; }
    setEditId(null); setEditForm({}); load();
  }

  async function remove(t: Target) {
    if (!confirm(`'${t.name}'을(를) 감시대상에서 삭제할까요?\n(소프트 삭제 — 복구 가능, 수집에서 자동 제외됩니다)`)) return;
    const res = await fetch(`/api/keywords?id=${t.id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const inputCls = 'rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-spark-purple focus:outline-none';

  return (
    <div>
      {/* 추가 폼 */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 mb-4">
        <div className="font-bold mb-3">+ 감시대상 추가</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} placeholder="기업/키워드명*" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls} placeholder="영문명" value={form.englishName} onChange={e => setForm({ ...form, englishName: e.target.value })} />
          <select className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input className={`${inputCls} min-w-52`} placeholder="보조키워드(쉼표구분)" value={form.helperKeywords} onChange={e => setForm({ ...form, helperKeywords: e.target.value })} />
          <input className={`${inputCls} min-w-40`} placeholder="제외키워드(쉼표구분)" value={form.excludeWords} onChange={e => setForm({ ...form, excludeWords: e.target.value })} />
          <button onClick={add} className="rounded-lg bg-spark-purple px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">추가</button>
        </div>
        {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      </div>

      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setFilter('all')} className={tabCls(filter === 'all')}>전체 {total}</button>
        {CATS.map(c => <button key={c.key} onClick={() => setFilter(c.key)} className={tabCls(filter === c.key)}>{c.label} {counts[c.key] ?? 0}</button>)}
        <input className={`${inputCls} ml-auto`} placeholder="🔍 이름·키워드 검색" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">이름</th>
              <th className="text-left px-3 py-2">영문명</th>
              <th className="text-left px-3 py-2 w-40">카테고리</th>
              <th className="text-left px-3 py-2">보조키워드</th>
              <th className="text-right px-3 py-2 w-28">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-8">불러오는 중…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-8">결과 없음</td></tr>
            ) : shown.map(t => editId === t.id ? (
              <tr key={t.id} className="border-b border-gray-100 bg-amber-50">
                <td className="px-3 py-2"><input className={inputCls} defaultValue={t.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></td>
                <td className="px-3 py-2"><input className={inputCls} defaultValue={t.englishName ?? ''} onChange={e => setEditForm(f => ({ ...f, englishName: e.target.value }))} /></td>
                <td className="px-3 py-2">
                  <select className={inputCls} defaultValue={t.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}>
                    {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2"><input className={`${inputCls} w-full`} defaultValue={t.helperKeywords ?? ''} onChange={e => setEditForm(f => ({ ...f, helperKeywords: e.target.value }))} /></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={saveEdit} className="text-xs font-semibold text-spark-purple mr-2">저장</button>
                  <button onClick={() => { setEditId(null); setEditForm({}); }} className="text-xs text-gray-400">취소</button>
                </td>
              </tr>
            ) : (
              <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 text-gray-500">{t.englishName}</td>
                <td className="px-3 py-2"><span className="text-xs text-gray-600">{CAT_LABEL[t.category] ?? t.category}</span></td>
                <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">{t.helperKeywords}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => { setEditId(t.id); setEditForm({}); }} className="text-xs font-semibold text-gray-600 mr-2">편집</button>
                  <button onClick={() => remove(t)} className="text-xs text-red-500">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function tabCls(active: boolean) {
  return `rounded-full px-3 py-1 text-xs font-semibold border ${active ? 'bg-spark-purple text-white border-spark-purple' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`;
}
