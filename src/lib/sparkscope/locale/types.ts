/**
 * 로케일 = 언어 팩. 파이프라인이 나라별로 분기하지 않고 팩을 조회해서 쓰게 만든다.
 *
 * 왜 —  대만을 붙이면서 언어 의존 로직이 taiwan-*.ts 4개 파일 538줄로 흩어졌고,
 * analyzer·translate-content·prompts 안에는 "한국어일 것"이라는 가정이 그대로 남아 있었다.
 * 홍콩·호주를 같은 방식으로 붙이면 hongkong-*.ts, australia-*.ts가 또 생기고
 * 파이프라인 곳곳에 if (category === ...) 분기가 늘어난다.
 *
 * 팩으로 묶으면 새 오피스는 "데이터 파일 하나"가 된다 — analyzer.ts를 건드리지 않는다.
 *
 * 지금은 Taiwan만 실제로 채운다. 구조만 먼저 세우고, 홍콩 팩은 그때 데이터만 쓴다.
 */
import type { Category } from '../types';

/** BCP 47. DB에 locale 컬럼이 생기면 이 값이 그대로 들어간다. */
export type Locale = 'ko-KR' | 'zh-TW';

export interface LocaleMedia {
  /** 표기 편차 → 표준 매체명. 같은 매체가 두 이름으로 오면 집계가 갈라진다. */
  normalize(source: string | null | undefined): string;
  /** 큐레이션된 현지 매체인가 — 매체별 노출 분포는 이걸 통과한 것만 센다. */
  isCurated(source: string | null | undefined): boolean;
  /** 제외 사유(해외·아그리게이터·재배포 등). 제외 대상이 아니면 null. */
  exclusionReason(source: string | null | undefined): string | null;
  /** 메이저 매체 가중치 대상인가. 한국은 고정 목록, 대만은 Tier 1·2. */
  isMajor(source: string | null | undefined): boolean;
}

export interface LanguagePack {
  locale: Locale;
  /** 로그·UI 표기용 */
  label: string;

  /**
   * 이 로케일의 문자가 있는가. 번역 대상 판정과 프롬프트 힌트 선택에 쓴다.
   * 한글만 보던 needsTranslation()이 중문을 전부 놓쳤던 게 이 함수가 없어서였다.
   */
  hasScript(text: string | null | undefined): boolean;

  /** 부정·위기 키워드 (카테고리 → 키워드) */
  crisisKeywords: Record<string, string[]>;
  /**
   * 제목에서 위기 키워드를 찾는다.
   * 중문은 띄어쓰기가 없어 단어 경계(\b)를 못 쓴다 — 로케일마다 매칭 방식이 다르므로
   * 상수가 아니라 함수로 둔다.
   */
  matchCrisis(text: string): { category: string; keyword: string }[];

  media: LocaleMedia;

  /**
   * 번역 프롬프트에 끼워 넣을 로케일 고유 지침.
   * 대만 시장 용어(創新板 → Innovation Board)처럼 로케일을 알아야 옳게 번역되는 것들.
   */
  translationHints: string[];
}

/**
 * 카테고리 → 로케일. DB에 locale 컬럼이 생기기 전까지의 다리다.
 *
 * 작업계획서 지적대로 지금은 나라가 분류명(portfolio_company_tw) 안에 들어 있다.
 * 컬럼이 생기면 파이프라인은 그대로 두고 이 함수만 target.locale을 읽도록 바꾸면 된다 —
 * 분기가 여기 한 곳에만 있는 게 이 구조의 목적이다.
 */
export function localeOfCategory(category: Category | string): Locale {
  return category === 'portfolio_company_tw' ? 'zh-TW' : 'ko-KR';
}
