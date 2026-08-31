/**
 * 대만(번체 중문) 부정·위기 키워드 — crisis-keywords.ts의 대만판.
 *
 * 왜 별도 파일인가 — 기존 CRISIS_KEYWORDS는 100% 한국어다(소송·적자·해킹…).
 * 대만 기사에는 단 하나도 걸리지 않으므로 대만 포트폴리오사는 위기 신호가
 * 구조적으로 잡히지 않았다. 한국 목록에 섞으면 한국 기사 판정에 중문 키워드가
 * 끼어들어 오탐을 만들 수 있어, taiwan-noise.ts·taiwan-media.ts와 같은 방식으로 분리한다.
 *
 * 카테고리 키는 한국판과 동일하게 맞췄다 — 대시보드가 카테고리별로 묶어 보여주므로
 * 키가 갈라지면 화면에서 두 벌로 나뉜다.
 *
 * 번체(대만) 표기 기준이다. 간체는 대만 매체에서 쓰지 않으므로 넣지 않는다.
 */
export const TAIWAN_CRISIS_KEYWORDS: Record<string, string[]> = {
  법적규제: [
    '訴訟', '起訴', '告發', '搜索', '羈押', '罰鍰', '裁罰', '違法', '違規',
    '調查', '檢調', '公平會', '金管會', '稅務調查', '停牌', '重大訊息',
  ],
  재무경영: [
    '虧損', '淨損', '破產', '重整', '跳票', '流動性危機', '裁員', '欠薪',
    '停業', '下市', '下櫃', '經營困難', '減資', '財報不實', '營收衰退', '年減',
  ],
  제품사고: [
    '瑕疵', '召回', '故障', '當機', '停擺', '駭客', '個資外洩', '資安事件',
    '不良', '副作用', '服務終止', '停止服務',
  ],
  평판윤리: [
    '爭議', '疑雲', '掏空', '背信', '弊案', '賄賂', '性騷擾', '職場霸凌',
    '抄襲', '詐欺', '不實', '誇大廣告', '爭議事件',
  ],
  소비자여론: [
    '抵制', '拒買', '抗議', '集體訴訟', '受害', '道歉聲明', '澄清', '反彈',
    '批評', '負評', '負面評價',
  ],
  노사내부: [
    '罷工', '工會爭議', '內鬥', '經營權之爭', '內部爆料', '揭發', '請辭', '離職潮',
  ],
  안전사고: ['事故', '火災', '死亡', '受傷', '職災', '安全問題'],
  /**
   * 상장 시장 반응 — 한국판에 없는 대만 전용 분류.
   * 대만 포트폴리오사 중 상장·흥櫃 기업(永悅健康 7835, 稜研科技 7812)이 있어
   * 주가 급락이 실제 부정 보도로 잡힌다. 3개월 트라이얼 부정 10건 중
   * 6건이 永悅健康 상장일 급락 보도였다("盤中跌逾2成", "蜜月行情失靈").
   */
  상장시장: ['跌逾', '慘跌', '重挫', '破發', '蜜月行情失靈', '摜破', '跌停'],
};

export const TAIWAN_CRISIS_KEYWORDS_FLAT: string[] = Array.from(
  new Set(Object.values(TAIWAN_CRISIS_KEYWORDS).flat()),
);

/** 프롬프트 삽입용 — crisisKeywordsForPrompt()와 같은 형식. */
export function taiwanCrisisKeywordsForPrompt(): string {
  return Object.entries(TAIWAN_CRISIS_KEYWORDS)
    .map(([cat, kws]) => `  - ${cat}: ${kws.join(', ')}`)
    .join('\n');
}

/**
 * 제목에 걸린 위기 키워드를 돌려준다(카테고리 포함). 없으면 빈 배열.
 * 중문은 띄어쓰기가 없어 단어 경계(\b)를 쓸 수 없으므로 부분일치로 판정한다 —
 * 한국어 로직을 그대로 가져오면 여기서 전부 미스가 난다.
 */
export function matchTaiwanCrisisKeywords(text: string): { category: string; keyword: string }[] {
  const s = text ?? '';
  if (!s) return [];
  const hits: { category: string; keyword: string }[] = [];
  for (const [category, kws] of Object.entries(TAIWAN_CRISIS_KEYWORDS)) {
    for (const keyword of kws) {
      if (s.includes(keyword)) hits.push({ category, keyword });
    }
  }
  return hits;
}
