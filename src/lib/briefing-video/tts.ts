/**
 * 브리핑 음성 — Google Cloud TTS의 Gemini 음성(2026-09-28 소윤 확정: gemini-2.5-flash-tts · Charon).
 *
 * 문단(인사·기사·마무리)마다 따로 합성한다. 슬라이드를 음성 길이에 맞춰 넘기려면 문단별 길이가
 * 필요한데, 한 번에 합성하면 경계를 알 수 없다. LINEAR16(WAV)로 받아 길이를 바이트 수로 계산한다.
 *
 * 인증은 서비스 계정(GOOGLE_APPLICATION_CREDENTIALS) — Inter 분류가 쓰는 것과 같은 계정이다.
 */
import { GoogleAuth } from 'google-auth-library';

const PROJECT = 'communication-504101';
export const VOICE = {
  model: 'gemini-2.5-flash-tts',
  name: 'Charon',
  style: '아침 뉴스 앵커처럼 또렷하고 밝게, 약간 빠른 속도로 읽어 주세요.',
} as const;
const SAMPLE_RATE = 24000;

let auth: GoogleAuth | null = null;
async function token(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const t = await auth.getAccessToken();
  if (!t) throw new Error('Google 인증 토큰을 받지 못했습니다(GOOGLE_APPLICATION_CREDENTIALS 확인)');
  return t;
}

export interface Speech {
  wav: Buffer;
  seconds: number;
}

/**
 * 한도 초과(429) 대비 — Gemini TTS는 preview라 분당 호출 한도가 낮다(2026-09-30 Actions 첫 실행에서
 * 문단 7개를 동시에 보냈다가 429). 그래서 문단은 하나씩(synthesizeAll) 보내고, 429면 오래 기다린다.
 * 그래도 안 되면 같은 이름의 정식 음성(Chirp 3 HD · Charon)으로 영상 전체를 만든다 — 문단마다
 * 목소리가 섞이지 않게 전부 바꾼다. 발송이 음성 때문에 막히면 안 된다.
 */
export const FALLBACK_VOICE = 'ko-KR-Chirp3-HD-Charon';

async function callTts(text: string, gemini: boolean): Promise<Speech> {
  const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'x-goog-user-project': PROJECT,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      input: gemini ? { text, prompt: VOICE.style } : { text },
      voice: gemini
        ? { languageCode: 'ko-KR', name: VOICE.name, modelName: VOICE.model }
        : { languageCode: 'ko-KR', name: FALLBACK_VOICE },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE },
    }),
  });
  const j: any = await r.json();
  if (!r.ok) throw Object.assign(new Error(`TTS ${r.status}: ${JSON.stringify(j).slice(0, 300)}`), { status: r.status });
  const wav = Buffer.from(j.audioContent, 'base64');
  // LINEAR16 응답은 44바이트 WAV 헤더 + 16비트 모노 PCM
  return { wav, seconds: (wav.length - 44) / (2 * SAMPLE_RATE) };
}

async function withRetry(text: string, gemini: boolean): Promise<Speech> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await callTts(text, gemini);
    } catch (e: any) {
      lastErr = e;
      // 429는 분 단위 한도라 길게(20·40·60초…), 그 밖의 일시 오류는 짧게 기다린다.
      const wait = e?.status === 429 ? 20_000 * (attempt + 1) : 2_000 * (attempt + 1);
      console.warn(`[tts] ${gemini ? 'Gemini' : 'Chirp'} ${e?.status ?? ''} — ${wait / 1000}초 뒤 재시도(${attempt + 1}/5)`);
      await new Promise(res => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

/** 문단 전체를 하나씩 합성한다. Gemini가 끝내 실패하면 전부 대체 음성으로 다시 만든다. */
export async function synthesizeAll(texts: string[]): Promise<{ speeches: Speech[]; voice: string }> {
  try {
    const speeches: Speech[] = [];
    for (const t of texts) speeches.push(await withRetry(t, true));
    return { speeches, voice: `${VOICE.model}/${VOICE.name}` };
  } catch (e) {
    console.error(`[tts] Gemini 음성 실패 — 전체를 ${FALLBACK_VOICE}로 다시 만듭니다:`, e);
    const speeches: Speech[] = [];
    for (const t of texts) speeches.push(await withRetry(t, false));
    return { speeches, voice: FALLBACK_VOICE };
  }
}

/** 한 문단만 합성(테스트용). */
export async function synthesize(text: string): Promise<Speech> {
  return withRetry(text, true);
}
