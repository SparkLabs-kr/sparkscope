/**
 * 대만 매체명의 한국어·영어 표기.
 *
 * 왜 i18n 사전(en.ts)이 아니라 여기인가 — en.ts는 "한국어 키 → 영어" 한 방향 사전이다.
 * 대만 매체명은 키가 중문이라 그 구조에 맞지 않고, 한국어 표기도 따로 필요하다.
 * 그래서 중문 원명을 키로 두고 [한국어, 영어]를 함께 담는다.
 *
 * 키는 taiwan-media.ts의 name(정규화된 매체명)과 같아야 한다 —
 * 화면은 normalizeSource를 거친 값으로 조회한다.
 */
export const TAIWAN_MEDIA_NAMES: Record<string, [ko: string, en: string]> = {
  "Bella儂儂": ["벨라", "Bella"],
  "BigGo 財經": ["BigGo 재경", "BigGo Finance"],
  "CMoney": ["CMoney", "CMoney"],
  "CMoney投資網誌": ["CMoney 투자블로그", "CMoney Blog"],
  "DIGITIMES": ["디지타임스", "DIGITIMES"],
  "GeneOnline": ["GeneOnline", "GeneOnline"],
  "INSIDE": ["INSIDE", "INSIDE"],
  "LINE TODAY": ["라인 투데이", "LINE TODAY"],
  "Ludens Media": ["루덴스 미디어", "Ludens Media"],
  "Meet創業小聚": ["Meet 창업소취", "Meet Startup"],
  "MoneyDJ": ["MoneyDJ", "MoneyDJ"],
  "StorageReview.com": ["StorageReview", "StorageReview"],
  "TVBS新聞網": ["TVBS 뉴스", "TVBS News"],
  "TechNews 科技新報": ["테크뉴스", "TechNews"],
  "TechOrange 科技報橘": ["테크오렌지", "TechOrange"],
  "Yahoo 財經": ["야후 파이낸스", "Yahoo Finance"],
  "Yahoo新聞": ["야후 뉴스", "Yahoo News"],
  "Yahoo股市": ["야후 증시", "Yahoo Stock"],
  "bastillepost.com": ["바스티유포스트", "Bastille Post"],
  "indiagazette.com": ["인디아가제트", "India Gazette"],
  "sinotrade.com.tw": ["융펑금융", "SinoPac Securities"],
  "三立新聞網": ["산리신문망", "SETN"],
  "中央社": ["중앙통신사", "CNA"],
  "中時新聞網": ["중시신문망", "China Times"],
  "中華日報": ["중화일보", "China Daily News"],
  "今周刊": ["금주간", "Business Today"],
  "加密城市CryptoCity": ["크립토시티", "CryptoCity"],
  "匯流新聞網": ["회류신문망", "CNEWS"],
  "卡優新聞網": ["카유신문망", "CardU"],
  "台視": ["대만TV", "TTV"],
  "富果直送": ["푸궈", "Fugle"],
  "富聯網": ["푸롄왕", "MoneyLink"],
  "工商時報": ["공상시보", "Commercial Times"],
  "數位時代": ["디지털시대", "Business Next"],
  "旺得富理財網": ["왕더푸", "Wantrich"],
  "未來商務": ["미래상무", "Future Commerce"],
  "東森電視": ["동삼TV", "EBC"],
  "環球生技月刊": ["환구생기월간", "GlobalBio Monthly"],
  "生技投資第一站": ["생기투자 제일역", "GeneInfo"],
  "知新聞": ["지신문", "Zhi News"],
  "經濟日報": ["경제일보", "Economic Daily News"],
  "聯合報 UDN": ["연합보 UDN", "United Daily News"],
  "自由財經": ["자유재경", "Liberty Finance"],
  "蕃新聞": ["판신문", "Yam News"],
  "遠見雜誌": ["원견잡지", "Global Views Monthly"],
  "鉅亨網": ["거형망", "Cnyes"],
  "鏡週刊": ["경주간", "Mirror Media"],
  "非凡新聞": ["비범뉴스", "USTV"],
  "風傳媒": ["풍전매", "Storm Media"],
  "香港財經時報HKBT": ["홍콩재경시보", "HKBT"],
};

/** 대만 매체명을 언어에 맞게. 목록에 없으면 null — 호출부가 기존 방식으로 떨어진다. */
export function taiwanMediaName(source: string | null | undefined, locale: 'ko' | 'en'): string | null {
  if (!source) return null;
  const hit = TAIWAN_MEDIA_NAMES[source];
  if (!hit) return null;
  return locale === 'en' ? hit[1] : hit[0];
}
