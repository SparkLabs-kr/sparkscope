import { Client } from 'pg';

export interface CompetitorFundSummary {
  investorName: string;
  fundCount: number;
  totalAum: number; // 억 원 단위
  topSectors: string[];
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
};

let clientCache: Client | null = null;

async function getFundClient(): Promise<Client | null> {
  const url = process.env.FUND_DB_URL;
  if (!url) return null;

  if (clientCache) return clientCache;

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    clientCache = client;
    return client;
  } catch {
    return null;
  }
}

export async function getCompetitorFundSummaries(
  competitorNames: string[],
): Promise<Map<string, CompetitorFundSummary>> {
  const result = new Map<string, CompetitorFundSummary>();

  const client = await getFundClient();
  if (!client) return result;

  for (const name of competitorNames) {
    const investorName = INVESTOR_NAME_MAP[name];
    if (!investorName) continue;

    try {
      const [fundCountRes, sectorRes] = await Promise.all([
        client.query(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(aum), 0) AS total_aum
           FROM shared_ro.external_funds
           WHERE investor_name = $1`,
          [investorName],
        ),
        client.query(
          `SELECT unnest(sector_focus) AS sector, COUNT(*) AS cnt
           FROM shared_ro.external_funds
           WHERE investor_name = $1 AND sector_focus IS NOT NULL
           GROUP BY sector ORDER BY cnt DESC LIMIT 3`,
          [investorName],
        ),
      ]);

      const fundCount = parseInt(fundCountRes.rows[0].cnt, 10);
      const totalAum = Math.round(parseFloat(fundCountRes.rows[0].total_aum) / 1e8); // 원 → 억
      const topSectors = sectorRes.rows.map((r: { sector: string }) => r.sector);

      result.set(name, { investorName, fundCount, totalAum, topSectors });
    } catch {
      // 개별 실패는 무시
    }
  }

  return result;
}
