// 챗봇이 할 수 있는 "행동" — 단, 실제로 바꾸지는 않는다.
//
// 챗봇은 오탐 많은 키워드를 찾아주면서도 고치지는 못했다. CLAUDE.md에 적힌 사고
// (키워드 설정이 DB에 반영 안 된 채 6회 발송이 잘못 나간 건)가 정확히 이 영역이다.
//
// 그렇다고 챗봇이 감시 설정을 직접 고치게 두면 안 된다. 문맥어 하나 잘못 넣으면 그 회사
// 기사가 통째로 걸러진다(2026-08 946건 소급판정 사고). 그래서 여기서는 NoiseSuggestion에
// PENDING으로 쌓기만 하고, 반영은 기존 승인 화면(/dashboard/noise-suggestions)에서
// 관리자가 승인해야 일어난다. 승인 로직은 이미 있으니 그대로 태운다.
import { prisma } from '@/lib/prisma';

/** 한 번에 제안할 수 있는 문구 길이 상한 — 통째로 붙여넣는 사고 방지 */
const MAX_ADDITION = 120;

export type ProposeInput = {
  targetName: string;
  field: 'contextWords' | 'excludeWords';
  addition: string;
  reason: string;
  /** 누가 요청해서 만든 제안인지 (감사용) */
  requestedBy: string;
};

export type ProposeResult =
  | { ok: true; id: string; targetName: string; field: string; addition: string; currentValue: string | null; effect: string }
  | { ok: false; error: string };

export async function proposeKeywordFix(input: ProposeInput): Promise<ProposeResult> {
  const addition = input.addition.trim();
  if (!addition) return { ok: false, error: '추가할 문구가 비어 있습니다.' };
  if (addition.length > MAX_ADDITION) {
    return { ok: false, error: `추가 문구가 너무 깁니다(${addition.length}자). ${MAX_ADDITION}자 이내로 핵심 단어만 제안하세요.` };
  }
  if (!['contextWords', 'excludeWords'].includes(input.field)) {
    return { ok: false, error: 'field는 contextWords 또는 excludeWords만 됩니다.' };
  }

  // 감시대상은 이름으로 찾는다(승인 로직이 name으로 조회하므로 같은 기준이어야 한다).
  // 사용자는 보통 키워드로 말하므로 primaryKeyword로도 한 번 더 찾아본다.
  //
  // 상태를 안 가리고 먼저 찾는 이유: 예전엔 status='ACTIVE'를 조건에 넣고 조회해서,
  // 멈춰 있는 대상(예: 캐스팅=PAUSED)에 제안하면 "못 찾았습니다"가 떴다. 그러면 에이전트가
  // 이름이 틀린 줄 알고 사용자에게 정식명칭을 되묻는 엉뚱한 길로 샜다. 왜 안 되는지 정확히 알려야 한다.
  const target =
    (await prisma.monitoringTarget.findFirst({ where: { name: input.targetName } })) ??
    (await prisma.monitoringTarget.findFirst({ where: { primaryKeyword: input.targetName } }));
  if (!target) {
    return { ok: false, error: `'${input.targetName}'을(를) 감시대상 명단에서 못 찾았습니다. 정확한 이름으로 다시 시도하세요.` };
  }
  if (target.status !== 'ACTIVE') {
    return {
      ok: false,
      error:
        `${target.name}은(는) 지금 수집이 멈춰 있는 대상입니다(상태: ${target.status}). ` +
        `수집을 안 하므로 문맥어·제외어를 바꿔도 효과가 없습니다. 오탐 건수는 과거에 쌓인 것입니다. ` +
        `다시 수집하려면 먼저 감시대상을 ACTIVE로 되살려야 하니, 그건 사용자에게 안내하세요.`,
    };
  }

  const currentValue = input.field === 'excludeWords' ? target.excludeWords : target.contextWords;
  const oppositeField = input.field === 'excludeWords' ? 'contextWords' : 'excludeWords';
  const oppositeValue = input.field === 'excludeWords' ? target.contextWords : target.excludeWords;

  const split = (v: string | null) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const existing = split(currentValue);
  const opposite = split(oppositeValue);
  const words = addition.split(',').map((s) => s.trim()).filter(Boolean);

  // 반대쪽 필드에 이미 있는 단어를 넣으면 그 감시대상이 아무것도 못 잡게 된다.
  // (contextWords = 이게 있어야 통과 / excludeWords = 이게 있으면 제외 — 정반대다)
  // 예: 노리의 contextWords에 "KnowRe"가 있는데 excludeWords에도 넣으면 전부 걸러진다.
  const conflict = words.filter((w) => opposite.includes(w));
  if (conflict.length) {
    return {
      ok: false,
      error:
        `'${conflict.join(', ')}'은(는) 이미 ${target.name}의 ${oppositeField}에 들어 있습니다. ` +
        `${oppositeField}와 ${input.field}는 정반대 역할이라 같은 단어를 양쪽에 넣으면 이 감시대상이 기사를 하나도 못 잡게 됩니다.`,
    };
  }

  // 이미 들어 있는 단어를 또 제안하지 않는다.
  const fresh = words.filter((w) => !existing.includes(w));
  if (!fresh.length) {
    return { ok: false, error: `제안한 단어가 이미 ${target.name}의 ${input.field}에 전부 들어 있습니다: ${currentValue}` };
  }

  // 같은 제안이 이미 대기 중이면 중복으로 쌓지 않는다.
  const dup = await prisma.noiseSuggestion.findFirst({
    where: { targetName: target.name, field: input.field, status: 'PENDING' },
  });
  if (dup) {
    return {
      ok: false,
      error: `${target.name}의 ${input.field}에 대한 제안이 이미 승인 대기 중입니다("${dup.addition}"). 그걸 먼저 처리해야 합니다.`,
    };
  }

  // NoiseSuggestion.articleId는 필수다(원래 "이 기사 때문에"라는 신고에서 출발한 구조).
  // 챗봇 제안은 특정 기사가 아니라 누적 통계에서 나오므로, 그 키워드의 최근 오탐 기사
  // 하나를 근거로 붙인다. 승인 화면에서 "왜 이 제안이 나왔나"를 볼 수 있어야 하기 때문.
  const evidence =
    (await prisma.article.findFirst({
      where: { matchedKeyword: target.primaryKeyword, isNoise: true },
      orderBy: { pubDate: 'desc' },
      select: { id: true, title: true },
    })) ??
    (await prisma.article.findFirst({
      where: { matchedKeyword: target.primaryKeyword },
      orderBy: { pubDate: 'desc' },
      select: { id: true, title: true },
    }));
  if (!evidence) {
    return { ok: false, error: `${target.name}으로 수집된 기사가 없어 제안 근거를 붙일 수 없습니다.` };
  }

  // 승인하는 사람이 "이걸 넣으면 어느 쪽으로 움직이는지"를 바로 알 수 있게 적어둔다.
  // 챗봇이 방향을 반대로 잡은 적이 있다(에듀테크 회사 '노리'의 오탐을 줄이겠다며
  // 게임·퍼즐을 contextWords에 넣자고 했는데, 그건 오히려 그 오탐들을 통과시키는 설정이다).
  const effect =
    input.field === 'excludeWords'
      ? '적용하면 필터가 엄격해집니다(해당 단어가 든 기사를 버림 → 오탐 감소)'
      : currentValue
        ? '⚠ 적용하면 필터가 느슨해집니다(문맥어는 OR 조건이라 통과 경로가 늘어남 → 오탐 증가 가능)'
        : '⚠ 지금은 문맥어가 없어 전부 통과합니다. 적용하면 이 단어들이 제목에 없는 기사가 모두 걸러집니다';

  const created = await prisma.noiseSuggestion.create({
    data: {
      articleId: evidence.id,
      targetName: target.name,
      field: input.field,
      currentValue,
      addition: fresh.join(', '),
      // 누가 요청했는지 남긴다 — 스키마에 작성자 칸이 없어서 사유에 함께 적는다.
      reason: `${input.reason} (챗봇 제안 · 요청: ${input.requestedBy}) — ${effect}`,
    },
    select: { id: true },
  });

  return {
    ok: true,
    id: created.id,
    targetName: target.name,
    field: input.field,
    addition: fresh.join(', '),
    currentValue,
    effect,
  };
}

/** 승인 대기 중인 제안 목록 — 읽기 전용. */
export async function listPendingSuggestions(limit = 20) {
  const rows = await prisma.noiseSuggestion.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 50),
    select: { targetName: true, field: true, addition: true, reason: true, currentValue: true, createdAt: true },
  });
  return rows.map((r) => ({
    target: r.targetName,
    field: r.field,
    addition: r.addition,
    current: r.currentValue,
    reason: r.reason,
    createdAt: r.createdAt.toISOString().slice(0, 10),
  }));
}
