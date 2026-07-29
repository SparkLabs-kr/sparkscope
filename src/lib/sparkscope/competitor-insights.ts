/**
 * 경쟁사 트렌드 요약 (AI) — 대시보드 경쟁사 탭 전용.
 *
 * 대시보드는 force-dynamic이라 매 요청마다 서버에서 다시 그려진다.
 * 요약을 매번 새로 만들면 새로고침 한 번에 API 호출이 11번(경쟁사 10 + 전체 1) 나가므로
 * 프로세스 메모리에 캐시를 두고, 하루에 한 번만 재계산한다.
 * 캐시 키(page.tsx의 trendCacheKey)에 오늘 날짜(KST)가 포함돼 있어서
 * 자정이 지나면 자연히 새 키로 바뀌고, TTL은 그 사이 서버가 오래 떠 있을 때의 안전장치일 뿐이다.
 * (DB는 건드리지 않는다 — 스키마 변경 없이 동작해야 함. Vercel 서버리스는 인스턴스가
 *  자주 재시작되므로 이 캐시가 100% 하루 1회를 보장하진 않지만, on-demand 방식에서
 *  가능한 최선이고 비용은 크게 줄어든다.)
 */
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CACHE_TTL_MS = 26 * 60 * 60 * 1000; // 26시간 (키가 날짜 기반이라 사실상 자정마다 갱신, TTL은 안전장치)

type CacheEntry = { value: string[]; at: number };
const cache = new Map<string, CacheEntry>();

function getCached(key: string): string[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key: string, value: string[]): void {
  // 캐시가 무한정 커지지 않도록 오래된 것부터 정리
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50);
    oldest.forEach(([k]) => cache.delete(k));
  }
  cache.set(key, { value, at: Date.now() });
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** 제목 목록이 너무 길면 토큰 낭비 — 최신 40건까지만 */
function capTitles(titles: string[], n = 40): string[] {
  return titles.slice(0, n);
}

const COMPANY_TREND_SYSTEM = `당신은 벤처투자 업계 미디어 애널리스트입니다.
경쟁 액셀러레이터·VC의 최근 기사 제목만 보고 투자 동향을 요약합니다.
제목에 없는 사실은 절대 추측해서 쓰지 마세요. 근거가 부족하면 "기사상 확인 어려움"이라고 쓰세요.

문체 규칙 (매우 중요):
- 완결된 문장("~했다", "~있다", "~이다")으로 쓰지 말고, 명사/명사구로 끝나는 개조식으로 쓰세요.
- 불필요한 조사·서술어를 최대한 생략하고 핵심 정보만 나열하세요.
- 예시: "3개월간 크로스보더 AI 커머스 스타트업 '사줘'에 집중 투자" (O)
       "이 기간 크로스보더 AI 커머스 스타트업 '사줘'에 집중 투자했다" (X, 너무 길고 서술체)
- 각 항목은 40자 이내를 목표로 최대한 짧게 씁니다.`;

/**
 * 경쟁사 1곳의 트렌드 3줄 요약.
 * 1) 어디에 크게 투자했는지  2) 그 투자들의 성격/분야  3) 스파크랩과의 한 줄 비교
 */
export async function summarizeCompetitorTrend(
  company: string,
  titles: string[],
  sparklabsCount: number,
  competitorCount: number,
  cacheKey: string,
  periodPhrase: string,
): Promise<string[] | null> {
  const capped = capTitles(titles);
  if (capped.length === 0) return null;

  const key = `company:${cacheKey}:${company}:${capped.length}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: COMPANY_TREND_SYSTEM,
      messages: [{
        role: 'user',
        content: `경쟁사: ${company}
${periodPhrase} ${company} 관련 기사 ${competitorCount}건, 같은 기간 스파크랩 관련 기사 ${sparklabsCount}건.

기사 제목:
${capped.map((t, i) => `${i + 1}. ${t}`).join('\n')}

아래 3가지를 각각 개조식 명사구로 요약해주세요. 라벨·번호·완결형 문장 없이, "${periodPhrase} ~" 형태로 시작하는 짧은 구로 쓰세요(화면에 불릿(•)으로 표시됩니다).
- ${company}가 가장 크게(또는 두드러지게) 투자한 곳
- 그 투자들이 쏠린 분야·성격 (예: 바이오 중심, 초기 AI 위주)
- 스파크랩과 비교했을 때 노출량·투자영역 차이 한 줄

출력 스키마: {"points": ["구1", "구2", "구3"]}
JSON 객체만 반환:`,
      }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const parsed = JSON.parse(extractJson(text));
    const points = Array.isArray(parsed?.points)
      ? parsed.points.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 3)
      : [];
    if (points.length === 0) return null;
    setCached(key, points);
    return points;
  } catch (e) {
    console.error(`[competitor-insights] ${company} 트렌드 요약 실패:`, e);
    return null;
  }
}

const OVERALL_SYSTEM = `당신은 벤처투자 업계 미디어 애널리스트입니다.
경쟁 액셀러레이터·VC들의 최근 기사 제목만 보고 업계 전반의 움직임을 요약합니다.
제목에 없는 사실은 추측하지 마세요.

문체 규칙 (매우 중요):
- 완결된 문장("~했다", "~있다", "~이다")으로 쓰지 말고, 명사/명사구로 끝나는 개조식으로 쓰세요.
- 불필요한 조사·서술어를 최대한 생략하고 핵심 정보만 나열하세요.
- 예시: "네이버 D2SF, 220건으로 AI·검색·커머스 분야 압도적 1위" (O)
       "네이버 D2SF가 220건으로 압도적 1위를 차지하며 AI·검색·커머스 영역에서 주도권을 확보하고 있다" (X, 너무 길고 서술체)
- 각 항목은 50자 이내를 목표로 최대한 짧게 씁니다.`;

/** 경쟁사 전체 총평 3~4줄 */
export async function summarizeOverallTrend(
  competitors: { name: string; count: number; negCount: number }[],
  sampleTitles: string[],
  sparklabsCount: number,
  cacheKey: string,
  periodPhrase: string,
): Promise<string[] | null> {
  if (competitors.length === 0) return null;

  const key = `overall:${cacheKey}:${competitors.length}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: OVERALL_SYSTEM,
      messages: [{
        role: 'user',
        content: `${periodPhrase} 경쟁 AC·VC 언론 노출 순위:
${competitors.map((c, i) => `${i + 1}. ${c.name} ${c.count}건 (부정 ${c.negCount}건)`).join('\n')}

같은 기간 스파크랩 관련 기사: ${sparklabsCount}건

주요 기사 제목:
${capTitles(sampleTitles, 60).map((t, i) => `${i + 1}. ${t}`).join('\n')}

경쟁사들이 전체적으로 어떻게 움직이고 있는지 개조식 명사구 3~4개로 요약해주세요. 완결형 문장 없이 짧게 쓰세요.
누가 주도하고 있는지, 어떤 분야·단계에 자금이 몰리는지, 스파크랩은 그 안에서 어느 위치인지가 드러나게 써주세요.

출력 스키마: {"lines": ["구1", "구2", "구3"]}
JSON 객체만 반환:`,
      }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const parsed = JSON.parse(extractJson(text));
    const lines = Array.isArray(parsed?.lines)
      ? parsed.lines.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 4)
      : [];
    if (lines.length === 0) return null;
    setCached(key, lines);
    return lines;
  } catch (e) {
    console.error('[competitor-insights] 전체 트렌드 요약 실패:', e);
    return null;
  }
}
