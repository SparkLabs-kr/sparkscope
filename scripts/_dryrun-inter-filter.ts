import './_env';
import { GoogleGenAI } from '@google/genai';
import { FEEDS, parseFeedItems, decodeEntities } from '../src/lib/sparkscope/inter-collect';
import { SYSTEM, buildUserPrompt } from '../src/lib/sparkscope/inter-filter';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const JP = ['ITmedia AI+', 'Impress Watch', 'AnswersNews'];

async function main() {
  const batch: Array<{ id: string; source: string; title: string }> = [];
  for (const name of JP) {
    const xml = await (await fetch(FEEDS[name], { headers: { 'User-Agent': UA } })).text();
    const items = parseFeedItems(xml).map(t => ({ ...t, title: decodeEntities(t.title) })).filter(t => t.title && t.url);
    items.slice(0, 4).forEach((t, i) => batch.push({ id: `${name}-${i}`, source: name, title: t.title }));
  }
  console.log(`드라이런 대상 ${batch.length}건 (DB 저장 안 함)\n`);

  const ai = new GoogleGenAI({ vertexai: true, project: 'communication-504101', location: 'global' });
  const res = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: buildUserPrompt(batch),
    config: { systemInstruction: SYSTEM },
  });
  const text = res.text ?? '';
  const s = text.indexOf('['), e = text.lastIndexOf(']');
  const parsed = JSON.parse(text.slice(s, e + 1));

  for (const v of parsed) {
    const a = batch[v.index];
    if (!a) { console.log(`⚠️  index ${v.index} 매칭 실패`); continue; }
    console.log(`[${a.source}] ${a.title}`);
    if (v.relevant) {
      console.log(`  ✅ 관련  ${v.domain} / ${v.topicSector} / ${v.eventType} / country=${v.country}`);
      console.log(`  🇰🇷 ${v.titleKo}`);
    } else {
      console.log(`  ⬜ noise — ${v.reason}`);
      console.log(`  🇰🇷 titleKo=${v.titleKo ?? 'null'}`);
    }
    console.log();
  }
}
main().catch(e => { console.error('실패:', e.message); process.exit(1); });
