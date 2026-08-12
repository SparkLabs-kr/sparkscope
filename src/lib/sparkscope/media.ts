/**
 * 확정 매체 26개 — 티어별 분류 + 표기 정규화.
 * 종합일간지만 보면 포트폴리오사 노출이 과소평가되므로 스타트업 전문지(Tier 4)를 함께 노출한다.
 */
export interface Media {
  name: string;
  domain: string;
  tier: 1 | 2 | 3 | 4;
}

export const MEDIA_LIST: Media[] = [
  // Tier 1 — 종합일간지
  { name: '조선일보', domain: 'chosun.com', tier: 1 },
  { name: '중앙일보', domain: 'joongang.com', tier: 1 },
  { name: '동아일보', domain: 'donga.com', tier: 1 },
  { name: '매일경제', domain: 'mk.co.kr', tier: 1 },
  { name: '한국경제', domain: 'hankyung.com', tier: 1 },
  // Tier 2 — 통신사·경제일간지
  { name: '연합뉴스', domain: 'yna.co.kr', tier: 2 },
  { name: '서울경제', domain: 'sedaily.com', tier: 2 },
  { name: '머니투데이', domain: 'mt.co.kr', tier: 2 },
  { name: '파이낸셜뉴스', domain: 'fnnews.com', tier: 2 },
  { name: '이데일리', domain: 'edaily.co.kr', tier: 2 },
  { name: '아시아경제', domain: 'asiae.co.kr', tier: 2 },
  { name: '헤럴드경제', domain: 'heraldcorp.com', tier: 2 },
  // Tier 3 — 디지털 경제·종합
  { name: '조선비즈', domain: 'chosunbiz.com', tier: 3 },
  { name: '뉴스1', domain: 'news1.kr', tier: 3 },
  { name: '전자신문', domain: 'etnews.com', tier: 3 },
  { name: '더팩트', domain: 'tf.co.kr', tier: 3 },
  { name: '부산일보', domain: 'busan.com', tier: 3 },
  // Tier 4 — 스타트업 전문
  { name: '플래텀', domain: 'platum.kr', tier: 4 },
  { name: '벤처스퀘어', domain: 'venturesquare.net', tier: 4 },
  { name: '블로터', domain: 'bloter.net', tier: 4 },
  { name: '스타트업엔', domain: 'startupn.kr', tier: 4 },
  { name: 'IT동아', domain: 'itdonga.com', tier: 4 },
  { name: '테크42', domain: 'tech42.co.kr', tier: 4 },
  { name: '비석세스', domain: 'besuccess.com', tier: 4 },
  { name: '더벨', domain: 'thebell.co.kr', tier: 4 },
  { name: '더구루', domain: 'theguru.co.kr', tier: 4 },
];

// 기본 표시 Top 12: Tier1 전부 + Tier2 상위 3 + Tier4 상위 4
export const DEFAULT_TOP12: string[] = [
  '조선일보', '중앙일보', '동아일보', '매일경제', '한국경제',
  '연합뉴스', '서울경제', '머니투데이',
  '플래텀', '벤처스퀘어', '블로터', '스타트업엔',
];

const DOMAIN_TO_NAME = new Map(MEDIA_LIST.map(m => [m.domain, m.name]));
const NAME_SET = new Set(MEDIA_LIST.map(m => m.name));
export const TIER_OF = new Map(MEDIA_LIST.map(m => [m.name, m.tier]));

// 표기 편차 → 표준 매체명
const ALIASES: Record<string, string> = {
  '매일경제신문': '매일경제',
  '매경': '매일경제',
  '한국경제신문': '한국경제',
  '한경': '한국경제',
  '서울경제신문': '서울경제',
  '아시아경제신문': '아시아경제',
  '헤럴드경제신문': '헤럴드경제',
  '전자신문인터넷': '전자신문',
  'Chosunbiz': '조선비즈',
  'ChosunBiz': '조선비즈',
  '조선비즈닷컴': '조선비즈',
  '연합뉴스TV': '연합뉴스',
  '뉴스1코리아': '뉴스1',
  '더팩트뉴스': '더팩트',
  'IT조선': '조선비즈',
};

// 26개 확정 매체 밖이지만 자주 걸리는 도메인 → 한글 매체명 (표시용, 티어 목록과는 별개).
// 네이버 API는 언론사명을 안 줘서 도메인만으로 source를 만드는데(domainToSource), 그 결과가
// 그대로 화면에 노출돼 "topstarnews.net" 같은 도메인이 매체명 자리에 뜨는 문제가 있었다.
// 2026-08-12: 구글 뉴스 경로도 정규화를 안 거치던 버그를 고치면서, 실제 DB에 자주 쌓인
// 도메인(90일 기준 상위)을 훑어 아는 매체를 추가함. v.daum.net은 다음이 여러 언론사 기사를
// 묶어 보여주는 뷰어 주소라 원 매체를 알 수 없어 "다음뉴스"로 대체 표시한다.
const EXTRA_DOMAIN_ALIASES: Record<string, string> = {
  'topstarnews.net': '탑스타뉴스',
  'v.daum.net': '다음뉴스',
  'khan.co.kr': '경향신문',
  'newsis.com': '뉴시스',
  'newspim.com': '뉴스핌',
  'segye.com': '세계일보',
  'kmib.co.kr': '국민일보',
  'seoul.co.kr': '서울신문',
  'hankookilbo.com': '한국일보',
  'munhwa.com': '문화일보',
  'pressian.com': '프레시안',
  'ohmynews.com': '오마이뉴스',
  'koreatimes.co.kr': '코리아타임스',
  'koreaherald.com': '코리아헤럴드',
  'kukinews.com': '쿠키뉴스',
  'ytn.co.kr': 'YTN',
  'mbn.co.kr': 'MBN',
  'inews24.com': '아이뉴스24',
  'zdnet.co.kr': 'ZDNet Korea',
  'dt.co.kr': '디지털타임스',
  'ddaily.co.kr': '디지털데일리',
  'newstomato.com': '뉴스토마토',
  'ajunews.com': '아주경제',
  'tokenpost.kr': '토큰포스트',
  'coinness.com': '코인니스',
  'businesspost.co.kr': '비즈니스포스트',
  'dailian.co.kr': '데일리안',
  'newsis.co.kr': '뉴시스',
  'gukjenews.com': '국제뉴스',
  'ebn.co.kr': 'EBN',
  'pinpointnews.co.kr': '핀포인트뉴스',
  'newsworks.co.kr': '뉴스웍스',
  'g-enews.com': '글로벌이코노믹',
  'thepublic.kr': '더퍼블릭',
  'boannews.com': '보안뉴스',
  'dealsite.co.kr': '딜사이트',
  'numbers.co.kr': '넘버스',
  'outstanding.kr': '아웃스탠딩',
  'wikitree.co.kr': '위키트리',
};

// 영문 표기(대소문자 무시) → 표준 매체명. Google/Naver가 영문명으로 주는 경우 대응.
const ENGLISH_ALIASES: Record<string, string> = {
  platum: '플래텀',
  venturesquare: '벤처스퀘어',
  bloter: '블로터',
  besuccess: '비석세스',
  thebell: '더벨',
  theguru: '더구루',
  tech42: '테크42',
  startupn: '스타트업엔',
  "startup'n": '스타트업엔',
  itdonga: 'IT동아',
};

/** 도메인·영문·표기편차를 표준 매체명으로 정규화 (미등록 매체는 원문 유지) */
export function normalizeSource(source: string): string {
  let s = (source ?? '').trim().replace(/^www\./, '');
  if (!s) return '(미상)';
  // "이름(English)" / "이름(약칭)" 형태 → 괄호 앞부분만 사용 (예: "플래텀(Platum)" → "플래텀")
  s = s.replace(/\s*\(.*\)\s*$/, '').trim();
  if (DOMAIN_TO_NAME.has(s)) return DOMAIN_TO_NAME.get(s)!;
  if (EXTRA_DOMAIN_ALIASES[s]) return EXTRA_DOMAIN_ALIASES[s];
  if (NAME_SET.has(s)) return s;
  if (ALIASES[s]) return ALIASES[s];
  const low = s.toLowerCase();
  if (ENGLISH_ALIASES[low]) return ENGLISH_ALIASES[low];
  // "XXX신문"이 등록 매체명이면 접미사 제거
  const noPaper = s.replace(/신문$/, '');
  if (NAME_SET.has(noPaper)) return noPaper;
  // 서브도메인(biz.chosun.com, sports.donga.com 등) → 등록된 상위 도메인과 같은 매체로 취급.
  // 도메인 자체가 아니라 "확실히 딸린 하위 페이지"일 때만 맞도록 앞에 뭔가 붙은 경우로 제한한다.
  if (s.includes('.')) {
    const parts = s.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (DOMAIN_TO_NAME.has(parent)) return DOMAIN_TO_NAME.get(parent)!;
      if (EXTRA_DOMAIN_ALIASES[parent]) return EXTRA_DOMAIN_ALIASES[parent];
    }
  }
  return s;
}

export function isKnownMedia(source: string): boolean {
  return NAME_SET.has(normalizeSource(source));
}
