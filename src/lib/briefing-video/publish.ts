/**
 * 만든 영상을 Supabase Storage(공개 버킷 'briefings')에 올리고, 주소를 DB(DashboardInsight
 * kind='briefing_video', key=날짜)에 기록한다. 잔디 알림·브리핑 페이지가 이 기록을 읽는다.
 *
 * 공개 버킷인 이유: 잔디에서 누르면 로그인 없이 바로 재생돼야 한다(출근길 휴대폰). 영상 내용은
 * 공개 기사 헤드라인뿐이고, 포트폴리오 매칭 같은 내부 분석은 대본에 넣지 않는다(CLAUDE.md 파트너 규칙과 같은 기준).
 * 업로드에는 비밀키가 필요하다 — GitHub Actions 시크릿 SUPABASE_SERVICE_ROLE_KEY. 새 방식 Secret key(sb_secret_…)나
 * 예전 방식 service_role 키 둘 다 된다.
 */
import { readFile } from 'fs/promises';
import { prisma } from '@/lib/prisma';
import type { BuiltBriefing } from './build';

const BUCKET = 'briefings';
export const KIND_VIDEO = 'briefing_video';

export interface BriefingVideoRecord {
  dateKey: string;
  url: string;
  seconds: number;
  headlines: { title: string; url: string; label: string; source: string }[];
  script: string[];
  publishedAt: string;
}

export async function publishBriefingVideo(built: BuiltBriefing): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다');

  // 흔한 실수: 공개키(anon·sb_publishable_)를 넣으면 RLS에 막혀 403 "row-level security"가 난다.
  if (keyRole(key) !== 'service') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 에 공개키(anon/publishable)가 들어 있습니다 — Supabase → Settings → API Keys의 Secret key(sb_secret_…) 또는 Legacy 탭의 service_role 키를 넣어 주세요');
  }
  const objectPath = `${built.snapshot.dateKey}/briefing.mp4`;
  const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      // 새 방식 비밀키(sb_secret_…)는 JWT가 아니라 apikey 헤더로만 보낸다(게이트웨이가 권한을 붙여 준다).
      // 예전 service_role 키(JWT)는 Authorization에도 싣는다. 둘 다 받게 해 둔다.
      ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }),
      apikey: key,
      'content-type': 'video/mp4',
      'x-upsert': 'true',            // 같은 날 다시 만들면 덮어쓴다
      'cache-control': '300',
    },
    body: await readFile(built.file),
  });
  if (!r.ok) throw new Error(`스토리지 업로드 실패 ${r.status}: ${(await r.text()).slice(0, 300)}`);
  // 덮어쓴 뒤 CDN 캐시가 옛 영상을 주지 않게 버전 쿼리를 붙인다.
  const url = `${base}/storage/v1/object/public/${BUCKET}/${objectPath}?v=${Date.now()}`;

  const record: BriefingVideoRecord = {
    dateKey: built.snapshot.dateKey,
    url,
    seconds: Math.round(built.seconds),
    headlines: built.snapshot.headlines.map(h => ({ title: h.title, url: h.url, label: h.label, source: h.source })),
    script: built.segments.map(s => s.text),
    publishedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(record);
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_VIDEO, key: record.dateKey } },
    create: { kind: KIND_VIDEO, key: record.dateKey, value },
    update: { value },
  });
  return url;
}

function keyRole(key: string): 'service' | 'public' {
  if (key.startsWith('sb_secret_')) return 'service';
  if (key.startsWith('sb_publishable_')) return 'public';
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return payload.role === 'service_role' ? 'service' : 'public';
  } catch {
    return 'service'; // 모르는 형식은 서버가 판단하게 둔다
  }
}

export async function loadBriefingVideo(dateKey: string): Promise<BriefingVideoRecord | null> {
  const row = await prisma.dashboardInsight.findUnique({
    where: { kind_key: { kind: KIND_VIDEO, key: dateKey } },
    select: { value: true },
  });
  if (!row) return null;
  try { return JSON.parse(row.value) as BriefingVideoRecord; } catch { return null; }
}
