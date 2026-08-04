/**
 * Inter(해외 트렌드) 탭 — 바이오/AI 도메인 섹터 택소노미.
 *
 * 고정 리스트로 간다(동적 클러스터링 아님). 이유:
 *  - 목업 UI가 "에이전틱 AI" 같은 섹션 이름이 매일 동일하게 유지되는 걸 전제로 함
 *    (긴급 모니터링 배지가 날짜를 넘나들며 누적되려면 섹션 정체성이 고정이어야 함).
 *  - 매일 군집화+네이밍까지 LLM으로 하면 비용이 늘고 이름이 미묘하게 흔들림.
 *  - 실제로 이 리스트가 부족하다는 불만이 나오면 그때 확장(처음부터 과설계 금지).
 *
 * 회사 자체 분류(COMPANY_*_SECTORS)와 뉴스 트렌드 클러스터(*_TREND_SECTORS)는
 * 하위 섹터를 공유하되, 트렌드 쪽에만 "도메인 전체를 가로지르는" cross-cutting 섹터가 추가된다
 * (예: EU AI Act는 특정 서브섹터 회사가 아니라 AI 도메인 전체에 영향 — 특정 회사 매칭은
 * 사전 섹터 태그로 좁히지 않고 포트폴리오 매치 단계(추론 모델)에서 도메인 전체를 후보로 판단한다).
 */

export type InterDomain = '바이오' | 'AI';

// ── 회사 자체 분류용 (scripts/tag-portfolio-sectors.ts에서 사용) ──
export const COMPANY_BIO_SECTORS = ['항암', '약물전달', '신약발굴', '의료기기·진단', '디지털헬스', '기타 바이오'] as const;
export const COMPANY_AI_SECTORS = ['에이전틱AI', '온디바이스AI·엣지', '생성형AI·콘텐츠', 'AI인프라·데이터', 'AI버티컬 SaaS', '기타 AI'] as const;
export const COMPANY_OTHER_SECTORS = [
  '커머스·D2C', '핀테크', 'F&B·푸드테크', '블록체인·웹3', '모빌리티·물류', '보안',
  'HR·생산성 SaaS', '콘텐츠·미디어·엔터', '프롭테크·공간', '뷰티·라이프스타일',
  '에듀테크', '여행·트래블', '제조·딥테크·소재', '게임', '소셜·커뮤니티', '기타',
] as const;

// 도메인 전체에 적용되는 cross-cutting 뉴스 주제 — 회사 sector 태그로는 안 씀.
export const CROSS_CUTTING_TREND_SECTORS = ['규제·거버넌스', '투자·산업동향'] as const;

// ── 매일 수집되는 해외 기사를 분류할 때 쓰는 트렌드 섹터(아코디언 단위) ──
export const BIO_TREND_SECTORS = [
  { key: '항암', icon: '🔬', sub: '면역항암·표적치료·ADC' },
  { key: '약물전달', icon: '💊', sub: '나노입자·LNP·경구제형' },
  { key: '신약발굴', icon: '🧬', sub: 'AI 신약발굴·희귀질환' },
  { key: '의료기기·진단', icon: '🩺', sub: 'AI 진단·로봇수술·웨어러블' },
  { key: '디지털헬스', icon: '📱', sub: '원격의료·헬스 데이터·환자관리' },
  { key: '규제·거버넌스', icon: '⚖️', sub: 'FDA·EMA·임상 규제 동향' },
  { key: '투자·산업동향', icon: '💰', sub: '펀딩·M&A·빅파마 딜' },
] as const;

export const AI_TREND_SECTORS = [
  { key: '에이전틱AI', icon: '🤖', sub: '자율 에이전트·멀티에이전트 협업' },
  { key: '온디바이스AI·엣지', icon: '📱', sub: '엣지 추론·경량화 모델' },
  { key: '생성형AI·콘텐츠', icon: '🎨', sub: '생성 모델·콘텐츠 제작 도구' },
  { key: 'AI인프라·데이터', icon: '🗄️', sub: '컴퓨트·데이터 파이프라인·모델 인프라' },
  { key: '규제·거버넌스', icon: '⚖️', sub: 'EU AI Act·글로벌 AI 정책' },
  { key: '투자·산업동향', icon: '💰', sub: '펀딩·M&A·시장 규모' },
] as const;

export function trendSectorsFor(domain: InterDomain) {
  return domain === '바이오' ? BIO_TREND_SECTORS : AI_TREND_SECTORS;
}

/*
 * ── 축 분리 (2026-08-04) ──────────────────────────────────────────────
 * 위 *_TREND_SECTORS는 축이 섞여 있다: 5개는 주제(항암·신약발굴 …)인데
 * '규제·거버넌스'와 '투자·산업동향'은 주제가 아니라 "무슨 일이 일어났는가"(사건 유형)다.
 * 그래서 "머크가 항암 신약사를 32조에 인수" 같은 기사가 항암이 아니라 투자로 분류되고,
 * 실제로 투자·산업동향 혼자 relevant 450건 중 151건(34%)을 먹고 있었다(규제 46건 추가).
 *
 * 아래처럼 축을 둘로 분리한다:
 *   주제(topicSector)   — 무엇에 관한 기사인가
 *   사건 유형(eventType) — 무슨 일이 일어났는가
 * 화면에서는 이 둘을 교차한 매트릭스로 보여준다("항암 × 투자·딜").
 *
 * 기존 sector 컬럼은 그대로 두고(레거시·되돌리기용) topicSector/eventType을 새로 채운다.
 */

export const INTER_EVENT_TYPES = [
  { key: '투자·딜', icon: '💰', sub: '라운드·M&A·IPO' },
  { key: '규제·승인', icon: '⚖️', sub: 'FDA/EMA·정책·소송' },
  { key: '연구성과', icon: '🔬', sub: '임상 결과·논문' },
  { key: '제품·상용화', icon: '🚀', sub: '출시·파트너십' },
  { key: '시장·인물', icon: '📊', sub: '전망·인사·조직' },
] as const;

export type InterEventType = (typeof INTER_EVENT_TYPES)[number]['key'];

// 주제 축 — cross-cutting(규제·투자)을 뺀 순수 주제만. 매트릭스의 행이 된다.
export const BIO_TOPIC_SECTORS = [
  { key: '항암', icon: '🔬', sub: '면역항암·표적치료·ADC' },
  { key: '신약발굴', icon: '🧬', sub: 'AI 신약발굴·희귀질환' },
  { key: '의료기기·진단', icon: '🩺', sub: 'AI 진단·로봇수술·웨어러블' },
  { key: '디지털헬스', icon: '📱', sub: '원격의료·헬스 데이터·환자관리' },
  { key: '약물전달·제형', icon: '💊', sub: '나노입자·LNP·경구제형' },
] as const;

export const AI_TOPIC_SECTORS = [
  { key: '에이전틱AI', icon: '🤖', sub: '자율 에이전트·멀티에이전트 협업' },
  { key: '생성형AI·콘텐츠', icon: '🎨', sub: '생성 모델·콘텐츠 제작 도구' },
  { key: 'AI인프라·데이터', icon: '🗄️', sub: '컴퓨트·데이터 파이프라인·모델 인프라' },
  { key: 'AI버티컬', icon: '🏢', sub: '산업별 AI 적용·엔터프라이즈' },
  { key: '온디바이스AI·엣지', icon: '📲', sub: '엣지 추론·경량화 모델' },
] as const;

export function topicSectorsFor(domain: InterDomain) {
  return domain === '바이오' ? BIO_TOPIC_SECTORS : AI_TOPIC_SECTORS;
}

/**
 * 레거시 sector → 새 주제 축 매핑.
 * 백필이 아직 안 닿은 verdict(topicSector=null)를 화면에서 최소한 어디엔가 놓기 위한 fallback.
 * '규제·거버넌스'/'투자·산업동향'은 주제가 아니므로 매핑 불가 → null(백필로만 해결된다).
 */
export function legacySectorToTopic(sector: string | null): string | null {
  if (!sector) return null;
  const direct: Record<string, string> = {
    '약물전달': '약물전달·제형',
    'AI버티컬 SaaS': 'AI버티컬',
  };
  if (direct[sector]) return direct[sector];
  const known = [...BIO_TOPIC_SECTORS, ...AI_TOPIC_SECTORS].some(s => s.key === sector);
  return known ? sector : null;
}
