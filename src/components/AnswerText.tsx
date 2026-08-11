'use client';

// 답변 본문 렌더러 — 마크다운 표·목록을 실제로 그려준다.
//
// 예전엔 whitespace-pre-wrap으로 통째로 뿌려서, "표로 정리"를 켜면
// "| 회사 | 이슈 | 의미 |" "|---|---|---|" 같은 원문이 그대로 보였다.
//
// 라이브러리를 넣지 않은 이유: 답변에 쓰이는 문법이 표·목록·굵게 정도로 좁고,
// LLM이 만든 텍스트라 형태가 일정하다. react-markdown + remark-gfm은 이 용도엔 과하다.
import React from 'react';

/** **굵게**와 `코드`만 처리한다. 나머지는 그대로 둔다. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold">{m[1]}</strong>);
    } else {
      out.push(
        <code key={`${keyPrefix}-c${i}`} className="px-1 py-0.5 rounded bg-spark-subtle text-[12px]">{m[2]}</code>
      );
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
/** |---|:---:|---| 처럼 칸 구분만 있는 줄 */
const isTableDivider = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes('-');

const splitCells = (l: string) =>
  l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function AnswerText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key} className="mb-2.5 last:mb-0">
        {inline(para.join(' '), key)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const key = `l${blocks.length}`;
    blocks.push(
      <ul key={key} className="mb-2.5 last:mb-0 space-y-1">
        {list.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-spark-purple mt-[1px] shrink-0">·</span>
            <span>{inline(item, `${key}-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
    list = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 표 — 헤더 + 구분선이 붙어 있어야 표로 본다.
    if (isTableRow(line) && isTableRow(lines[i + 1] ?? '') && isTableDivider(lines[i + 1])) {
      flushPara();
      flushList();
      const head = splitCells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(splitCells(lines[i]));
        i++;
      }
      i--; // 바깥 for가 i++ 하므로 되돌린다
      const key = `t${blocks.length}`;
      blocks.push(
        // 칸이 많으면 좁은 화면에서 넘치므로 표만 가로로 스크롤시킨다.
        <div key={key} className="mb-3 last:mb-0 -mx-1 overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr>
                {head.map((h, c) => (
                  <th
                    key={c}
                    className="text-left font-semibold text-spark-ink-soft border-b border-spark-border px-2 py-1.5 whitespace-nowrap"
                  >
                    {inline(h, `${key}-h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="align-top">
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-spark-border/50 px-2 py-1.5">
                      {inline(cell, `${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 목록
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/) ?? trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
      continue;
    }

    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }

    flushList();
    para.push(trimmed);
  }
  flushPara();
  flushList();

  return <div className="text-[14px] text-spark-ink leading-relaxed">{blocks}</div>;
}
