/**
 * master-keywords.json(의도한 설정) ↔ 실제 DB(MonitoringTarget) 불일치 확인.
 * SBVA·오닝·캐스팅 등 "파일은 고쳤는데 DB엔 반영 안 됨" 사고가 반복돼 재발 방지용으로 추가(2026-08-03).
 */
import { prisma } from '@/lib/prisma';
import masterKeywords from '../../../data/master-keywords.json';

const FIELDS = [
  'englishName', 'category', 'status', 'primaryKeyword', 'helperKeywords',
  'excludeWords', 'contextWords', 'portfolioStatus', 'tier', 'notes',
] as const;

export interface DriftResult {
  missingFromDb: string[]; // JSON에는 있는데 DB에 없음
  orphansInDb: string[];   // DB에는 있는데 JSON에 없음
  fieldMismatches: { name: string; field: string; json: unknown; db: unknown }[];
  total: number;
}

export async function checkConfigDrift(): Promise<DriftResult> {
  const jsonTargets = masterKeywords as any[];
  const jsonByName = new Map(jsonTargets.map(t => [t.name, t]));
  const dbTargets = await prisma.monitoringTarget.findMany();
  const dbByName = new Map(dbTargets.map(t => [t.name, t]));

  const missingFromDb = jsonTargets.filter(t => !dbByName.has(t.name)).map(t => t.name);
  const orphansInDb = dbTargets.filter(t => !jsonByName.has(t.name)).map(t => t.name);

  const fieldMismatches: DriftResult['fieldMismatches'] = [];
  for (const t of dbTargets) {
    const j = jsonByName.get(t.name);
    if (!j) continue;
    for (const f of FIELDS) {
      const jv = j[f] ?? null;
      const dv = (t as any)[f] ?? null;
      if (jv !== dv) fieldMismatches.push({ name: t.name, field: f, json: jv, db: dv });
    }
  }

  return {
    missingFromDb, orphansInDb, fieldMismatches,
    total: missingFromDb.length + orphansInDb.length + fieldMismatches.length,
  };
}

export function formatDriftReport(d: DriftResult): string {
  const lines: string[] = [];
  lines.push(`master-keywords.json ↔ DB 불일치 검사 결과: 총 ${d.total}건\n`);

  if (d.missingFromDb.length) {
    lines.push(`[JSON에는 있는데 DB에 없음] ${d.missingFromDb.length}건`);
    lines.push(d.missingFromDb.join(', '));
    lines.push('');
  }
  if (d.orphansInDb.length) {
    lines.push(`[DB에는 있는데 JSON에 없음] ${d.orphansInDb.length}건`);
    lines.push(d.orphansInDb.join(', '));
    lines.push('');
  }
  if (d.fieldMismatches.length) {
    lines.push(`[필드 값이 다름] ${d.fieldMismatches.length}건`);
    for (const m of d.fieldMismatches.slice(0, 50)) {
      lines.push(`  - ${m.name}.${m.field}: JSON="${m.json}" / DB="${m.db}"`);
      // DB(키워드 관리 화면에서 수정)가 보통 더 최근 값이라 JSON을 DB에 맞추는 걸 기본 제안으로 —
      // 반대가 맞는 경우도 있을 수 있으니 문구는 "제안"으로만 표시.
      lines.push(`    → JSON 쪽 제안: "${m.field}": "${m.db}"`);
    }
    if (d.fieldMismatches.length > 50) lines.push(`  ... 외 ${d.fieldMismatches.length - 50}건 더 (전체는 scripts/check-config-drift.ts 실행)`);
  }
  if (d.total === 0) {
    lines.push('일치함 — 이상 없음.');
  } else {
    lines.push('');
    lines.push('---');
    lines.push('data/master-keywords.json에서 위 제안대로 직접 고쳐서 커밋+푸시하거나,');
    lines.push('Claude에게 "드리프트 동기화해줘"라고 요청하면 대신 처리합니다.');
  }

  return lines.join('\n');
}
