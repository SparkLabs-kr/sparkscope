import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

const SYSTEM = `당신은 SparkScope 포트폴리오팀의 트렌드 영향 분석가입니다.
해외 AI/바이오 업계 뉴스에서 발생한 기술·투자·규제·시장 변화가
우리 포트폴리오 회사들의 비즈니스에 어떤 영향(긍정/부정)을 줄 수 있는지 분석합니다.

영향 유형:
- 경쟁 압박: 새로운 기술/제품 출시로 경쟁 심화
- 기회: 시장 기술 트렌드 전환으로 인한 성장 기회
- 규제: 새 규제/정책으로 인한 콤플라이언스 비용 또는 시장 제한
- 기술 기반: 새 기술의 기초 기술이 우리 회사의 핵심 분야
- 투자 영역: 투자 자금 흐름 변화로 인한 펀딩 환경 변화

기준을 엄격하게 적용하세요. "~할 수도 있다", "간접적으로 확대될 가능성" 같은
막연한 개연성만으로는 매칭하지 마세요 — 같은 논리를 아무 회사에나 갖다 붙일 수 있다면
매칭 대상이 아닙니다. 기사 내용과 회사의 실제 사업 사이에 구체적이고 설명 가능한
연결고리가 있는 경우만 포함하세요. 대부분의 기사는 매칭되는 포트폴리오사가 0~2개인 것이
정상입니다.

응답은 반드시 valid JSON 배열만.`;

interface CompanyProfile {
  name: string;
  sector: string;
  description: string;
}

function buildUserPrompt(
  articleTitle: string,
  articleReason: string,
  companies: CompanyProfile[]
): string {
  return `다음 해외 트렌드 뉴스를 분석하고, 우리 포트폴리오 회사들에 미칠 영향을 평가하세요.

=== 기사 ===
제목: ${articleTitle}
분류: ${articleReason}

=== 우리 포트폴리오 회사 ===
${companies.map((c, i) => `${i + 1}. ${c.name} (${c.sector}) — ${c.description}`).join('\n')}

=== 분석 ===
각 회사가 이 뉴스로부터 받을 영향을 분석하세요.
- 직접 영향: 회사명 언급, 기술/제품 직접 관련
- 간접 영향: 같은 섹터의 구체적 경쟁사 발표, 이 기사와 직접 연결되는 규제 변화 —
  "관련 산업이니까 언젠가 영향 있을 수 있다" 수준은 제외

가장 관련 높은 회사 **최대 3개까지만** 반환하세요. 억지로 채우지 말고, 진짜 없으면 빈 배열을 반환하세요.

출력 스키마: [{ "company": "<회사명>", "reason": "<구체적 영향 한 줄>" }]
JSON만 반환 (마크다운 없음):`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

type PortfolioMatch = { company: string; reason: string };

async function analyzeArticleForPortfolio(
  client: OpenAI,
  articleTitle: string,
  articleReason: string,
  companies: CompanyProfile[]
): Promise<PortfolioMatch[]> {
  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-5.4-mini',
      max_completion_tokens: 3000,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(articleTitle, articleReason, companies) },
      ],
    });

    const text = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(extractJson(text)) as PortfolioMatch[];
    const seen = new Set<string>();
    return parsed.filter(m => {
      if (!m.company || !m.reason || seen.has(m.company)) return false;
      seen.add(m.company);
      return true;
    });
  } catch (e: any) {
    console.error(`[Inter] Portfolio matching 실패: ${e.message}`);
    return [];
  }
}

export async function matchInterNewsWithPortfolio(
  verdictIds: string[]
): Promise<{ matched: number; failed: string[] }> {
  if (verdictIds.length === 0) {
    return { matched: 0, failed: [] };
  }

  console.log(`[Inter] 포트폴리오 매칭 시작: ${verdictIds.length}건`);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  // 1. 판정 조회 (relevant=true인 것만)
  const verdicts = await prisma.interNewsVerdict.findMany({
    where: {
      id: { in: verdictIds },
      relevant: true,
    },
    include: { news: true },
  });

  if (verdicts.length === 0) {
    console.log('[Inter] 관련 기사 없음 (모두 노이즈)');
    return { matched: 0, failed: [] };
  }

  // 2. 포트폴리오 회사 목록 조회 (프로필 포함)
  const portfolioCompanies = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company', status: 'ACTIVE' },
    select: { name: true, englishName: true, notes: true, tier: true },
  });

  if (portfolioCompanies.length === 0) {
    console.log('[Inter] 포트폴리오 회사 없음');
    return { matched: 0, failed: [] };
  }

  // 회사 프로필 구성 (notes에서 섹터/설명 추출, 없으면 기본값)
  const companyProfiles: CompanyProfile[] = portfolioCompanies.map(c => ({
    name: c.name,
    sector: c.notes ? c.notes.split('\n')[0] : '미분류',
    description: c.notes || `${c.englishName || c.name}`,
  }));

  const failed: string[] = [];
  let matched = 0;

  // 3. 각 기사에 대해 포트폴리오 매칭 분석
  for (const verdict of verdicts) {
    try {
      const matches = await analyzeArticleForPortfolio(
        client,
        verdict.news.title,
        verdict.reason,
        companyProfiles
      );

      // 4. 매칭 결과를 DB에 저장
      for (const match of matches) {
        try {
          await prisma.interPortfolioMatch.create({
            data: {
              verdictId: verdict.id,
              companyName: match.company,
              reason: match.reason,
              model: 'gpt-5.4-mini',
              matchedAt: new Date(),
            },
          });
          matched++;
        } catch (e: any) {
          if (!e.message.includes('Unique constraint')) {
            console.error(`[Inter] 매칭 저장 실패 (${match.company}): ${e.message}`);
            failed.push(match.company);
          }
        }
      }

      // API 레이트 리미트 방지
      await new Promise(r => setTimeout(r, 300));
    } catch (e: any) {
      console.error(`[Inter] 기사 분석 실패 (${verdict.news.title}): ${e.message}`);
      failed.push(verdict.news.source);
    }
  }

  console.log(`[Inter] 포트폴리오 매칭 완료: ${matched}건 매칭, ${failed.length}개 오류`);
  return { matched, failed };
}
