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
  'GS벤처스': '500글로벌매니지먼트코리아', // 500 Global Korea
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
