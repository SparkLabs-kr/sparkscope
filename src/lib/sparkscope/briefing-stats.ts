/**
 * 브리핑 영상 시청 집계 — 관리자 화면과 API가 함께 쓰는 한 곳.
 *
 * 개인 정보(이름·이메일)가 나오므로 호출하는 쪽에서 반드시 관리자(ADMIN)만 허용한다.
 * 이 파일은 권한을 검사하지 않는다 — 검사는 페이지와 API 입구에서 한다.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// 부서 → 본부 매핑 (이수님 확정, 2026-10-12). 여기 한 곳만 고치면 집계에 반영된다.
// 키는 DB에 저장되는 부서 값. 시트의 '이노베이션본부'는 이노베이션팀으로 바꿔 저장한다.
export const DEPT_TO_DIVISION: Record<string, string> = {
  이노베이션팀: '액셀러레이터본부',
  배치팀: '액셀러레이터본부',
  이노베이션본부: '액셀러레이터본부', // 시트 원본 값이 남아 있을 경우 대비
  벤처본부: '벤처본부',
  경영지원본부: '경영지원본부',
  홍보팀: '커뮤니케이션본부',
  스파크바이오랩: '바이오본부',
  공동대표: '공동대표본부',
  대외협력: '대외협력',
};

export const DIVISION_ANON = '익명(잔디 등)';
export const DIVISION_UNSET = '미지정';
const DIVISION_OTHER = '기타'; // 매핑에 없는 부서 값

export function divisionOf(department: string | null | undefined): string {
  if (!department) return DIVISION_UNSET;
  return DEPT_TO_DIVISION[department] ?? DIVISION_OTHER;
}

/**
 * 방송 구분 — 브리핑 날짜의 요일로 정한다(briefing.ts broadcastFor 와 같은 규칙).
 *   all    전체
 *   weekly 위클리 = 월요일 날짜
 *   daily  데일리 = 화~금 날짜
 */
export type Program = 'all' | 'daily' | 'weekly';

export function programOf(program: string | null | undefined): Program {
  return program === 'daily' || program === 'weekly' ? program : 'all';
}

// Postgres DOW: 일=0, 월=1, … 토=6
function programClause(program: Program): Prisma.Sql {
  if (program === 'weekly') return Prisma.sql`AND EXTRACT(DOW FROM v."dateKey"::date) = 1`;
  if (program === 'daily') return Prisma.sql`AND EXTRACT(DOW FROM v."dateKey"::date) BETWEEN 2 AND 5`;
  return Prisma.empty;
}

export type DivisionRow = {
  division: string;
  viewers: number;
  opens: number;
  plays: number;
  completes: number;
  completionRate: number;
};

export type PersonRow = {
  email: string;
  name: string | null;
  department: string | null;
  division: string;
  opens: number;
  plays: number;
  completes: number;
  lastViewedAt: Date;
};

/** 브리핑 날짜 범위(KST 날짜 키, 양 끝 포함). 예: 화요일 방송만 보려면 from=to=2026-10-07 */
export type Range = { from: string; to: string };

/** 한국 기준 오늘 날짜 키(YYYY-MM-DD). */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 날짜 키에 n일을 더한다(음수 가능). */
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 범위 안의 본부별 집계. 기준은 브리핑 날짜(dateKey)다. */
export async function divisionStats(range: Range, program: Program = 'all'): Promise<DivisionRow[]> {
  const rows = await prisma.$queryRaw<
    { department: string; anonymous: boolean; viewers: bigint; opens: bigint; plays: bigint; completes: bigint }[]
  >(Prisma.sql`
    SELECT
      COALESCE(s."department", '') AS department,
      (v."subscriberId" IS NULL) AS anonymous,
      COUNT(DISTINCT COALESCE(v."subscriberId", v."visitorId")) AS viewers,
      COUNT(*) FILTER (WHERE v.event = 'open') AS opens,
      COUNT(*) FILTER (WHERE v.event = 'play') AS plays,
      COUNT(*) FILTER (WHERE v.event = 'complete') AS completes
    FROM "BriefingView" v
    LEFT JOIN "DigestSubscriber" s ON s.id = v."subscriberId"
    WHERE v."dateKey" BETWEEN ${range.from} AND ${range.to}
    ${programClause(program)}
    GROUP BY 1, 2
  `);

  // 구독자는 부서가 하나뿐이라 본부 안에서 시청자 수를 더해도 중복이 없다.
  const byDivision = new Map<string, { viewers: number; opens: number; plays: number; completes: number }>();
  for (const r of rows) {
    const division = r.anonymous ? DIVISION_ANON : r.department === '' ? DIVISION_UNSET : divisionOf(r.department);
    const acc = byDivision.get(division) ?? { viewers: 0, opens: 0, plays: 0, completes: 0 };
    acc.viewers += Number(r.viewers);
    acc.opens += Number(r.opens);
    acc.plays += Number(r.plays);
    acc.completes += Number(r.completes);
    byDivision.set(division, acc);
  }

  return [...byDivision.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([division, a]) => ({
      division,
      ...a,
      completionRate: a.plays > 0 ? Math.round((a.completes / a.plays) * 1000) / 10 : 0,
    }));
}

/** 범위·방송 구분 안에 시청한 구독자 개인별 목록. 최근 시청순. 관리자 전용. */
export async function personStats(range: Range, program: Program = 'all'): Promise<PersonRow[]> {
  const rows = await prisma.$queryRaw<
    { email: string; name: string | null; department: string | null; opens: bigint; plays: bigint; completes: bigint; last_viewed: Date }[]
  >(Prisma.sql`
    SELECT
      s.email, s.name, s."department",
      COUNT(*) FILTER (WHERE v.event = 'open') AS opens,
      COUNT(*) FILTER (WHERE v.event = 'play') AS plays,
      COUNT(*) FILTER (WHERE v.event = 'complete') AS completes,
      MAX(v."createdAt") AS last_viewed
    FROM "BriefingView" v
    JOIN "DigestSubscriber" s ON s.id = v."subscriberId"
    WHERE v."dateKey" BETWEEN ${range.from} AND ${range.to}
    ${programClause(program)}
    GROUP BY s.id, s.email, s.name, s."department"
    ORDER BY MAX(v."createdAt") DESC
  `);

  return rows.map(r => ({
    email: r.email,
    name: r.name,
    department: r.department,
    division: divisionOf(r.department),
    opens: Number(r.opens),
    plays: Number(r.plays),
    completes: Number(r.completes),
    lastViewedAt: r.last_viewed,
  }));
}
