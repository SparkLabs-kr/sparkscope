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
  { type: "위반/적발", keyword: "적발됨" },
  { type: "위반/적발", keyword: "뜻밖의" },
  { type: "감소/하락", keyword: "감소" },
  { type: "감소/하락", keyword: "하락" },
  { type: "감소/하락", keyword: "급락" },
  { type: "감소/하락", keyword: "급감" },
  { type: "부정적 평가", keyword: "비판" },
  { type: "부정적 평가", keyword: "평가절하" },
  { type: "부정적 평가", keyword: "낮은평가" },
];

// data/crisis-keywords.csv 정적 데이터
export const CRISIS_KEYWORDS_DATA: CrisisKeyword[] = [
  { category: "규제위험", keyword: "제제" },
  { category: "규제위험", keyword: "조사" },
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
  { category: "운영위험", keyword: "인사" },
  { category: "운영위험", keyword: "이탈" },
  { category: "운영위험", keyword: "경영진교체" },
  { category: "재무위험", keyword: "적자" },
  { category: "재무위험", keyword: "손실" },
  { category: "재무위험", keyword: "유동성부족" },
];

// 검색용 함수
export function hasNegativeKeyword(title: string): boolean {
  for (const { keyword } of NEGATIVE_KEYWORDS_DATA) {
    if (!title.includes(keyword)) continue;

    // "적자" 예외: 기관명 일부인지 확인
    if (keyword === '적자') {
      if (title.match(/\w+인적자\w+/)) {
        continue;
      }
    }

    return true;
  }
  return false;
}

export function hasCrisisKeyword(title: string): string | null {
  for (const { category, keyword } of CRISIS_KEYWORDS_DATA) {
    if (title.includes(keyword)) {
      return category;
    }
  }
  return null;
}
