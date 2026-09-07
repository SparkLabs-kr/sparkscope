/**
 * 분석 오류 감사 — 최근 7일 부정톤/리스크플래그 포폴사·스파크랩 기사 원문을 다시 긁어와,
 * 저장된 tone·riskFlag·oneLiner가 실제 본문과 맞는지 재검증한다.
 *
 * 2026-09-07 실사용에서 확인된 실제 사례:
 *   ① 스카이랩스 "160% 급등" 기사에 AI가 본문에 없는 "15% 하락"을 지어내 tone=NEGATIVE.
 *   ② H2U(대만) 1분기 재무공시 기사에 다른(상반기) 공시 기사의 숫자가 잘못 붙음.
 *
 * ★ 판정 기준은 "톤이 얼마나 부정적인가"가 아니라 "본문에 없는 사실을 지어냈는가 /
 *   요약이 가리키는 회사·사건이 실제로 이 기사의 것인가"로 좁힌다. 첫 버전 프롬프트는
 *   전자를 물어서 45건 중 30건을 오탐으로 걸렀다 — IPO 경쟁률 저조·투자주의종목 지정처럼
 *   원래 정당하게 부정적인 뉴스까지 "이상하다"고 잡아냈다. 감사 자체가 오탐 덩어리면
 *   검수 화면만 쌓이고 아무도 안 보게 된다.
 *
 * 자동으로 Article.tone/riskFlag를 고치지 않는다 — 사람이 검수 화면에서 최종 확인한다.
 */
import { prisma } from '@/lib/prisma';
import { resolveGoogleNewsUrl } from './google-news-resolver';
import { scrapeArticleBody } from './scraper';
import OpenAI from 'openai';

const AUDIT_WINDOW_DAYS = 7;
const MODEL = 'gpt-4o-mini';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

interface Verdict {
  /** true면 실제로 사실 왜곡·엔티티 불일치가 있다는 뜻(=검수 큐에 올린다) */
  flagged: boolean;
  issue: string;
}

async function verify(title: string, body: string, oneLiner: string, tone: string | null, riskFlag: string | null): Promise<Verdict> {
  const prompt = `아래 기사 제목·본문과, 우리 시스템이 이미 저장해 둔 AI 분석 결과가 있다.

★ 판정 기준을 정확히 지켜라 — 톤이 "얼마나" 부정적인지는 절대 묻지 않는다. 두 가지만 확인한다:
1) oneLiner가 본문에 없는 구체적 사실(숫자·사건·결과)을 지어냈는가?
2) oneLiner·분석 결과가 가리키는 회사·사건이 본문의 것과 다른가(엔티티 불일치)?

이 두 가지가 아니면 절대 flagged=true로 답하지 마라. 예를 들어 "IPO 청약 경쟁률이 낮았다",
"투자주의종목으로 지정됐다" 같은 문장은 원문에 그 내용이 있으면 정당한 부정 뉴스이지
오류가 아니다. "본문에 실제로 있는 사실을 부정적으로 요약했다"는 이유만으로는 flagged=false다.

[제목] ${title}
[본문] ${body.slice(0, 1500)}

[저장된 분석]
oneLiner: ${oneLiner}
tone: ${tone}
riskFlag: ${riskFlag}

JSON만 반환: {"flagged": true|false, "issue": "무엇이 지어낸 사실이거나 엔티티 불일치인지 한 줄 (flagged=false면 빈 문자열)"}`;

  const resp = await client().chat.completions.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  try {
    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as Partial<Verdict>;
    return { flagged: !!parsed.flagged, issue: parsed.issue ?? '' };
  } catch {
    return { flagged: false, issue: '' };
  }
}

export interface AuditResult {
  checked: number;
  scrapeFailed: number;
  flagged: number;
  skippedAlreadyFlagged: number;
}

export async function runAnalysisAudit(): Promise<AuditResult> {
  const since = new Date(Date.now() - AUDIT_WINDOW_DAYS * 86400_000);

  const candidates = await prisma.article.findMany({
    where: {
      pubDate: { gte: since },
      isNoise: false,
      category: { in: ['portfolio_company', 'portfolio_company_tw', 'sparklabs_self'] },
      OR: [{ tone: 'NEGATIVE' }, { riskFlag: { not: null } }],
    },
    select: { id: true, title: true, link: true, oneLiner: true, tone: true, riskFlag: true },
    orderBy: { pubDate: 'desc' },
  });

  // 이미 큐에 올라간 적 있는 기사는 다시 안 건드린다(승인/기각 여부와 무관하게) —
  // 7일 창이 매주 겹치는 구간(경계 며칠)에서 같은 기사를 반복 재검증하지 않기 위함.
  const alreadyFlagged = new Set(
    (await prisma.analysisAuditFlag.findMany({ where: { articleId: { in: candidates.map(c => c.id) } }, select: { articleId: true } }))
      .map(f => f.articleId),
  );
  const targets = candidates.filter(c => !alreadyFlagged.has(c.id));

  let checked = 0, scrapeFailed = 0, flagged = 0;

  for (const a of targets) {
    try {
      const realUrl = a.link.includes('news.google.com') ? await resolveGoogleNewsUrl(a.link) : a.link;
      if (!realUrl) { scrapeFailed++; continue; }
      const body = await scrapeArticleBody(realUrl);

      // 본문이 너무 짧으면(재수집 실패 가능성) 판정하지 않고 '재확인 필요'로만 큐에 올린다 —
      // 오브젠 사례(무관한 게시판 목록이 긁힘)처럼, 잘못 긁힌 본문으로 "일치/불일치"를
      // 판단하면 그 자체가 또 다른 오탐 원인이 된다.
      if (!body?.text || body.text.length < 200) {
        scrapeFailed++;
        await prisma.analysisAuditFlag.create({
          data: {
            articleId: a.id,
            snapshotTone: a.tone, snapshotRiskFlag: a.riskFlag, snapshotOneLiner: a.oneLiner,
            issue: '원문 재수집 실패 또는 본문이 비정상적으로 짧음 — 자동 판정 불가, 원문 링크를 직접 확인하세요.',
            confidence: 'low',
          },
        });
        continue;
      }

      const v = await verify(a.title, body.text, a.oneLiner ?? '', a.tone, a.riskFlag);
      checked++;
      if (v.flagged) {
        flagged++;
        await prisma.analysisAuditFlag.create({
          data: {
            articleId: a.id,
            snapshotTone: a.tone, snapshotRiskFlag: a.riskFlag, snapshotOneLiner: a.oneLiner,
            issue: v.issue,
            confidence: 'high',
          },
        });
      }
    } catch (e) {
      scrapeFailed++;
      console.error('[analysis-audit] 기사 검증 실패:', a.title.slice(0, 40), (e as Error).message);
    }
  }

  return { checked, scrapeFailed, flagged, skippedAlreadyFlagged: alreadyFlagged.size };
}
