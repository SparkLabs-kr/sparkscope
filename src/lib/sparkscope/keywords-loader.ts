/**
 * data 폴더의 negative-keywords, crisis-keywords 로드
 * 단일 소스 기준
 */
import fs from 'fs';
import path from 'path';

export interface NegativeKeyword {
  type: string; // "부도/파산", "손실/손해" 등
  keyword: string;
}

export interface CrisisKeyword {
  category: string; // "규제위험", "법적분쟁" 등
  keyword: string;
}

let cachedNegativeKeywords: NegativeKeyword[] | null = null;
let cachedCrisisKeywords: CrisisKeyword[] | null = null;

/**
 * negative-keywords.csv 로드
 */
export function loadNegativeKeywords(): NegativeKeyword[] {
  if (cachedNegativeKeywords) return cachedNegativeKeywords;

  const csvPath = path.join(process.cwd(), 'data', 'negative-keywords.csv');
  const keywords: NegativeKeyword[] = [];

  if (!fs.existsSync(csvPath)) {
    console.warn(`negative-keywords.csv not found`);
    return keywords;
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 2) continue;

    keywords.push({
      type: values[0] || '',
      keyword: values[1] || '',
    });
  }

  cachedNegativeKeywords = keywords;
  return keywords;
}

/**
 * crisis-keywords.csv 로드
 */
export function loadCrisisKeywords(): CrisisKeyword[] {
  if (cachedCrisisKeywords) return cachedCrisisKeywords;

  const csvPath = path.join(process.cwd(), 'data', 'crisis-keywords.csv');
  const keywords: CrisisKeyword[] = [];

  if (!fs.existsSync(csvPath)) {
    console.warn(`crisis-keywords.csv not found`);
    return keywords;
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 2) continue;

    keywords.push({
      category: values[0] || '',
      keyword: values[1] || '',
    });
  }

  cachedCrisisKeywords = keywords;
  return keywords;
}

/**
 * 기사 제목이 부정 키워드를 포함하는지 확인
 * (예외: "적자"가 "한국인적자원연구센터" 같은 기관명 일부일 때)
 */
export function hasNegativeKeyword(title: string): boolean {
  const negKeywords = loadNegativeKeywords();

  for (const { keyword } of negKeywords) {
    if (!title.includes(keyword)) continue;

    // "적자" 예외: 기관명 일부인지 확인
    if (keyword === '적자') {
      // 예: "한국인적자원연구센터" → 제외
      if (title.match(/\w+인적자\w+/)) {
        continue;
      }
    }

    return true;
  }

  return false;
}

/**
 * 기사가 위기 감지 키워드를 포함하는지 확인
 */
export function hasCrisisKeyword(title: string): string | null {
  const crisisKeywords = loadCrisisKeywords();

  for (const { category, keyword } of crisisKeywords) {
    if (title.includes(keyword)) {
      return category;
    }
  }

  return null;
}

/**
 * 간단한 CSV 라인 파서
 */
function parseCSVLine(line: string): string[] {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}
