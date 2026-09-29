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

export async function synthesize(text: string): Promise<Speech> {
  let lastErr: unknown;
  // 일시적 5xx·429는 몇 번 다시 시도한다 — 발송 시각이 정해져 있어 한 번 실패로 끝나면 안 된다.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await token()}`,
          'x-goog-user-project': PROJECT,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          input: { text, prompt: VOICE.style },
          voice: { languageCode: 'ko-KR', name: VOICE.name, modelName: VOICE.model },
          audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE },
        }),
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(`TTS ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
      const wav = Buffer.from(j.audioContent, 'base64');
      // LINEAR16 응답은 44바이트 WAV 헤더 + 16비트 모노 PCM
      return { wav, seconds: (wav.length - 44) / (2 * SAMPLE_RATE) };
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}
