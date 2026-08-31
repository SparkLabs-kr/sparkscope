/**
 * 대만 확정 매체 — 티어별 분류 + 표기 정규화.
 *
 * 한국 media.ts(26개·4티어)를 그대로 옮긴 구조다. 한국과 같은 이유로 종합일간지만 보면
 * 포트폴리오사 노출이 과소평가되므로 스타트업·기술 전문지(Tier 4)를 함께 노출한다.
 *
 * 왜 필요한가 — 3개월 트라이얼 120건은 Google News가 주는 대로 받아서 52개 출처에서 왔다.
 * 그중 32%가 대만 보도가 아니었다:
 *   - 해외 매체 9건(인도 indiagazette, 미국 StorageReview, 홍콩 bastillepost·HKBT 등)
 *   - 아그리게이터 21건(Yahoo 3종·LINE TODAY·蕃新聞·BigGo — 원문 매체를 가린다)
 *   - 증권사·시세 재배포 9건(CMoney 2종·永豐金·富果)
 * 남는 실제 대만 보도는 81건(68%)이다.
 *
 * 목록은 트라이얼에 등장한 매체 + 등장하지 않았지만 대만 스타트업/테크를 실제로 다루는
 * 주요 매체를 합쳐 구성했다. 트라이얼에 안 나온 건 우리 포트폴리오사를 안 다룬 것일 뿐
 * 매체가 중요하지 않다는 뜻이 아니다.
 */

export interface TaiwanMedia {
  name: string;
  /** Google News RSS는 도메인이 아니라 매체명을 주므로 name이 1차 키다. 확인된 것만 채운다. */
  domain: string;
  tier: 1 | 2 | 3 | 4;
}

export const TAIWAN_MEDIA_LIST: TaiwanMedia[] = [
  // Tier 1 — 종합일간지·통신사
  { name: '聯合報 UDN', domain: 'udn.com', tier: 1 },
  { name: '中時新聞網', domain: 'chinatimes.com', tier: 1 },
  { name: '自由時報', domain: 'ltn.com.tw', tier: 1 },
  { name: '中央社', domain: 'cna.com.tw', tier: 1 },

  // Tier 2 — 경제일간지·금융 전문
  { name: '經濟日報', domain: 'money.udn.com', tier: 2 },
  { name: '工商時報', domain: 'ctee.com.tw', tier: 2 },
  { name: 'MoneyDJ', domain: 'moneydj.com', tier: 2 },
  { name: '鉅亨網', domain: 'cnyes.com', tier: 2 },
  { name: '自由財經', domain: 'ec.ltn.com.tw', tier: 2 },
  { name: '富聯網', domain: 'money-link.com.tw', tier: 2 },

  // Tier 3 — 방송·주간지·종합
  { name: 'TVBS新聞網', domain: 'tvbs.com.tw', tier: 3 },
  { name: '三立新聞網', domain: 'setn.com', tier: 3 },
  { name: '東森電視', domain: 'ebc.net.tw', tier: 3 },
  { name: '非凡新聞', domain: 'ustv.com.tw', tier: 3 },
  { name: '台視', domain: 'ttv.com.tw', tier: 3 },
  { name: '鏡週刊', domain: 'mirrormedia.mg', tier: 3 },
  { name: '風傳媒', domain: 'storm.mg', tier: 3 },
  { name: '今周刊', domain: 'businesstoday.com.tw', tier: 3 },
  { name: '遠見雜誌', domain: 'gvm.com.tw', tier: 3 },
  { name: '天下雜誌', domain: 'cw.com.tw', tier: 3 },
  { name: '中華日報', domain: 'cdns.com.tw', tier: 3 },
  { name: '知新聞', domain: '', tier: 3 },
  { name: '旺得富理財網', domain: '', tier: 3 },

  // Tier 4 — 스타트업·기술·바이오 전문 (포트폴리오사 노출이 가장 많이 잡히는 층)
  { name: 'TechNews 科技新報', domain: 'technews.tw', tier: 4 },
  { name: 'Meet創業小聚', domain: 'meet.bnext.com.tw', tier: 4 },
  { name: '數位時代', domain: 'bnext.com.tw', tier: 4 },
  { name: 'INSIDE', domain: 'inside.com.tw', tier: 4 },
  { name: 'TechOrange 科技報橘', domain: 'buzzorange.com', tier: 4 },
  { name: 'DIGITIMES', domain: 'digitimes.com.tw', tier: 4 },
  { name: 'iThome', domain: 'ithome.com.tw', tier: 4 },
  { name: '未來商務', domain: 'fc.bnext.com.tw', tier: 4 },
  { name: '環球生技月刊', domain: 'gbimonthly.com', tier: 4 },
  { name: 'GeneOnline', domain: 'geneonline.news', tier: 4 },
  { name: '生技投資第一站', domain: 'genetinfo.com', tier: 4 },
  { name: '匯流新聞網', domain: 'cnews.com.tw', tier: 4 },
  // 소비재·라이프스타일 — VIASWEAT(스포츠웨어)·FunNow(제휴카드)처럼 B2C 포트폴리오사는
  // 테크 매체가 아니라 여기서 잡힌다. 트라이얼에서 각 1건씩 실제로 나왔다.
  { name: 'Bella儂儂', domain: 'bella.tw', tier: 4 },
  { name: '卡優新聞網', domain: 'cardu.com.tw', tier: 4 },
];

/** 기본 표시 Top 12 — Tier1 전부 + Tier2 상위 4 + Tier4 상위 4 (한국 DEFAULT_TOP12과 같은 규칙) */
export const TAIWAN_DEFAULT_TOP12: string[] = [
  '聯合報 UDN', '中時新聞網', '自由時報', '中央社',
  '經濟日報', '工商時報', 'MoneyDJ', '鉅亨網',
  'TechNews 科技新報', 'Meet創業小聚', '數位時代', 'INSIDE',
];

export const TAIWAN_TIER_OF = new Map(TAIWAN_MEDIA_LIST.map(m => [m.name, m.tier]));
const NAME_SET = new Set(TAIWAN_MEDIA_LIST.map(m => m.name));
const DOMAIN_TO_NAME = new Map(
  TAIWAN_MEDIA_LIST.filter(m => m.domain).map(m => [m.domain, m.name]),
);

/**
 * 표기 편차 → 표준 매체명.
 * 트라이얼에서 같은 매체가 두 이름으로 잡힌 사례가 실제로 나왔다:
 * news.cnyes.com == 鉅亨網, 三立新聞 == 三立新聞網SETN.com, CMoney == CMoney投資網誌.
 * 정규화하지 않으면 매체별 집계가 갈라져 노출 순위가 틀어진다.
 */
const ALIASES: Record<string, string> = {
  // 聯合報 계열
  'UDN': '聯合報 UDN',
  'udn.com': '聯合報 UDN',
  '聯合新聞網': '聯合報 UDN',
  '經濟日報 - 聯合新聞網': '經濟日報',
  // 鉅亨網
  'news.cnyes.com': '鉅亨網',
  'cnyes.com': '鉅亨網',
  'Anue鉅亨': '鉅亨網',
  // 三立
  '三立新聞': '三立新聞網',
  '三立新聞網SETN.com': '三立新聞網',
  'SETN.com': '三立新聞網',
  // 중앙통신사
  'cna.com.tw': '中央社',
  '中央通訊社': '中央社',
  // 기타 표기 편차
  '鏡週刊Mirror Media': '鏡週刊',
  'Mirror Media': '鏡週刊',
  '非凡新聞台': '非凡新聞',
  '台視全球資訊網': '台視',
  '中華新聞雲／中華日報': '中華日報',
  '中華新聞雲': '中華日報',
  'inside.com.tw': 'INSIDE',
  'GeneOnline News': 'GeneOnline',
  'genetinfo.com': '生技投資第一站',
  '自由時報電子報': '自由時報',
  'Bella.tw儂儂': 'Bella儂儂',
};

/**
 * 제외 매체 — 수집은 하되 대만 보도로 세지 않는다.
 * 이유를 남겨야 나중에 "왜 빠졌지"를 다시 조사하지 않는다.
 */
export const EXCLUDED_SOURCES: Record<string, string> = {
  // 해외 매체 — 대만 매체 커버리지가 아니다
  'indiagazette.com': '인도 매체',
  'StorageReview.com': '미국 IT 리뷰',
  'bastillepost.com': '홍콩 巴士的報',
  '香港財經時報HKBT': '홍콩 매체',
  '加密城市CryptoCity': '홍콩·크립토 매체',
  'Ludens Media': '대만 매체 여부 미확인',
  // 아그리게이터 — 원문 매체를 가려서 매체별 집계를 왜곡한다
  'Yahoo新聞': '아그리게이터',
  'Yahoo 財經': '아그리게이터',
  'Yahoo股市': '아그리게이터',
  'LINE TODAY': '아그리게이터',
  '蕃新聞': '아그리게이터',
  'BigGo 財經': '아그리게이터(가격비교 사이트 재배포)',
  // 증권사·시세 엔진 — taiwan-noise.ts가 공시로 분류하는 것과 별개로 매체로는 세지 않는다
  'CMoney': '시세·공시 자동생성',
  'CMoney投資網誌': '시세·공시 자동생성',
  'sinotrade.com.tw': '永豐金證券 재배포',
  '富果直送': 'Fugle 증권 콘텐츠',
};

/** 표기 편차를 표준 매체명으로 정규화한다. 매칭 실패 시 원문 그대로 돌려준다. */
export function normalizeTaiwanSource(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (NAME_SET.has(s)) return s;
  if (ALIASES[s]) return ALIASES[s];
  if (DOMAIN_TO_NAME.has(s)) return DOMAIN_TO_NAME.get(s)!;
  // 부분일치 — 'TechNews 科技新報'처럼 접미사가 붙어 오는 경우
  for (const name of NAME_SET) {
    if (s.includes(name) || name.includes(s)) return name;
  }
  return s;
}

/** 큐레이션된 대만 매체인가. 매체별 노출 분포는 이걸 통과한 것만 센다. */
export function isCuratedTaiwanSource(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim();
  if (!s) return false;
  if (EXCLUDED_SOURCES[s]) return false;
  return NAME_SET.has(normalizeTaiwanSource(s));
}

/** 제외 사유 — 제외 대상이 아니면 null. */
export function taiwanExclusionReason(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  return EXCLUDED_SOURCES[s] ?? null;
}
