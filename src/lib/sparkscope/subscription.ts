/**
 * 다이제스트 구독 설정 — 섹션 목록 정의와 "구독에 맞춰 내용 깎기".
 *
 * 메일 발송·설정 화면·API가 전부 이 파일의 SECTIONS를 기준으로 돈다. 섹션을 하나 더
 * 늘리려면 (1) 여기 SECTIONS에 추가 (2) Prisma DigestSubscriber에 Boolean @default(true)
 * 컬럼 추가 (3) digest.ts 렌더에서 그 자리를 prefs로 감싸기 — 세 군데면 끝나게 해 두었다.
 */
import type { AnalyzedArticle, DigestData } from './types';

/** 섹션 키 — DigestSubscriber의 Boolean 컬럼 이름과 1:1로 같다. */
export type SectionKey =
  | 'sparklabs'
  | 'portfolio'
  | 'inter'
  | 'aiSignals'
  | 'competitor'
  | 'industry';

export type SectionPrefs = Record<SectionKey, boolean>;

/** 설정 화면에 그대로 쓰는 목록. 순서는 메일에 나오는 순서와 맞춘다. */
export const SECTIONS: { key: SectionKey; label: string; desc: string }[] = [
  { key: 'sparklabs', label: '🏢 스파크랩 직접 언급', desc: '스파크랩이 직접 언급된 보도와 논조' },
  { key: 'portfolio', label: '💼 포트폴리오 하이라이트', desc: '포트폴리오사 소식 · 피칭 기회' },
  { key: 'inter', label: '🔭 해외 트렌드', desc: '해외 매체·논문 주요 토픽과 포트폴리오 연결점' },
  { key: 'aiSignals', label: '🤖 AI 트렌드 TOP 5', desc: '여러 매체가 함께 다룬 이번 주 AI 이슈' },
  { key: 'competitor', label: '🤝 AC·VC 업계 동향', desc: '타 액셀러레이터·벤처캐피탈 움직임' },
  { key: 'industry', label: '🚀 스타트업계 뉴스', desc: '투자·정책 등 업계 전반 흐름' },
];

export const SECTION_KEYS = SECTIONS.map(s => s.key);

/** 구독 정보가 없을 때의 기본값 — 전부 수신(지금까지 나가던 메일과 같다). */
export const ALL_SECTIONS: SectionPrefs = Object.fromEntries(
  SECTION_KEYS.map(k => [k, true]),
) as SectionPrefs;

/** DB 행(또는 아무 객체)에서 섹션 플래그만 뽑아낸다. 값이 없으면 수신으로 본다. */
export function toPrefs(row: Partial<Record<SectionKey, boolean>> | null | undefined): SectionPrefs {
  if (!row) return { ...ALL_SECTIONS };
  return Object.fromEntries(
    SECTION_KEYS.map(k => [k, row[k] !== false]),
  ) as SectionPrefs;
}

/**
 * 같은 조합끼리 묶는 키. 메일을 사람 수만큼 만들지 않고 "조합 수"만큼만 만들기 위한 것 —
 * 30명이 구독해도 실제 조합이 4가지면 본문은 4번만 만든다(배달은 1인 1통이다).
 */
export function prefsKey(prefs: SectionPrefs): string {
  return SECTION_KEYS.map(k => (prefs[k] ? '1' : '0')).join('');
}

/** 하나도 안 고른 상태 — 이 사람에게는 보낼 내용이 없다. */
export function isEmptyPrefs(prefs: SectionPrefs): boolean {
  return SECTION_KEYS.every(k => !prefs[k]);
}

/**
 * TOP 3에 넣어도 되는 기사 카테고리. TOP 3는 그 자체가 독립된 주제가 아니라 아래 섹션들에서
 * 가장 중요한 것을 끌어올린 자리라, 구독하지 않은 섹션의 기사가 올라오면 앞뒤가 안 맞는다
 * (포트폴리오를 끈 사람의 맨 위 카드가 포트폴리오 소식인 상황).
 */
function allowedTop3Categories(prefs: SectionPrefs): Set<string> {
  const s = new Set<string>();
  if (prefs.sparklabs) s.add('sparklabs_self');
  if (prefs.portfolio) s.add('portfolio_company');
  if (prefs.competitor) s.add('competitor');
  if (prefs.industry) s.add('industry_trend');
  return s;
}

/**
 * 구독 설정에 맞춰 DigestData를 깎아낸 복사본을 돌려준다. 원본은 건드리지 않는다.
 *
 * 안 고른 섹션은 비우기만 하고, 렌더 쪽에서 "빈 것"과 "구독 안 한 것"을 구분해야 하는
 * 자리(포트폴리오 섹션의 '보도 없음' 문구 등)는 renderDigestHtml이 prefs를 따로 받아 처리한다.
 *
 * TOP 3는 걸러내기만 하고 다른 기사로 채우지 않는다. 채우려면 rankTop3Pool의 나머지를 끌어와야
 * 하는데, 거기엔 발송 직전 AI 검증(pickVerifiedTop3)에서 탈락한 기사가 섞여 있어서 "검증을
 * 통과한 것만 TOP 3에 올린다"는 원칙이 깨진다. 3건이 안 되면 제목을 'TOP 3' 대신
 * '오늘의 핵심'으로 바꿔 숫자와 실제 개수가 어긋나지 않게 한다(digest.ts).
 */
export function applySubscription(data: DigestData, prefs: SectionPrefs): DigestData {
  const top3Cats = allowedTop3Categories(prefs);
  const keep = (list: AnalyzedArticle[], on: boolean) => (on ? list : []);

  return {
    ...data,
    top3: data.top3.filter(a => top3Cats.has(a.category)),
    sparklabsArticles: keep(data.sparklabsArticles, prefs.sparklabs),
    portfolioArticles: keep(data.portfolioArticles, prefs.portfolio),
    competitorArticles: keep(data.competitorArticles, prefs.competitor),
    industryArticles: keep(data.industryArticles, prefs.industry),
    inter: prefs.inter ? data.inter : null,
    aiSignals: prefs.aiSignals ? data.aiSignals : null,
  };
}
