import { Pool } from 'pg';

export interface FundItem {
  name: string;
  vintage: number | null;
  aum: number; // 억 원 (holding_funds에는 없어 0으로 고정)
  maturityDate: string | null; // ISO date string (YYYY-MM-DD)
  status?: string | null;
}

export interface CompetitorFundSummary {
  investorName: string;
  fundCount: number;
  totalAum: number; // 억 원 단위
  topSectors: string[];
  funds: FundItem[];
}

// sparkscope 경쟁사명 → SLAB DB investor_name 매핑
const INVESTOR_NAME_MAP: Record<string, string> = {
  '미래에셋벤처투자': '미래에셋벤처투자',
  '카카오인베스트먼트': '카카오벤처스',
  '카카오벤처스': '카카오벤처스',
  '본엔젤스': '본엔젤스벤처파트너스',
  '본엔젤스벤처파트너스': '본엔젤스벤처파트너스',
  '패스트벤처스': '패스트벤처스',
  '퓨처플레이': '퓨처플레이',
  '해시드': '해시드벤처스',
  '스톤브릿지벤처스': '스톤브릿지벤처스',
  'IBK벤처투자': 'IBK벤처투자',
  '신한벤처투자': '신한벤처투자',
  '하나벤처스': '하나벤처스',
  '에이티넘인베스트먼트': '에이티넘인베스트먼트',
  '스마일게이트인베스트먼트': '스마일게이트인베스트먼트',
  '매쉬업벤처스': '매쉬업벤처스',
  '스프링캠프': '스프링캠프',
  // 이름 다른 케이스
  'KB인베스트먼트': '케이비인베스트먼트',
  'SV인베스트먼트': '에스브이인베스트먼트',
  'SBVA': '에스비브이에이',
  '소프트뱅크벤처스': '에스비브이에이',
  '블루포인트파트너스': 'bluepoint',
  '한국투자파트너스': '한국투자파트너스',
  '롯데벤처스': '롯데벤처스',
  'TBT': '티비티',
  'SBI인베스트먼트': '에스비아이인베스트먼트',
  '한화인베스트먼트': '한화투자증권',
  '대성창업투자': '대성창업투자',
  '캡스톤파트너스': '캡스톤파트너스',
  '쿨리지코너인베스트먼트': '쿨리지코너인베스트먼트',
  '인터베스트': '인터베스트',
  '씨엔티테크': '씨엔티테크',
  '마그나인베스트먼트': '마그나인베스트먼트',
  '우리벤처파트너스': '우리벤처파트너스',
  '스틱벤처스': '스틱벤처스',
  '유안타인베스트먼트': '유안타인베스트먼트',
  '포스코기술투자': '포스코기술투자',
  '뮤렉스파트너스': '뮤렉스파트너스',
  '디쓰리쥬빌리파트너스': '디쓰리쥬빌리파트너스',
  '마크앤컴퍼니': '마크앤컴퍼니',
  '와이앤아처': '와이앤아처',
  '소풍벤처스': '소풍벤처스',
  '프리미어파트너스': '프리미어파트너스',
  '더벤처스': '더벤처스',
  '더인벤션랩': '더인벤션랩',
  '빅뱅엔젤스': '빅뱅엔젤스',
  '시그나이트': '시그나이트',
  '스마트스터디벤처스': '스마트스터디벤처스',
  '효성벤처스': '효성벤처스',
  'GS벤처스': '500글로벌매니지먼트코리아',
  'IMM인베스트먼트': '아이엠엠인베스트먼트',
  '프라이머': '프라이머시즌5',
};

// dev HMR 시 module이 재로드되어도 기존 연결을 재사용하도록 global에 보관
declare global { var __fundPool: Pool | undefined }

function getFundPool(): Pool | null {
  const url = process.env.FUND_DB_URL;
  if (!url) return null;

  if (global.__fundPool) return global.__fundPool;

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  global.__fundPool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 5000 });
  return global.__fundPool;
}

/**
 * 펀드 DB에 연결할 수 있는 환경인지. 조회 결과가 비었을 때 "그 회사가 DB에 없다"인지
 * "DB 자체를 못 봤다"인지 구분하려고 호출부가 쓴다 — 둘을 섞으면 챗봇이 거짓말을 한다.
 */
export function isFundDbConfigured(): boolean {
  return Boolean(process.env.FUND_DB_URL);
}

export async function getCompetitorFundSummaries(
  competitorNames: string[],
): Promise<Map<string, CompetitorFundSummary>> {
  const result = new Map<string, CompetitorFundSummary>();

  const pool = getFundPool();
  if (!pool) return result;

  await Promise.all(competitorNames.map(async (name) => {
    const investorName = INVESTOR_NAME_MAP[name];
    if (!investorName) return;

    try {
      const [summaryRes, sectorRes, fundsRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(aum), 0) AS total_aum
           FROM shared_ro.external_funds
           WHERE investor_name = $1`,
          [investorName],
        ),
        pool.query(
          `SELECT unnest(sector_focus) AS sector, COUNT(*) AS cnt
           FROM shared_ro.external_funds
           WHERE investor_name = $1 AND sector_focus IS NOT NULL
           GROUP BY sector ORDER BY cnt DESC LIMIT 3`,
          [investorName],
        ),
        pool.query(
          `SELECT name, vintage, COALESCE(aum, 0) AS aum, TO_CHAR(maturity_date, 'YYYY-MM-DD') AS maturity_date
           FROM shared_ro.external_funds
           WHERE investor_name = $1
           ORDER BY vintage DESC NULLS LAST, aum DESC`,
          [investorName],
        ),
      ]);

      const fundCount = parseInt(summaryRes.rows[0].cnt, 10);
      const totalAum = Math.round(parseFloat(summaryRes.rows[0].total_aum) / 1e8);
      const topSectors = sectorRes.rows.map((r: { sector: string }) => r.sector);
      const funds: FundItem[] = fundsRes.rows.map((r: { name: string; vintage: number | null; aum: string; maturity_date: string | null }) => ({
        name: r.name,
        vintage: r.vintage,
        aum: Math.round(parseFloat(r.aum) / 1e8),
        maturityDate: r.maturity_date ?? null,
      }));

      result.set(name, { investorName, fundCount, totalAum, topSectors, funds });
    } catch (e) {
      console.error('[fund-db] query failed for', name, (e as Error).message);
    }
  }));

  return result;
}

export interface SparkLabsFundSummary {
  fundCount: number;
  totalAum: number; // 억 원
  latestVintage: number | null;
  funds: FundItem[];
}

export async function getSparkLabsFundSummary(): Promise<SparkLabsFundSummary | null> {
  const pool = getFundPool();
  if (!pool) return null;

  try {
    const res = await pool.query(
      `SELECT name, vintage, TO_CHAR(maturity_date, 'YYYY-MM-DD') AS maturity_date, status
       FROM shared_ro.holding_funds
       ORDER BY vintage DESC NULLS LAST, name ASC`,
    );

    const funds: FundItem[] = res.rows.map((r: { name: string; vintage: number | null; maturity_date: string | null; status: string | null }) => ({
      name: r.name,
      vintage: r.vintage,
      aum: 0,
      maturityDate: r.maturity_date ?? null,
      status: r.status ?? null,
    }));

    const latestVintage = funds.find(f => f.vintage)?.vintage ?? null;

    return { fundCount: funds.length, totalAum: 0, latestVintage, funds };
  } catch (e) {
    console.error('[fund-db] sparklab query failed:', (e as Error).message);
    return null;
  }
}
