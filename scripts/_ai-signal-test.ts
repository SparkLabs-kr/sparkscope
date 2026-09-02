import { collectAiSignals, storeSignals, signalSourceStatus } from '../src/lib/sparkscope/ai-signal-collect';

async function main() {
  console.log('=== source status ===');
  for (const s of signalSourceStatus()) {
    console.log(`  ${s.connected ? '✅' : '⬜'} ${s.label.padEnd(22)} ${s.note}`);
  }
  const since = Date.now() - 3 * 86400_000;
  console.log('\n=== collecting (last 3 days) ===');
  const t0 = Date.now();
  const signals = await collectAiSignals('ai', since);
  console.log(`  ${signals.length} signals in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const bySource = new Map<string, number>();
  for (const s of signals) bySource.set(s.source, (bySource.get(s.source) ?? 0) + 1);
  for (const [src, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`    ${src.padEnd(12)} ${n}`);

  console.log('\n=== top 8 by raw engagement ===');
  for (const s of [...signals].sort((a, b) => b.points - a.points).slice(0, 8)) {
    console.log(`  ${String(s.points).padStart(7)}pts ${String(s.comments).padStart(5)}c  [${s.source}] ${s.title.slice(0, 62)}`);
  }

  console.log('\n=== storing ===');
  const r = await storeSignals(signals);
  console.log(`  created ${r.created}, updated ${r.updated}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
