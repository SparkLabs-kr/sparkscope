/**
 * zh-TW — 대만(번체 중문) 언어 팩.
 *
 * 데이터는 기존 taiwan-*.ts에 그대로 두고 여기서는 팩 인터페이스에 맞춰 감싸기만 한다.
 * 파일을 통째로 옮기면 diff가 커져서 리뷰가 안 되고, 데이터와 어댑터를 나눠 두면
 * 홍콩 팩이 대만 데이터 파일 구조를 그대로 복제해 쓰기도 쉽다.
 */
import {
  TAIWAN_TIER_OF,
  normalizeTaiwanSource,
  isCuratedTaiwanSource,
  taiwanExclusionReason,
} from '../taiwan-media';
import {
  TAIWAN_CRISIS_KEYWORDS,
  matchTaiwanCrisisKeywords,
} from '../taiwan-crisis-keywords';
import type { LanguagePack } from './types';

/**
 * CJK 통합 한자(一-鿿) + 호환 한자(豈-﫿).
 * 호환 영역은 대만 인명·지명 표기에 실제로 쓰인다.
 */
const HAN = /[一-鿿豈-﫿]/;

export const zhTW: LanguagePack = {
  locale: 'zh-TW',
  label: '대만 (번체 중문)',

  hasScript: (text) => !!text && HAN.test(text),

  crisisKeywords: TAIWAN_CRISIS_KEYWORDS,
  matchCrisis: (text) => matchTaiwanCrisisKeywords(text),

  media: {
    normalize: (s) => normalizeTaiwanSource(s),
    isCurated: (s) => isCuratedTaiwanSource(s),
    exclusionReason: (s) => taiwanExclusionReason(s),
    // 한국은 메이저 매체를 고정 목록으로 두지만, 대만은 이미 티어를 매겨 뒀으므로
    // 목록을 또 만들지 않고 Tier 1·2를 그대로 쓴다.
    isMajor: (s) => {
      const tier = TAIWAN_TIER_OF.get(normalizeTaiwanSource(s));
      return tier !== undefined && tier <= 2;
    },
  },

  translationHints: [
    '- Traditional Chinese (Taiwan) source text.',
    '- Keep official English company names: 永悅健康 → H2U, 稜研科技 → TMY Technology,',
    '  時刻科技 → FunNow, 行動貝果 → MoBagel, 圖睿科技 → GRAID Technology, 耐能智慧 → Kneron.',
    '  Otherwise romanize by Hanyu Pinyin.',
    '- Taiwan market terms have set English equivalents: 創新板 → Innovation Board,',
    '  興櫃 → Emerging Stock Board, 掛牌/上市 → listing, 法說會 → earnings call,',
    '  淨損 → net loss, 年增 → YoY, 競拍 → auction tranche.',
    '- 億元/萬元 are TWD unless stated otherwise (1.073億元 → TWD 107.3M).',
  ],
};
