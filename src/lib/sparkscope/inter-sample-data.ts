// Inter(해외 트렌드) 탭 — 샘플 데이터
//
// ⚠️ 아직 해외 소스 수집 파이프라인이 없어 전부 더미 데이터다.
// 실제 수집이 붙으면 이 파일 대신 DB 조회 결과로 교체한다.
// (바이오는 이령, AI는 소윤이 각자 소스 목록을 정해 붙일 예정 — CLAUDE.md 참고)

export type InterDomain = 'bio' | 'ai';
export type InterCountry = 'us' | 'cn' | 'jp' | 'sa' | 'all';
export type SourceKind = 'news' | 'paper' | 'opinion';
export type AlertLevel = 'urgent' | 'watch' | 'pos';

export const COUNTRY_TABS: { id: InterCountry; label: string }[] = [
  { id: 'us', label: '미국' },
  { id: 'cn', label: '중국' },
  { id: 'jp', label: '일본' },
  { id: 'sa', label: '사우디' },
  { id: 'all', label: '전체' },
];

export interface DomainSummary {
  label: string;
  trend: string;
  position: string;
  action: string;
}

export const DOMAIN_SUMMARY: Record<InterDomain, DomainSummary> = {
  bio: {
    label: '바이오',
    trend: 'AI 신약개발 임상 성공률 상승으로 글로벌 바이오 투자 재가속 — 미국 중심 임상 AI 스타트업에 자금 집중.',
    position: '스파크랩파트너스의 임상전문특화병원 설립이 이 흐름과 직결 — 임상 데이터 허브로서 선점 기회 존재.',
    action: 'AI 신약 파이프라인 보유 스타트업 발굴 및 임상병원과의 파이프라인 연계 논의 선제적으로 시작.',
  },
  ai: {
    label: 'AI',
    trend: '에이전틱 AI의 엔터프라이즈 도입이 급가속 — SaaS 대체 수요 본격화, 1인 창업자 생산성 도구 시장 급성장.',
    position: '스파크랩 스파크클로 프로그램이 이 흐름을 선점 — 1인 AI 창업자 육성에서 글로벌 AC 중 가장 빠른 움직임.',
    action: '에이전틱 AI 포트폴리오사 글로벌 피칭 기회 발굴 및 경쟁 AC 대비 포지셔닝 명확화.',
  },
};

export interface InterStat {
  label: string;
  value: string;
}

export const DOMAIN_STATS: Record<InterDomain, InterStat[]> = {
  bio: [
    { label: '수집된 해외 소스', value: '1,842' },
    { label: '신규 논문 · 프리프린트', value: '37' },
    { label: '포트폴리오 매치', value: '19' },
    { label: '신기술 시그널', value: '8' },
  ],
  ai: [
    { label: '수집된 해외 소스', value: '2,105' },
    { label: '신규 논문 · 프리프린트', value: '52' },
    { label: '포트폴리오 매치', value: '14' },
    { label: '신기술 시그널', value: '11' },
  ],
};

export interface PortfolioMatch {
  co: string;
  desc: string;
}

export interface SourceItem {
  badge: SourceKind;
  title: string;
  media: string;
  date: string;
  alert: AlertLevel;
}

export interface SectorBlock {
  id: string;
  icon: string;
  name: string;
  sub: string;
  badge: { cls: 'urgent' | 'watch' | 'pos' | 'neu'; label: string };
  matches: PortfolioMatch[];
  items: Record<SourceKind, SourceItem[]>;
}

export const SECTOR_DATA: Record<InterDomain, SectorBlock[]> = {
  bio: [
    {
      id: 'sec-anticancer',
      icon: '🔬',
      name: '항암',
      sub: '면역항암·표적치료·ADC',
      badge: { cls: 'urgent', label: '긴급 대응' },
      matches: [
        { co: '지놈앤컴퍼니', desc: 'ADC 플랫폼 특허 분쟁 리스크 — 경쟁사 동향 모니터링 필요' },
        { co: '큐라티스', desc: '면역항암 임상 3상 결과 발표 임박, 긍정 시그널' },
      ],
      items: {
        news: [
          { badge: 'news', title: 'GSK, ADC 바이오텍 인수 검토…韓 기업 밸류에이션 재조명', media: 'FiercePharma', date: '2026.07.25', alert: 'watch' },
          { badge: 'news', title: 'FDA, 면역항암제 병용요법 가속 승인 절차 간소화 발표', media: 'BioPharma Dive', date: '2026.07.24', alert: 'pos' },
          { badge: 'news', title: '中 항암신약, 미국 시장 진입 강화…특허 분쟁 본격화', media: 'Reuters Health', date: '2026.07.23', alert: 'urgent' },
        ],
        paper: [
          { badge: 'paper', title: 'CAR-T 세포 지속성 향상을 위한 epigenetic 리프로그래밍 전략', media: 'Nature Medicine', date: '2026.07.22', alert: 'pos' },
          { badge: 'paper', title: 'ADC 내성 기전 분석: payload 전달 경로 다각화의 필요성', media: 'Cancer Cell', date: '2026.07.20', alert: 'watch' },
        ],
        opinion: [
          { badge: 'opinion', title: '[칼럼] 韓 ADC 빅딜 시대 열리나 — 넥스트 레고켐을 찾아라', media: 'BioPharma Korea', date: '2026.07.24', alert: 'pos' },
        ],
      },
    },
    {
      id: 'sec-dd',
      icon: '💊',
      name: '약물전달',
      sub: '나노입자·LNP·경구제형',
      badge: { cls: 'watch', label: '모니터링' },
      matches: [
        { co: '아이큐어', desc: '경피흡수 플랫폼, mRNA 백신 응용 가능성 긍정적' },
      ],
      items: {
        news: [
          { badge: 'news', title: 'LNP 기반 mRNA 전달기술 특허 만료…후발주자 기회 열려', media: 'Endpoints News', date: '2026.07.24', alert: 'pos' },
          { badge: 'news', title: '경구형 GLP-1 임상 경쟁 가속 — 흡수율 개선이 핵심', media: 'STAT News', date: '2026.07.22', alert: 'watch' },
        ],
        paper: [
          { badge: 'paper', title: 'Lipid nanoparticle 조성 최적화를 통한 간 외 조직 표적 전달', media: 'Nature Nanotechnology', date: '2026.07.21', alert: 'pos' },
        ],
        opinion: [],
      },
    },
    {
      id: 'sec-drug',
      icon: '🧬',
      name: '신약',
      sub: 'AI 신약발굴·희귀질환',
      badge: { cls: 'pos', label: '기회' },
      matches: [
        { co: '스탠다임', desc: 'AI 신약 발굴 플랫폼 글로벌 수요 증가, 파트너십 확대 유리' },
        { co: '파로스IBT', desc: '희귀질환 파이프라인, FDA 오파판 지정 확대 기조 긍정적' },
      ],
      items: {
        news: [
          { badge: 'news', title: 'AI 신약발굴 스타트업 투자 YTD $4.2B 돌파 — 글로벌 사상 최대', media: 'PitchBook', date: '2026.07.25', alert: 'pos' },
          { badge: 'news', title: 'FDA 희귀질환 심사 기간 단축 가이드라인 초안 공개', media: 'FDA News', date: '2026.07.23', alert: 'pos' },
        ],
        paper: [
          { badge: 'paper', title: '대규모 언어모델 기반 단백질 상호작용 예측 정확도 95% 달성', media: 'Science', date: '2026.07.20', alert: 'pos' },
        ],
        opinion: [
          { badge: 'opinion', title: '[기고] 한국 AI 신약 스타트업이 글로벌 빅파마 레이더에 잡힌 이유', media: '한국경제', date: '2026.07.23', alert: 'pos' },
        ],
      },
    },
    {
      id: 'sec-device',
      icon: '🩺',
      name: '의료기기',
      sub: 'AI 진단·로봇수술·웨어러블',
      badge: { cls: 'neu', label: '중립' },
      matches: [
        { co: '메디픽셀', desc: 'AI 영상진단 FDA 허가 취득 — 미국 진출 모멘텀' },
      ],
      items: {
        news: [
          { badge: 'news', title: '로봇수술 플랫폼 점유율 경쟁 심화 — 인튜이티브 독주 흔들', media: 'MedCity News', date: '2026.07.24', alert: 'watch' },
          { badge: 'news', title: 'FDA AI/ML 기반 의료기기 규제 프레임워크 최종본 발표', media: 'Medical Device News', date: '2026.07.22', alert: 'pos' },
        ],
        paper: [
          { badge: 'paper', title: '웨어러블 연속혈당측정기의 당뇨 예측 민감도 임상 검증', media: 'NEJM', date: '2026.07.19', alert: 'pos' },
        ],
        opinion: [
          { badge: 'opinion', title: '[분석] AI 진단기기 보험 급여 확대 — 韓 규제 선진화 시급', media: '청년의사', date: '2026.07.22', alert: 'watch' },
        ],
      },
    },
  ],
  ai: [
    {
      id: 'sec-agentic',
      icon: '🤖',
      name: '에이전틱 AI',
      sub: '자율 에이전트·멀티에이전트 협업',
      badge: { cls: 'urgent', label: '긴급 모니터링' },
      matches: [
        { co: '뤼튼테크놀로지스', desc: '기업용 에이전트 도입 수요 급증, 경쟁 심화 주의 필요' },
      ],
      items: {
        news: [
          { badge: 'news', title: 'OpenAI o3 에이전트, 실무 태스크 자동화 성공률 72% 보고', media: 'The Verge', date: '2026.07.25', alert: 'urgent' },
          { badge: 'news', title: '엔터프라이즈 AI 에이전트 시장 2026년 $15B 돌파 전망', media: 'Forbes Tech', date: '2026.07.24', alert: 'watch' },
        ],
        paper: [
          { badge: 'paper', title: 'Multi-agent LLM 시스템에서 환각 감소를 위한 크로스-체크 메커니즘', media: 'arXiv', date: '2026.07.22', alert: 'pos' },
        ],
        opinion: [
          { badge: 'opinion', title: '[칼럼] 에이전트 AI의 등장이 SaaS 비즈니스 모델을 어떻게 바꾸는가', media: 'Harvard Business Review', date: '2026.07.23', alert: 'watch' },
        ],
      },
    },
    {
      id: 'sec-ondevice',
      icon: '📱',
      name: '온디바이스 AI',
      sub: '엣지 추론·경량화 모델',
      badge: { cls: 'pos', label: '기회' },
      matches: [
        { co: '딥엑스', desc: 'NPU 칩 수요 급증, 파운드리 협력 확대 기회' },
      ],
      items: {
        news: [
          { badge: 'news', title: '애플 A19 칩, 온디바이스 LLM 7B 파라미터 실시간 추론 달성', media: '9to5Mac', date: '2026.07.24', alert: 'pos' },
          { badge: 'news', title: '퀄컴-삼성, 온디바이스 AI 반도체 공동 개발 MOU 체결', media: '연합뉴스', date: '2026.07.23', alert: 'pos' },
        ],
        paper: [
          { badge: 'paper', title: 'Quantization-aware training으로 3B 모델 모바일 지연시간 40ms 달성', media: 'arXiv', date: '2026.07.21', alert: 'pos' },
        ],
        opinion: [],
      },
    },
    {
      id: 'sec-regulation',
      icon: '⚖️',
      name: '규제·거버넌스',
      sub: 'EU AI Act·글로벌 AI 정책',
      badge: { cls: 'watch', label: '규제 리스크' },
      matches: [
        { co: '뤼튼테크놀로지스', desc: 'EU 시장 진출 시 EU AI Act 고위험 AI 규제 적용 가능' },
        { co: '스탠다임', desc: '의료 AI 분야 규제 강화 — 유럽 승인 절차 복잡도 증가' },
      ],
      items: {
        news: [
          { badge: 'news', title: 'EU AI Act 고위험 AI 시스템 의무 시행 — 2026.08.02부터', media: 'TechCrunch EU', date: '2026.07.25', alert: 'urgent' },
          { badge: 'news', title: '미국 AI 행정명령 후속 조치 — 연방 기관 AI 조달 기준 강화', media: 'Politico', date: '2026.07.23', alert: 'watch' },
        ],
        paper: [],
        opinion: [
          { badge: 'opinion', title: '[기고] EU AI Act 시행 100일 전 — 한국 AI 기업이 준비해야 할 3가지', media: '동아비즈니스리뷰', date: '2026.07.24', alert: 'urgent' },
        ],
      },
    },
  ],
};

// 참고: 도메인별 해외 소스 후보 목록 (CLAUDE.md 논의 기준, 아직 수집 미연동)
export const SOURCE_CANDIDATES: Record<InterDomain, { region: string; outlets: string[] }[]> = {
  ai: [
    { region: 'AI·스타트업 버티컬', outlets: ['TechCrunch', 'The Information', 'VentureBeat', 'CB Insights', 'Wired', 'The Verge', 'Ars Technica'] },
    { region: '종합 경제', outlets: ['Bloomberg', 'The Wall Street Journal', 'Financial Times', 'Reuters', 'The New York Times', 'CNN', 'The Washington Post'] },
  ],
  bio: [
    { region: '바이오·헬스케어 버티컬', outlets: ['Endpoints News', 'STAT News', 'Fierce Biotech', 'BioCentury', 'BioPharma Dive'] },
    { region: '오피니언 리딩', outlets: ['MIT Technology Review', 'Nature', 'Cell', 'Science', 'Scientific American'] },
  ],
};
