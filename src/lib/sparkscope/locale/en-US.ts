/**
 * en-US — 글로벌벤처스(영문) 언어 팩.
 *
 * 대만 팩은 데이터를 taiwan-*.ts 4개 파일에 두고 여기서 감싸는 구조지만, 이 팩은
 * types.ts가 의도한 대로 "새 오피스 = 데이터 파일 하나"로 한 파일에 담는다 —
 * 감쌀 기존 파일이 없고, 영문 데이터를 또 4개로 쪼개면 대만의 분산을 반복하게 된다.
 *
 * GV 포트폴리오는 미국·영국·싱가포르·스웨덴·크로아티아 등 10개국에 걸쳐 있지만
 * 보도 언어는 전부 영어다. 그래서 나라가 아니라 언어로 팩을 나눈다.
 */
import type { LanguagePack } from './types';

/** 라틴 문자. 한글·한자가 없고 이게 있으면 영문 기사로 본다. */
const LATIN = /[A-Za-z]/;

/**
 * 위기 키워드 — 한국(4종)·대만(8종) 분류명을 그대로 쓴다. 화면·집계가 분류명으로
 * 묶이므로 영문 팩만 새 분류명을 쓰면 대시보드에서 따로 떨어진다.
 */
export const EN_CRISIS_KEYWORDS: Record<string, string[]> = {
  법적규제: [
    'lawsuit', 'sued', 'sues', 'litigation', 'indicted', 'indictment', 'subpoena',
    'class action', 'settlement', 'fined', 'fine', 'penalty', 'sanctions', 'probe',
    'investigation', 'antitrust', 'SEC charges', 'DOJ', 'FTC', 'regulatory action',
    'injunction', 'cease and desist', 'violation', 'illegal', 'fraud charges',
  ],
  재무경영: [
    'bankruptcy', 'Chapter 11', 'insolvency', 'liquidation', 'wind down', 'shut down',
    'shutting down', 'ceases operations', 'down round', 'writedown', 'write-off',
    'missed earnings', 'revenue miss', 'cash crunch', 'running out of cash',
    'failed to raise', 'valuation cut', 'restructuring', 'default',
  ],
  제품사고: [
    'outage', 'downtime', 'breach', 'data breach', 'hacked', 'hack', 'exploit',
    'vulnerability', 'leaked', 'data leak', 'recall', 'defect', 'bug', 'malfunction',
    'security incident', 'ransomware', 'compromised', 'service disruption',
    'sunset', 'discontinued', 'deprecated',
  ],
  평판윤리: [
    'scandal', 'misconduct', 'allegations', 'accused', 'whistleblower', 'controversy',
    'conflict of interest', 'plagiarism', 'misleading', 'deceptive', 'cover-up',
    'resigns amid', 'ousted', 'stepped down amid', 'ethics',
  ],
  소비자여론: [
    'boycott', 'backlash', 'outrage', 'complaints', 'criticized', 'slammed',
    'apology', 'apologizes', 'user revolt', 'review bombing', 'petition',
    'public criticism',
  ],
  노사내부: [
    'layoffs', 'laid off', 'job cuts', 'furlough', 'strike', 'union', 'walkout',
    'hiring freeze', 'attrition', 'exodus', 'mass resignation', 'toxic workplace',
    'discrimination suit', 'harassment',
  ],
  안전사고: [
    'accident', 'fire', 'death', 'died', 'killed', 'injured', 'injury', 'fatality',
    'explosion', 'safety concern', 'safety issue', 'hazard', 'evacuation',
  ],
  상장시장: [
    'plunged', 'plummeted', 'tumbled', 'slumped', 'crashed', 'sank', 'selloff',
    'sell-off', 'delisted', 'delisting', 'halted', 'trading halt', 'broke issue price',
    'shares fall', 'stock drops', 'downgrade', 'short seller',
  ],
};

/**
 * 큐레이션 매체 — 구글 뉴스 en-US가 실제로 돌려주는 곳들.
 * tier는 "같은 사안이면 어느 쪽을 대표로 보여줄까"의 기준이다(보도 신뢰도 등급이 아니다).
 * Tier 1·2가 isMajor 대상 — 한국처럼 별도 목록을 또 만들지 않는다(대만 방식).
 */
const EN_TIER: Record<string, 1 | 2 | 3> = {
  // Tier 1 — 종합·경제 1차 매체
  'Reuters': 1, 'Bloomberg': 1, 'Financial Times': 1, 'The Wall Street Journal': 1,
  'The New York Times': 1, 'The Economist': 1, 'Associated Press': 1, 'CNBC': 1,
  'Forbes': 1, 'Fortune': 1, 'Business Insider': 1, 'Axios': 1,
  // Tier 2 — 테크·산업 전문지
  'TechCrunch': 2, 'The Verge': 2, 'Wired': 2, 'Ars Technica': 2,
  'MIT Technology Review': 2, 'VentureBeat': 2, 'The Information': 2,
  'Sifted': 2, 'TechNode': 2, 'South China Morning Post': 2, 'Tech in Asia': 2,
  'e27': 2, 'The Block': 2, 'CoinDesk': 2, 'Cointelegraph': 2,
  'STAT News': 2, 'Endpoints News': 2, 'Fierce Biotech': 2, 'BioPharma Dive': 2,
  'Nature': 2, 'Science': 2, 'PitchBook': 2, 'Crunchbase News': 2,
  'Financial News London': 2, 'City AM': 2, 'Breakit': 2, 'Di Digital': 2,
  // Tier 3 — 지역·틈새·리스티클
  'ZDNET': 3, 'Engadget': 3, 'Gizmodo': 3, 'TechRadar': 3, 'SiliconAngle': 3,
  'Yahoo Finance': 3, 'MarketWatch': 3, 'Benzinga': 3, 'Seeking Alpha': 3,
  'The Next Web': 3, 'EU-Startups': 3, 'Tech.eu': 3, 'Calcalist': 3,
  'Globes': 3, 'The Straits Times': 3, 'Business Times Singapore': 3,
};

/** 표기 편차 → 표준 매체명. 같은 매체가 두 이름으로 오면 매체별 집계가 갈라진다. */
const EN_ALIASES: Record<string, string> = {
  'reuters.com': 'Reuters', 'Reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg', 'Bloomberg.com': 'Bloomberg', 'Bloomberg Law': 'Bloomberg',
  'FT': 'Financial Times', 'ft.com': 'Financial Times', 'Financial Times (FT)': 'Financial Times',
  'WSJ': 'The Wall Street Journal', 'wsj.com': 'The Wall Street Journal',
  'Wall Street Journal': 'The Wall Street Journal',
  'NYT': 'The New York Times', 'nytimes.com': 'The New York Times',
  'New York Times': 'The New York Times', 'New York Times Tech': 'The New York Times',
  'Economist': 'The Economist', 'economist.com': 'The Economist',
  'AP': 'Associated Press', 'AP News': 'Associated Press', 'apnews.com': 'Associated Press',
  'CNBC Tech': 'CNBC', 'cnbc.com': 'CNBC',
  'techcrunch.com': 'TechCrunch', 'TechCrunch+': 'TechCrunch',
  'theverge.com': 'The Verge', 'wired.com': 'Wired', 'WIRED': 'Wired',
  'arstechnica.com': 'Ars Technica',
  'Technology Review': 'MIT Technology Review', 'technologyreview.com': 'MIT Technology Review',
  'venturebeat.com': 'VentureBeat',
  'SCMP': 'South China Morning Post', 'SCMP Tech': 'South China Morning Post',
  'scmp.com': 'South China Morning Post',
  'STAT': 'STAT News', 'statnews.com': 'STAT News',
  'Endpoints': 'Endpoints News', 'endpts.com': 'Endpoints News',
  'FierceBiotech': 'Fierce Biotech',
  'Insider': 'Business Insider', 'businessinsider.com': 'Business Insider',
  'forbes.com': 'Forbes', 'fortune.com': 'Fortune', 'axios.com': 'Axios',
  'coindesk.com': 'CoinDesk', 'The Block Crypto': 'The Block',
  'Digital Trends': 'ZDNET',
  'Straits Times': 'The Straits Times',
  'Calcalist Tech': 'Calcalist', 'CTech': 'Calcalist',
};

/**
 * 제외 매체 — 아그리게이터·재배포·PR 와이어.
 * 이걸 안 막으면 같은 기사가 매체 10곳으로 부풀어 "여러 매체가 함께 보도" 신호가 망가진다.
 */
const EN_EXCLUDED: Record<string, string> = {
  'MSN': '아그리게이터(재배포)',
  'Yahoo': '아그리게이터(재배포)',
  'Yahoo News': '아그리게이터(재배포)',
  'Google News': '아그리게이터',
  'Flipboard': '아그리게이터',
  'SmartBrief': '뉴스레터 재배포',
  'PR Newswire': 'PR 와이어(보도자료)',
  'Business Wire': 'PR 와이어(보도자료)',
  'GlobeNewswire': 'PR 와이어(보도자료)',
  'EIN Presswire': 'PR 와이어(보도자료)',
  'Accesswire': 'PR 와이어(보도자료)',
  'openPR': 'PR 와이어(보도자료)',
  'Digital Journal': 'PR 재배포',
  'Medium': '개인 블로그 플랫폼',
  'Substack': '개인 뉴스레터 플랫폼',
  'LinkedIn': '소셜',
  'Reddit': '소셜',
  'Simply Wall St': '자동생성 종목 리포트',
  'Zacks': '자동생성 종목 리포트',
  'Insider Monkey': '자동생성 종목 리포트',
  'TipRanks': '자동생성 종목 리포트',
};

function normalize(source: string | null | undefined): string {
  const s = (source ?? '').trim();
  if (!s) return '';
  if (EN_ALIASES[s]) return EN_ALIASES[s]!;
  // 구글 뉴스는 "TechCrunch - Startups" 처럼 섹션을 붙여 주는 경우가 있다.
  const head = s.split(/\s+[-–|]\s+/)[0]!.trim();
  return EN_ALIASES[head] ?? head;
}

/**
 * 영문은 단어 경계로 매칭한다 — 부분일치를 쓰면 'fine'이 'define'·'refine'에,
 * 'hack'이 'hackathon'에 걸린다(대만은 띄어쓰기가 없어 반대로 부분일치를 쓴다).
 */
const CRISIS_PATTERNS: { category: string; keyword: string; re: RegExp }[] =
  Object.entries(EN_CRISIS_KEYWORDS).flatMap(([category, kws]) =>
    kws.map(keyword => ({
      category,
      keyword,
      re: new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    })),
  );

export const enUS: LanguagePack = {
  locale: 'en-US',
  label: '글로벌벤처스 (영문)',

  hasScript: (text) => !!text && LATIN.test(text),

  crisisKeywords: EN_CRISIS_KEYWORDS,
  matchCrisis: (text) => {
    const s = text ?? '';
    if (!s) return [];
    return CRISIS_PATTERNS.filter(p => p.re.test(s)).map(p => ({ category: p.category, keyword: p.keyword }));
  },

  media: {
    normalize,
    isCurated: (s) => EN_TIER[normalize(s)] !== undefined,
    exclusionReason: (s) => EN_EXCLUDED[normalize(s)] ?? null,
    // 대만 방식 — 이미 티어를 매겼으므로 메이저 목록을 또 만들지 않고 Tier 1·2를 쓴다.
    isMajor: (s) => {
      const tier = EN_TIER[normalize(s)];
      return tier !== undefined && tier <= 2;
    },
  },

  translationHints: [
    '- English source text; translate into natural Korean.',
    '- Keep company names in English: OpenSea, Animoca Brands, Vectara, 42 Technologies.',
    '  For companies with an established Korean name, use it: Memebox → 미미박스,',
    '  MangoPlate → 망고플레이트, KnowRe → 노리, Genoplan → 제노플랜,',
    '  H2O Hospitality → H2O호스피탈리티, Qubit Security → 큐비트시큐리티.',
    '- Funding rounds keep their English label: Series A → 시리즈 A, seed round → 시드 라운드.',
    '- USD amounts use the natural Korean form ($20M → 2,000만 달러, $1.5B → 15억 달러).',
    '- Do not translate ticker symbols or product names (NBA Top Shot, CENTAURI, Prep Pad).',
  ],
};

export { EN_TIER };
