import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

// 프롬프트 구성 원칙 (2026-08-05 비용 사고 후 정리) — 순서를 바꾸지 말 것:
//
// 회사 목록(258개, 약 9,200토큰)은 매 호출 동일하고 기사만 달라진다. 그래서 고정부는
// 전부 system 메시지에 두고 user 메시지에는 기사만 넣는다. OpenAI 프롬프트 캐싱은
// "앞부분이 완전히 동일한 프리픽스"에만 걸리므로, 예전처럼 기사를 회사 목록보다 앞에
// 두면 프리픽스가 매번 달라져 캐시가 한 번도 안 걸린다.
//   → 2026-08-05, 기사 784건을 매칭하면서 같은 9,200토큰을 784번 전액 결제했고
//     그날 크레딧이 소진됐다. 기사를 user로 분리한 게 이 사고의 수정이다.
//
// 또한 기사 1건당 1호출이던 것을 BATCH_SIZE건씩 묶어 호출 수를 1/10로 줄였다.
const MODEL = 'gpt-5.4-mini';

// 한 호출에 넣을 기사 수. 늘리면 호출 수는 줄지만 응답이 잘릴 위험이 커진다
// (잘리면 analyzeBatch가 배치를 반으로 쪼개 다시 시도하므로 결과가 누락되진 않는다).
const BATCH_SIZE = 10;

// 회사 설명 길이 상한 — notes에 긴 IR 문구가 들어와도 프롬프트가 무한정 커지지 않게.
const MAX_DESC_CHARS = 120;

const SYSTEM_RULES = `당신은 SparkScope 포트폴리오팀의 트렌드 영향 분석가입니다.
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
  /** 화면·프롬프트에 쓸 한 줄 소개. sector와 description이 같던 중복을 합친 결과. */
  profile: string;
}

/** 캐시가 걸리는 고정 프리픽스 — 회사 목록과 분석 규칙까지 전부 여기 담는다. (export는 특정 회사만 골라 재매칭하는 일회성 스크립트용) */
export function buildSystemPrompt(companies: CompanyProfile[]): string {
  return `${SYSTEM_RULES}

=== 우리 포트폴리오 회사 ===
${companies.map((c, i) => `${i + 1}. ${c.name} — ${c.profile}`).join('\n')}

=== 분석 기준 ===
각 회사가 뉴스로부터 받을 영향을 분석하세요.
- 직접 영향: 회사명 언급, 기술/제품 직접 관련
- 간접 영향: 같은 섹터의 구체적 경쟁사 발표, 이 기사와 직접 연결되는 규제 변화 —
  "관련 산업이니까 언젠가 영향 있을 수 있다" 수준은 제외

기사 하나당 가장 관련 높은 회사 **최대 3개까지만** 반환하세요. 억지로 채우지 말고,
매칭되는 회사가 없는 기사는 결과에서 아예 빼세요.

출력 스키마 — 기사 번호를 반드시 포함한 평평한 배열:
[{ "article": <기사 번호>, "company": "<회사명>", "reason": "<구체적 영향 한 줄>" }]
JSON만 반환 (마크다운 없음).`;
}

/** 매 호출 달라지는 부분 — 기사만. 고정부(회사 목록)보다 뒤에 와야 캐시가 걸린다. */
function buildUserPrompt(articles: { title: string; reason: string }[]): string {
  return `다음 해외 트렌드 뉴스 ${articles.length}건을 각각 분석하세요.

${articles.map((a, i) => `[기사 ${i + 1}]\n제목: ${a.title}\n분류: ${a.reason}`).join('\n\n')}`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}

type PortfolioMatch = { company: string; reason: string };
type BatchArticle = { title: string; reason: string };

/**
 * 기사 여러 건을 한 번에 매칭한다. 반환값은 입력 배열과 같은 길이이며,
 * i번째 원소가 i번째 기사의 매칭 목록이다(매칭 없으면 빈 배열).
 *
 * 응답이 잘리거나 JSON이 깨지면 배치를 반으로 쪼개 다시 시도한다 — 배치가 통째로
 * 실패해서 "매칭 0건"으로 조용히 저장되는 일을 막기 위함이다. 끝까지 실패하면
 * null을 넣어 호출자가 "확인 못 함"을 구분할 수 있게 한다.
 *
 * (export는 오프라인 검증용 — 가짜 client를 넣어 인덱스 매핑·분할 재시도를 확인한다.)
 */
export async function analyzeBatch(
  client: OpenAI,
  systemPrompt: string,
  articles: BatchArticle[],
): Promise<(PortfolioMatch[] | null)[]> {
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      // 기사당 약 300토큰 + 여유. 배치가 커지면 함께 늘려야 응답이 안 잘린다.
      max_completion_tokens: Math.min(8000, 400 * articles.length + 600),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserPrompt(articles) },
      ],
    });

    const text = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(extractJson(text)) as { article: number; company: string; reason: string }[];
    if (!Array.isArray(parsed)) throw new Error('배열이 아닌 응답');

    const out: PortfolioMatch[][] = articles.map(() => []);
    const seen = articles.map(() => new Set<string>());
    for (const m of parsed) {
      const idx = Number(m.article) - 1; // 프롬프트는 1-based
      if (!Number.isInteger(idx) || idx < 0 || idx >= articles.length) continue;
      if (!m.company || !m.reason || seen[idx]!.has(m.company)) continue;
      if (out[idx]!.length >= 3) continue; // 프롬프트의 "최대 3개" 상한을 코드에서도 보장
      seen[idx]!.add(m.company);
      out[idx]!.push({ company: m.company, reason: m.reason });
    }
    return out;
  } catch (e: any) {
    if (articles.length === 1) {
      console.error(`[Inter] Portfolio matching 실패 (${articles[0]!.title.slice(0, 60)}): ${e.message}`);
      return [null];
    }
    // 응답 잘림·파싱 실패 — 반으로 쪼개 재시도. 최악의 경우 기사 1건씩 호출하게 되며,
    // 이는 예전(1기사=1호출) 동작과 같다. 정상 경로에서는 일어나지 않는다.
    console.error(`[Inter] 배치 ${articles.length}건 실패 (${e.message}) — 반으로 나눠 재시도`);
    const mid = Math.ceil(articles.length / 2);
    const [a, b] = await Promise.all([
      analyzeBatch(client, systemPrompt, articles.slice(0, mid)),
      analyzeBatch(client, systemPrompt, articles.slice(mid)),
    ]);
    return [...a, ...b];
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

  // 회사 프로필 구성 — notes 첫 줄이 섹터 역할을 하는데 예전엔 `sector`와 `description`에
  // 같은 문자열을 넣어서 프롬프트에 똑같은 설명이 두 번 들어갔다
  // (`제노플랜 (유전자 검사 …기업) — 유전자 검사 …기업`). 한 줄로 합치고 길이를 자른다.
  const companyProfiles: CompanyProfile[] = portfolioCompanies.map(c => {
    const raw = (c.notes ?? '').split('\n')[0]!.trim() || c.englishName || c.name;
    return {
      name: c.name,
      profile: raw.length > MAX_DESC_CHARS ? `${raw.slice(0, MAX_DESC_CHARS)}…` : raw,
    };
  });

  // 회사 목록을 포함한 고정 프리픽스 — 이 실행 내 모든 호출이 문자열을 그대로 재사용해야
  // 프롬프트 캐싱이 걸린다. 루프 안에서 다시 만들지 말 것.
  const systemPrompt = buildSystemPrompt(companyProfiles);

  const failed: string[] = [];
  let matched = 0;
  let unresolved = 0;

  const batchCount = Math.ceil(verdicts.length / BATCH_SIZE);
  console.log(
    `[Inter] 기사 ${verdicts.length}건 → ${batchCount}회 호출 (배치 ${BATCH_SIZE}건), 회사 ${companyProfiles.length}개`
  );

  // 3. 기사를 배치로 묶어 매칭 분석
  for (let i = 0; i < verdicts.length; i += BATCH_SIZE) {
    const batch = verdicts.slice(i, i + BATCH_SIZE);
    const results = await analyzeBatch(
      client,
      systemPrompt,
      batch.map(v => ({ title: v.news.title, reason: v.reason })),
    );

    // 4. 매칭 결과를 DB에 저장
    for (let j = 0; j < batch.length; j++) {
      const verdict = batch[j]!;
      const matches = results[j];
      if (matches === null || matches === undefined) {
        // 분석 자체를 못 한 기사 — 매칭 0건과 구분해서 센다. 안 그러면 429·파싱 실패가
        // "포트폴리오 매치 없음"으로 보여서 조용히 묻힌다.
        unresolved++;
        failed.push(verdict.news.source);
        continue;
      }
      for (const match of matches) {
        try {
          await prisma.interPortfolioMatch.create({
            data: {
              verdictId: verdict.id,
              companyName: match.company,
              reason: match.reason,
              model: MODEL,
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
    }

    // API 레이트 리미트 방지
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(
    `[Inter] 포트폴리오 매칭 완료: ${matched}건 매칭, 분석 실패 ${unresolved}건, 오류 ${failed.length}개`
  );
  return { matched, failed };
}
