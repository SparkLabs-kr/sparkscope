/**
 * data/monitoring-targets.csv를 로드해서 카테고리별로 제공
 * 단일 소스 기준으로 분류 규칙 통일
 */
import fs from 'fs';
import path from 'path';

export interface MonitoringTarget {
  category: string;
  name: string;
  englishName: string;
  primaryKeyword: string;
  helperKeywords: string[];
  excludeWords: string[];
  status: string; // ACTIVE / PAUSED / EXIT
  tier?: string;
  businessContext?: string;
}

let cachedTargets: MonitoringTarget[] | null = null;

/**
 * CSV에서 모니터링 대상 로드 (캐시됨)
 */
export function loadMonitoringTargets(): MonitoringTarget[] {
  if (cachedTargets) return cachedTargets;

  const csvPath = path.join(process.cwd(), 'data', 'monitoring-targets.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn(`monitoring-targets.csv not found at ${csvPath}`);
    return [];
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const targets: MonitoringTarget[] = [];

  // 헤더 파싱
  const headers = parseCSVLine(lines[0]);
  const colMap = {
    카테고리: headers.indexOf('카테고리'),
    기업명: headers.findIndex(h => h.includes('기업명') && h.includes('한글')),
    영문명: headers.findIndex(h => h.includes('기업명') && h.includes('영문')),
    primaryKeyword: headers.indexOf('primaryKeyword'),
    helperKeywords: headers.indexOf('helperKeywords'),
    excludeWords: headers.indexOf('excludeWords'),
    status: headers.indexOf('status'),
  };

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (!values[colMap.카테고리]) continue;

    targets.push({
      category: values[colMap.카테고리] || '',
      name: values[colMap.기업명] || '',
      englishName: values[colMap.영문명] || '',
      primaryKeyword: values[colMap.primaryKeyword] || '',
      helperKeywords: (values[colMap.helperKeywords] || '')
        .split(',')
        .map(k => k.trim())
        .filter(k => k),
      excludeWords: (values[colMap.excludeWords] || '')
        .split(',')
        .map(k => k.trim())
        .filter(k => k),
      status: values[colMap.status] || 'ACTIVE',
    });
  }

  cachedTargets = targets;
  return targets;
}

/**
 * 카테고리별 필터링
 */
export function getTargetsByCategory(category: string): MonitoringTarget[] {
  return loadMonitoringTargets().filter(t => t.category === category && t.status === 'ACTIVE');
}

/**
 * 경쟁사만 가져오기
 */
export function getCompetitorTargets(): MonitoringTarget[] {
  return getTargetsByCategory('competitor');
}

/**
 * 포트폴리오 회사만 가져오기
 */
export function getPortfolioTargets(): MonitoringTarget[] {
  return getTargetsByCategory('portfolio_company');
}

/**
 * 스파크랩 자사만 가져오기
 */
export function getSparkLabsTargets(): MonitoringTarget[] {
  return getTargetsByCategory('sparklabs_self');
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
