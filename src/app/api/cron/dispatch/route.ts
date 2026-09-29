// GitHub Actions 워크플로를 "지금" 실행시킨다(workflow_dispatch). Vercel 크론이 부른다.
//
// 왜 필요한가 — GitHub의 schedule 트리거는 예약 시각보다 2~3시간씩 늦게 시작했다
// (9/11~9/28 실측: 06:13 예약 → 08:03~09:06 시작). 반면 Vercel 크론은 제시각에 돌고,
// API로 요청한 workflow_dispatch는 곧바로 시작한다. 그래서 "언제"는 Vercel이, "무엇을"
// (1시간짜리 수집·영상 렌더링 — Vercel 300초 제한을 넘는 일)은 GitHub Actions가 맡는다.
//
// 필요한 것: Vercel 환경변수 GITHUB_DISPATCH_TOKEN — 이 저장소 Actions 쓰기 권한만 가진
// fine-grained 토큰. 없으면 500을 내고, 워크플로의 기존 schedule이 예비로 돈다.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const REPO = 'SparkLabs-kr/sparkscope';
// 실행을 허용하는 워크플로만 — 쿼리로 아무 워크플로나 돌릴 수 없게.
const ALLOWED = new Set(['daily-collect.yml', 'daily-briefing.yml']);

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workflow = new URL(req.url).searchParams.get('workflow') ?? '';
  if (!ALLOWED.has(workflow)) return NextResponse.json({ error: `허용되지 않은 워크플로: ${workflow}` }, { status: 400 });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    console.error('[dispatch] GITHUB_DISPATCH_TOKEN 없음 — 워크플로의 예비 schedule에 맡긴다');
    return NextResponse.json({ ok: false, error: 'GITHUB_DISPATCH_TOKEN not set' }, { status: 500 });
  }
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (r.status !== 204) {
    const text = await r.text();
    console.error(`[dispatch] ${workflow} 실행 요청 실패 ${r.status}: ${text.slice(0, 300)}`);
    return NextResponse.json({ ok: false, status: r.status, error: text.slice(0, 300) }, { status: 502 });
  }
  console.log(`[dispatch] ${workflow} 실행 요청 완료`);
  return NextResponse.json({ ok: true, workflow });
}
