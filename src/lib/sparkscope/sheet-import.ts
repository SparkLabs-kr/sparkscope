/**
 * 구글 시트(SparkLabs_Media Coverage Tracker) 연동 — 팀이 수기로 관리하는 언론 보도
 * 트래커를 Article 테이블에 병합한다.
 *
 * CSV export(export?format=csv)는 셀의 하이퍼링크(실제 기사 URL)를 버리고 표시 텍스트만
 * 남기기 때문에 쓸 수 없다 — Article.link가 필수·고유 컬럼이라 URL이 꼭 있어야 함.
 * 그래서 Sheets API v4를 includeGridData=true로 호출해 각 셀의 hyperlink 필드까지 읽는다.
 */
import { prisma } from '@/lib/prisma';
import { heuristicTone } from './analyzer';
import { hasCrisisKeyword } from './keywords-data';

const SPREADSHEET_ID = '1G4irYCMIlAiddBZ9x9iLd3W1txhetyeMhfDe7aiW_rI';

// 가져올 탭과, 탭 성격에 따른 처리 방식.
// - tracker: 스파크랩 관련 언론 노출 전반을 기록한 탭 — 톤은 heuristicTone으로 새로 판단.
// - curatedNegative: 팀이 이미 부정 기사로 골라서 관리 중인 탭 — 톤을 NEGATIVE로 그대로 반영.
const SHEET_TABS: Array<{ title: string; kind: 'tracker' | 'curatedNegative' }> = [
  { title: '2023 스파크랩 트래커', kind: 'tracker' },
  { title: '2024 스파크랩 트래커', kind: 'tracker' },
  { title: '2025 스파크랩 트래커', kind: 'tracker' },
  { title: '2026 스파크랩 트래커', kind: 'tracker' },
  { title: '발란 기업회생 관련 부정기사 모니터링', kind: 'curatedNegative' },
];

interface SheetCell {
  formattedValue?: string;
  hyperlink?: string;
}
interface SheetRowData {
  values?: SheetCell[];
}
interface SheetApiResponse {
  sheets?: Array<{
    properties?: { title?: string };
    data?: Array<{ rowData?: SheetRowData[] }>;
  }>;
}

// 헤더 행에서 컬럼을 이름으로 찾는다 — 탭마다 헤더 표기가 살짝 달라도 대응하기 위해
// 인덱스 하드코딩 대신 별칭 매칭을 씀.
const COLUMN_ALIASES: Record<'date' | 'source' | 'title', string[]> = {
  date: ['date', '날짜', '게재일'],
  source: ['media', '매체'],
  title: ['headline', '제목', 'title'],
};

function findColumnIndex(header: SheetCell[], aliases: string[]): number {
  return header.findIndex(c => {
    const v = (c.formattedValue ?? '').trim().toLowerCase();
    return aliases.some(a => v === a.toLowerCase());
  });
}

// 시트의 날짜 표기를 파싱. 탭마다 구분자·공백이 다름 — 2023 트래커는 "2023.12.26" 또는
// "2023. 4.7"(점 뒤 공백, 한 자리 월/일)처럼 섞여 있고, 나머지(2024~2026·발란)는
// "2024/12/26" 형식이라 셋 다 대응.
function parseSheetDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

export interface SheetImportResult {
  tabsProcessed: number;
  rowsSeen: number;
  inserted: number;
  skippedNoLink: number;
  skippedDuplicate: number;
  skippedNoDate: number;
  skippedTabs: string[];
}

export async function importMediaSheet(apiKey: string, opts: { dryRun?: boolean } = {}): Promise<SheetImportResult> {
  const result: SheetImportResult = {
    tabsProcessed: 0, rowsSeen: 0, inserted: 0,
    skippedNoLink: 0, skippedDuplicate: 0, skippedNoDate: 0,
    skippedTabs: [],
  };

  for (const tab of SHEET_TABS) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}` +
      `?ranges=${encodeURIComponent(tab.title)}` +
      `&includeGridData=true` +
      `&fields=${encodeURIComponent('sheets(properties.title,data.rowData.values(formattedValue,hyperlink))')}` +
      `&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[sheet-import] "${tab.title}" 조회 실패: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      result.skippedTabs.push(tab.title);
      continue;
    }
    const data: SheetApiResponse = await res.json();
    const rows = data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    if (rows.length < 2) {
      result.skippedTabs.push(tab.title);
      continue;
    }

    const header = rows[0].values ?? [];
    const dateIdx = findColumnIndex(header, COLUMN_ALIASES.date);
    const sourceIdx = findColumnIndex(header, COLUMN_ALIASES.source);
    const titleIdx = findColumnIndex(header, COLUMN_ALIASES.title);
    if (dateIdx === -1 || sourceIdx === -1 || titleIdx === -1) {
      console.error(`[sheet-import] "${tab.title}": date/media/title 컬럼을 못 찾음 (헤더 확인 필요) — 건너뜀`);
      result.skippedTabs.push(tab.title);
      continue;
    }
    result.tabsProcessed++;

    for (const row of rows.slice(1)) {
      const cells = row.values ?? [];
      const titleCell = cells[titleIdx];
      const title = titleCell?.formattedValue?.trim();
      if (!title) continue;
      result.rowsSeen++;

      const link = titleCell?.hyperlink;
      if (!link) { result.skippedNoLink++; continue; }

      const pubDate = parseSheetDate(cells[dateIdx]?.formattedValue ?? '');
      if (!pubDate) { result.skippedNoDate++; continue; }

      const source = cells[sourceIdx]?.formattedValue?.trim() || '알수없음';

      const existing = await prisma.article.findUnique({ where: { link }, select: { id: true } });
      if (existing) { result.skippedDuplicate++; continue; }

      let tone: string;
      let riskFlag: string | null;
      let category: string;
      let matchedKeyword: string;

      if (tab.kind === 'curatedNegative') {
        tone = 'NEGATIVE';
        riskFlag = 'crisis'; // 기업회생 = 재무 위기
        category = 'portfolio_company';
        matchedKeyword = '발란';
      } else {
        tone = heuristicTone(title);
        riskFlag = tone === 'NEGATIVE' && hasCrisisKeyword(title) ? 'crisis' : null;
        category = 'sparklabs_self';
        matchedKeyword = '스파크랩';
      }

      if (opts.dryRun) {
        result.inserted++; // dry-run에서도 "삽입됐을 건수"로 카운트만
        continue;
      }

      await prisma.article.create({
        data: {
          title, link, source, pubDate,
          matchedKeyword, category,
          tone, riskFlag,
          isNoise: false,
          priorityScore: 0,
          analyzedAt: new Date(),
        },
      });
      result.inserted++;
    }
  }

  return result;
}
