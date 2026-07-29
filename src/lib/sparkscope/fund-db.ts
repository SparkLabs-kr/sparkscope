import { Pool } from 'pg';

export interface FundItem {
  name: string;
  vintage: number | null;
  aum: number; // 억 원
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
};

let poolCache: Pool | null = null;

function getFundPool(): Pool | null {
  const url = process.env.FUND_DB_URL;
  if (!url) return null;
  if (poolCache) return poolCache;

  // connectionString으로 넘기면 pg가 sslmode를 덮어써서 인증서 검증 실패.
  // URL을 직접 파싱해서 각 파라미터로 넘겨야 ssl 옵션이 제대로 적용됨.
  const u = new URL(url);
  poolCache = new Pool({
    host: u.hostname,
    port: parseInt(u.port || '6543'),
    database: u.pathname.replace('/', ''),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: false,
    max: 5,
  });
  return poolCache;
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
          `SELECT name, vintage, COALESCE(aum, 0) AS aum
           FROM shared_ro.external_funds
           WHERE investor_name = $1
           ORDER BY vintage DESC NULLS LAST, aum DESC`,
          [investorName],
        ),
      ]);

      const fundCount = parseInt(summaryRes.rows[0].cnt, 10);
      const totalAum = Math.round(parseFloat(summaryRes.rows[0].total_aum) / 1e8);
      const topSectors = sectorRes.rows.map((r: { sector: string }) => r.sector);
      const funds: FundItem[] = fundsRes.rows.map((r: { name: string; vintage: number | null; aum: string }) => ({
        name: r.name,
        vintage: r.vintage,
        aum: Math.round(parseFloat(r.aum) / 1e8),
      }));

      result.set(name, { investorName, fundCount, totalAum, topSectors, funds });
    } catch {
      // 개별 실패는 무시
    }
  }));

  return result;
}

