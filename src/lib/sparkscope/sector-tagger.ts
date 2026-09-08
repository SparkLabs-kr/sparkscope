/**
 * 포트폴리오사 섹터 태깅 — 프롬프트와 파싱 로직의 단일 소스.
 *
 * scripts/tag-portfolio-sectors.ts(검토용 draft JSON 생성)와
 * scripts/tag-portfolio-sectors-db.ts(DB에 직접 반영)가 같은 기준으로 태깅해야 하므로
 * 프롬프트를 여기 한 곳에만 둔다. 프롬프트가 갈라지면 한국·대만이 다른 기준으로 분류된다.
 */
import OpenAI from 'openai';
import { COMPANY_BIO_SECTORS, COMPANY_AI_SECTORS, COMPANY_OTHER_SECTORS } from './inter-taxonomy';

const BIO_SECTORS = COMPANY_BIO_SECTORS;
const AI_SECTORS = COMPANY_AI_SECTORS;
const OTHER_SECTORS = COMPANY_OTHER_SECTORS;

// 경계 판단(도구 vs 상품)이 필요한 태깅이라 mini보다 한 단계 위를 쓴다. 1회성이라 비용 무시 가능.
export const TAG_MODEL = 'gpt-4o';
export const TAG_BATCH = 10;

export type Tagged = { name: string; domain: '바이오' | 'AI' | '기타산업'; sector: string | null; reason: string };

const SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 포트폴리오 분류 애널리스트입니다.
각 회사의 사업 설명(businessContext)만 보고 domain(대분류) + sector(세부분류)를 태깅합니다.
바이오/AI는 인터(해외 트렌드) 탭에서 "글로벌 AI/바이오 업계 뉴스가 이 회사에 실제로 적용되는지" 매칭에 쓰이므로
엄격하게 판단하고, 그 외 모든 회사도 업종 태그가 비어있으면 안 됩니다(전수 태깅).

**판단 우선순위(중요)**
1) 바이오 우선 규칙: 신약·치료제·의료기기·임상 파이프라인이 회사의 최종 산출물이면,
   그 과정에 AI를 기술로 썼더라도 domain="바이오"입니다 (바이오가 AI보다 우선).
   예: "AI로 신약 후보물질을 발굴"하는 회사 → 바이오/신약발굴 (최종 산출물은 치료제).
2) 바이오가 아닌 경우, AI 우선 규칙: 회사 설명에서 AI(인공지능/AI엔진/AI 모델/딥러닝 등)가
   그 회사 솔루션의 핵심 구현 기술로 명시돼 있으면, 적용 산업(핀테크·교통·농업·애드테크·에듀테크 등)에
   관계없이 domain="AI"입니다. "AI가 부가기능이 아니라 그 회사 솔루션의 핵심 동작 원리인가"만 보면 됩니다.
   예: "AI 엔진으로 금융 데이터를 분석하는 핀테크 플랫폼" → AI (핀테크가 아니라 AI).
       "AI 기술로 교통안전 문제를 해결하는 스마트 교통 솔루션" → AI.
       "AI 기후테크 플랫폼으로 농지 데이터를 분석" → AI.
   반대로 설명에 AI 언급이 전혀 없거나 지나가는 말로만 붙어 있고, 실제 핵심은 다른 기술(IoT 하드웨어,
   물류망, 오프라인 매장 등)이면 해당 업종으로 분류합니다.
3) 콘텐츠/서비스 자체가 상품이고 AI는 그 제작 과정에서만 쓰인 경우(예: AI로 만든 콘텐츠를 유통하는
   미디어 앱)는 여전히 그 콘텐츠/서비스 업종으로 분류합니다 — "무엇을 만드는 기술"과 "무엇을 유통·판매하는
   사업"을 구분하되, 2)의 벤치마크는 "AI가 솔루션의 핵심 동작 원리인가"이므로 애매하면 AI 쪽으로 기웁니다.
4) 바이오/AI가 아닌 모든 회사는 sector를 아래 기타 업종 목록에서 가장 가까운 것으로 반드시 하나 고릅니다.
   정말 안 맞으면 "기타"를 씁니다 — null은 허용되지 않습니다.

**참고 예시**
- "포스코 사내벤처 출신 제조 AI 솔루션 기업. 공정 최적화 AI '마이너 리포트' 개발" → AI/AI버티컬 SaaS.
- "도로 라스트마일 교통안전 문제를 AI 기술로 해결하는 스마트 교통 솔루션" → AI/AI버티컬 SaaS (AI가 핵심 동작 원리).
- "올인원 IoT 센서로 농지 데이터를 수집·분석하는 AI 기후테크 플랫폼" → AI/AI버티컬 SaaS.
- "AI 엔진과 데이터 매핑 기술을 활용한 금융 정보 플랫폼" → AI/AI버티컬 SaaS.
- "AI로 신약 후보물질을 발굴"하는 회사 → 바이오/신약발굴 (바이오 우선 규칙이 AI 우선 규칙보다 먼저 적용).
- "IoT 기반 무인 공유창고 관리 시스템"(AI 언급 없음) → 기타산업/프롭테크·공간 (AI가 핵심 기술이 아님).

domain은 다음 중 하나: "바이오" | "AI" | "기타산업"

domain="바이오"면 sector는 다음 중 하나: ${BIO_SECTORS.join(', ')}
domain="AI"면 sector는 다음 중 하나: ${AI_SECTORS.join(', ')}
domain="기타산업"이면 sector는 다음 중 하나(반드시 선택, null 금지): ${OTHER_SECTORS.join(', ')}

응답은 반드시 valid JSON 배열만, 추가 설명 없이.`;

function buildUser(batch: Array<{ name: string; notes: string }>) {
  return `다음 ${batch.length}개 회사를 분류하세요.

${batch.map((c, i) => `${i + 1}. ${c.name}: ${c.notes}`).join('\n')}

출력 스키마(각 회사, 입력 순서대로):
{ "name": "<회사명 그대로>", "domain": "바이오"|"AI"|"기타산업", "sector": "<domain에 맞는 목록 중 하나, null 금지>", "reason": "<판단 근거 한 문장>" }

JSON 배열만 반환:`;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = text.indexOf('['); const e = text.lastIndexOf(']');
  return s >= 0 && e > s ? text.slice(s, e + 1) : text;
}


export { SYSTEM as TAG_SYSTEM, buildUser as buildTagUser, extractJson as extractTagJson };

/** 한 배치를 태깅한다. 사업 설명은 한국어·영어 어느 쪽이든 그대로 넘긴다. */
export async function tagBatch(
  openai: OpenAI,
  batch: Array<{ name: string; notes: string }>,
): Promise<Tagged[]> {
  const resp = await openai.chat.completions.create({
    model: TAG_MODEL,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUser(batch) },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? '';
  return JSON.parse(extractJson(text)) as Tagged[];
}

/** sector가 속한 domain — sector 이름은 세 목록에서 겹치지 않으므로 역으로 찾을 수 있다. */
function domainOfSector(sector: string): Tagged['domain'] | null {
  if ((BIO_SECTORS as readonly string[]).includes(sector)) return '바이오';
  if ((AI_SECTORS as readonly string[]).includes(sector)) return 'AI';
  if ((OTHER_SECTORS as readonly string[]).includes(sector)) return '기타산업';
  return null;
}

/**
 * 태깅 결과를 택소노미에 맞게 바로잡는다. 목록 밖 sector면 null(버림).
 *
 * domain은 sector에서 역산한다 — LLM이 sector는 맞게 고르고 domain만 틀리는 경우가 실제로
 * 흔하다(2026-09-08: 182건 중 6건이 "기타산업/디지털헬스"로 왔다. 디지털헬스는 바이오
 * 목록에 있는 값이다). sector가 맞으면 domain은 기계적으로 정해지므로 그걸 믿고 고친다.
 */
export function normalizeTag(t: Tagged): Tagged | null {
  if (!t.sector) return null;
  const domain = domainOfSector(t.sector);
  if (!domain) return null;
  return { ...t, domain };
}

/** 태깅 결과가 택소노미 안에 있는지(normalizeTag로 고칠 수 있으면 true). */
export function isValidTag(t: Tagged): boolean {
  return normalizeTag(t) !== null;
}
