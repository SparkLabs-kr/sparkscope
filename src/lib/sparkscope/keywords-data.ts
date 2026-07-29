/**
 * keywords 정적 데이터 (빌드타임 로드)
 * fs import가 없으므로 client bundle에 포함 가능
 *
 * 주의: 이 파일은 프로덕션 빌드 중에만 업데이트됨
 * data 폴더 CSV 파일 변경 후엔 빌드 필요
 */

export interface NegativeKeyword {
  type: string;
  keyword: string;
}

export interface CrisisKeyword {
  category: string;
  keyword: string;
}

// data/negative-keywords.csv 정적 데이터
export const NEGATIVE_KEYWORDS_DATA: NegativeKeyword[] = [
  { type: "부도/파산", keyword: "파산" },
  { type: "부도/파산", keyword: "도산" },
  { type: "부도/파산", keyword: "부도" },
  { type: "손실/손해", keyword: "손실" },
  { type: "손실/손해", keyword: "손해" },
  { type: "손실/손해", keyword: "적손" },
  { type: "분쟁/고소", keyword: "소송" },
  { type: "분쟁/고소", keyword: "고소" },
  { type: "분쟁/고소", keyword: "분쟁" },
  { type: "분쟁/고소", keyword: "논란" },
  { type: "위반/적발", keyword: "위반" },
  { type: "위반/적발", keyword: "적발" },
  { type: "감소/하락", keyword: "감소" },
  { type: "감소/하락", keyword: "하락" },
  { type: "감소/하락", keyword: "급락" },
  { type: "감소/하락", keyword: "급감" },
  { type: "부정적 평가", keyword: "비판" },
  { type: "부정적 평가", keyword: "평가절하" },
  { type: "부정적 평가", keyword: "낮은평가" },
  { type: "실적악화", keyword: "실적부진" },
  { type: "실적악화", keyword: "적자전환" },
  { type: "실적악화", keyword: "매출감소" },
  { type: "실적악화", keyword: "영업손실" },
  { type: "구조조정", keyword: "구조조정" },
  { type: "구조조정", keyword: "해고" },
  { type: "구조조정", keyword: "감원" },
  { type: "구조조정", keyword: "정리해고" },
  // "매각"은 넣지 않음 — 스타트업/포트폴리오사 맥락에서는 "매각"이 곧 성공적 exit(인수)인 경우가
  // 많아 부정으로 단정할 수 없음(예: "OO스타트업, 대기업에 매각" 은 오히려 좋은 뉴스인 경우가 다수).
  { type: "매각/철수", keyword: "철수" },
  { type: "매각/철수", keyword: "청산" },
  { type: "매각/철수", keyword: "폐업" },
  { type: "매각/철수", keyword: "사업중단" },
  { type: "제품결함", keyword: "리콜" },
  { type: "제품결함", keyword: "결함" },
  { type: "제품결함", keyword: "불량" },
  { type: "재무위험", keyword: "부채" },
  { type: "재무위험", keyword: "연체" },
  { type: "재무위험", keyword: "유동성위기" },
  { type: "재무위험", keyword: "자본잠식" },
  { type: "제재/처벌", keyword: "제재" },
  { type: "제재/처벌", keyword: "벌금" },
  { type: "제재/처벌", keyword: "과징금" },
  { type: "제재/처벌", keyword: "기소" },
  { type: "제재/처벌", keyword: "압수수색" },
  { type: "제재/처벌", keyword: "구속" },
  { type: "비윤리", keyword: "횡령" },
  { type: "비윤리", keyword: "배임" },
  { type: "비윤리", keyword: "갑질" },
  { type: "비윤리", keyword: "불매" },
  { type: "비윤리", keyword: "파업" },
];

// data/crisis-keywords.csv 정적 데이터
export const CRISIS_KEYWORDS_DATA: CrisisKeyword[] = [
  { category: "규제위험", keyword: "제제" },
  { category: "규제위험", keyword: "수사" },
  { category: "규제위험", keyword: "규제" },
  { category: "규제위험", keyword: "처벌" },
  { category: "규제위험", keyword: "행정지도" },
  { category: "법적분쟁", keyword: "고소" },
  { category: "법적분쟁", keyword: "소송" },
  { category: "법적분쟁", keyword: "법적" },
  { category: "법적분쟁", keyword: "계약분쟁" },
  { category: "시장위험", keyword: "시장축소" },
  { category: "시장위험", keyword: "수요감소" },
  { category: "시장위험", keyword: "경쟁심화" },
  // "인사"·"조사"·"이탈"은 뺌 — "인사이트/신년인사", "실태조사/여론조사", "이탈 줄이고"처럼
  // 무관한 문맥에 흔히 끼어 있어 오탐이 너무 많음(2글자라 부분일치 위험도 큼).
  { category: "운영위험", keyword: "경영진교체" },
  { category: "재무위험", keyword: "적자" },
  { category: "재무위험", keyword: "손실" },
  { category: "재무위험", keyword: "유동성부족" },
];

// 검색용 함수
export function hasNegativeKeyword(title: string): boolean {
  for (const { keyword } of NEGATIVE_KEYWORDS_DATA) {
    if (!title.includes(keyword)) continue;

    // "적자" 예외: "인적자원" 등 기관명 일부인지 확인.
    // 주의: \w는 한글을 매치하지 않으므로 한글 문자를 명시적으로 포함해야 한다
    // (\w만 쓰면 "한국인적자원연구센터" 같은 한글 문자열에서 절대 매치되지 않아 예외가 죽은 코드가 됨).
    if (keyword === '적자' && /인적자원/.test(title)) {
      continue;
    }
    // "감소" 예외: "근감소증"처럼 질병명의 일부인 경우는 실적/수치 감소가 아님.
    if (keyword === '감소' && /[가-힣]감소증/.test(title)) {
      continue;
    }
    // "기소" 예외: 뉴시스 등 기사 말미 태그 "[중기소식]"(중소기업소식 줄임말)의 부분일치.
    // 실제 기소·형사절차 기사가 아니라 단순 출처 태그라 위기 신호가 아님.
    if (keyword === '기소' && /중기소식/.test(title)) {
      continue;
    }

    return true;
  }
  return false;
}

export function hasCrisisKeyword(title: string): string | null {
  for (const { category, keyword } of CRISIS_KEYWORDS_DATA) {
    if (!title.includes(keyword)) continue;

    // "규제" 예외: "규제 완화/철폐"는 오히려 호재라 위기 신호로 보지 않음.
    if (keyword === '규제' && /규제\s*(완화|철폐)/.test(title)) {
      continue;
    }
    // "적자" 예외: "인적자원"처럼 기관명 일부인 경우는 재무 적자가 아님.
    if (keyword === '적자' && /인적자원/.test(title)) {
      continue;
    }

    return category;
  }
  return null;
}

// 제목이 아닌 본문 등 긴 텍스트에서 부정/위기 신호가 몇 개나 겹치는지 셈.
// heuristicTone의 "본문이 압도적으로 부정적이면 override" 판단에 사용.
export function countNegativeSignals(text: string): number {
  let count = 0;
  for (const { keyword } of NEGATIVE_KEYWORDS_DATA) {
    if (text.includes(keyword)) count++;
  }
  for (const { keyword } of CRISIS_KEYWORDS_DATA) {
    if (text.includes(keyword)) count++;
  }
  return count;
}
