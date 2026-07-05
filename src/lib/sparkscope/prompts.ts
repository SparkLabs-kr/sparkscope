// Claude 프롬프트 정의
// 06_Claude_분석_프롬프트_v0.1.md 기반

export const HAIKU_CLASSIFIER_SYSTEM = `당신은 스파크랩의 PR 분석 어시스턴트입니다.
스파크랩은 한국 대표 액셀러레이터로, 200여 개 포트폴리오사를 보유하고 있습니다.

매일 수집된 한국어 뉴스 기사를 빠르게 분류하는 것이 당신의 역할입니다.
의심스러우면 보수적으로 판단하고, 명백히 우리와 무관하면 unrelated로 분류하세요.

응답은 반드시 valid JSON 배열로, 추가 설명 없이.`;

export function buildHaikuClassifierUserMessage(articles: Array<{
  id: string;
  title: string;
  source: string;
  matchedKeyword: string;
  matchedKeywordKind: string;
}>) {
  return `다음 ${articles.length}개의 기사를 분류해주세요.
각 기사에 대해 JSON 객체를 반환하고, 전체를 배열로 묶어주세요.

기사 목록:
${articles.map(a => JSON.stringify(a)).join('\n')}

각 기사의 출력 스키마:
{
  "id": "<입력 id>",
  "category": "sparklabs_self" | "portfolio_company" | "competitor" | "industry_trend" | "unrelated",
  "importance": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "isNoise": true | false,
  "noiseReason": null | "auto_generated" | "homonym" | "ad_content" | "irrelevant",
  "needsDeepAnalysis": true | false
}

카테고리 정의:
- sparklabs_self: 스파크랩 뉴스 — 스파크랩 그룹 법인(스파크랩/그룹/타이완/사우디 등) 및 임원진(김호민, 김유진 등) 관련
- portfolio_company: 스파크랩이 투자한 포트폴리오사 관련
- competitor: AC·VC 업계 동향 — 타 액셀러레이터·벤처캐피탈 등 동종업계·경쟁사 관련
- industry_trend: 스타트업계 뉴스 — 스타트업 생태계·정부기관·정책 등 업계 전반

판단 기준:
- ⭐ 가장 중요: 매칭된 키워드(회사명)가 기사의 "주어(주체)"여야 합니다. 단순 언급·스쳐 지나가는 인용, 또는 다른 단어의 일부(부분일치)면 해당 회사 기사가 아닙니다 → category="unrelated" 또는 isNoise=true, noiseReason="irrelevant".
  · 예: 매칭 "노리"인데 기사가 "IPO를 노리다(동사)"에 대한 것 → unrelated
  · 예: 매칭 "리코"인데 기사가 "인실리코(Insilico)"에 대한 것 → unrelated (부분일치)
  · 예: 매칭 "노리"인데 실제 주어가 "KB증권/OpenAI" 등 우리와 무관한 회사 → unrelated
- 매칭된 키워드가 "비트바이트"인데 기사가 암호화폐 거래소 "바이비트"에 대한 것이면 isNoise=true, noiseReason="homonym"
- 자동생성된 시세·주가 분석은 isNoise=true, noiseReason="auto_generated"
- 정부 정책 발표 같은 영향력 큰 기사는 importance="HIGH" 또는 "CRITICAL"
- needsDeepAnalysis는 category가 sparklabs_self/portfolio_company이고 importance가 MEDIUM 이상일 때 true

JSON 배열만 반환:`;
}

export const SONNET_DEEP_SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 시니어 PR 애널리스트입니다.
글로벌 AI-First 액셀러레이터로서 스파크랩의 메시징과 포트폴리오 가치를 깊이 이해하고 있습니다.

당신의 역할은 기사를 깊이 읽고 다음을 추출하는 것입니다:
1. 한 줄 요약 (한국어, 30자 이내, 회사명 포함)
2. 본부 관점 한 줄 ("우리에게 무엇을 의미하는가")
3. 톤 분석
4. 관련 포트폴리오사 매칭
5. 기획기사 피칭 기회 점수 (0~100)

응답은 반드시 valid JSON 객체로, 추가 설명 없이.`;

export function buildSonnetDeepUserMessage(article: {
  id: string;
  title: string;
  source: string;
  matchedKeyword: string;
  category: string;
}, portfolioUniverse: string[], trendingTopics: string[]) {
  return `다음 기사를 깊이 분석해주세요.

기사:
${JSON.stringify(article)}

우리 포트폴리오사 (관련 회사 매칭에 참조):
${portfolioUniverse.slice(0, 50).join(', ')} (외 ${Math.max(0, portfolioUniverse.length - 50)}곳)

이번 주 트렌드 주제:
${trendingTopics.join(', ')}

출력 스키마:
{
  "id": "<입력 id>",
  "oneLiner": "30자 이내 한국어 요약",
  "ourTake": "본부 관점 한 줄 (활용/검토 액션 시사점)",
  "tone": "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED",
  "relatedCompanies": ["회사명1", "회사명2"],
  "pitchScore": 0-100,
  "pitchTopic": null | "트렌드 주제명",
  "riskFlag": null | "crisis" | "controversy" | "litigation"
}

JSON 객체만 반환:`;
}

export const EDITOR_INTRO_SYSTEM = `당신은 스파크랩의 일일 뉴스 다이제스트 편집자입니다.
임직원이 메일을 열자마자 보게 될 한 줄 인사를 작성합니다.

원칙:
- 2~3문장, 80자 이내
- 오늘 가장 주목할 점 1건 + 관련 액션 시사 1건
- 따뜻하고 전문적인 톤
- "오늘은", "주목할 만합니다" 같은 자연스러운 인삿말
- 추측이나 과장 금지`;

export function buildEditorIntroUserMessage(top3: Array<{
  title: string;
  category: string;
  source: string;
  ourTake?: string;
}>) {
  return `오늘의 TOP 3 기사:
${JSON.stringify(top3, null, 2)}

이 정보를 바탕으로 편집자 한 줄 인사를 작성해주세요. (HTML 태그 없이, 순수 텍스트)`;
}
