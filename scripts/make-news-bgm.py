"""
오프닝 뉴스 배경음악(assets/briefing/news-bgm.wav) 생성기 — 2026-10-07.
외부 음원을 받지 않고 ffmpeg 사인파로 직접 만든다(저작권 걱정 없음). 120bpm, C–Am–F–G–C 벨 아르페지오 + 베이스 + 패드, 10초.

  python3 scripts/make-news-bgm.py | xargs -0 -I{} npx ffmpeg ...   (아래 사용법 참고)
  FF=$(node -e "console.log(require('ffmpeg-static'))")
  $FF -y -filter_complex "$(python3 scripts/make-news-bgm.py)" -map "[out]" -t 10 assets/briefing/news-bgm.wav
"""
bpm = 120; beat = 60 / bpm
C = [523.25, 659.25, 783.99, 1046.5]; F = [698.46, 880, 1046.5, 1396.92]
G = [783.99, 987.77, 1174.66, 1567.98]; Am = [880, 1046.5, 1318.51, 1760]
parts = []
for bar, ch in enumerate([C, Am, F, G, C]):
    for i, f in enumerate(ch):
        st = bar * 4 * beat + i * beat * 0.5
        if st < 9.5: parts.append((st, f / 2 if bar % 2 else f, 0.18, 5))
    for b in range(4):
        st = bar * 4 * beat + b * beat
        if st < 9.5: parts.append((st, ch[0] / 4, 0.32, 9))
srcs, labels = [], []
for k, (st, f, a, dec) in enumerate(parts):
    expr = f"{a}*sin(2*PI*{f:.2f}*t)*exp(-{dec}*t)+{a*0.3}*sin(4*PI*{f:.2f}*t)*exp(-{dec*1.6}*t)"
    srcs.append(f"aevalsrc='{expr}':s=44100:d=1.6,adelay={int(st*1000)}|{int(st*1000)}[n{k}]")
    labels.append(f"[n{k}]")
pad = "aevalsrc='0.05*(sin(2*PI*261.63*t)+sin(2*PI*329.63*t)+sin(2*PI*392*t))*min(1,t/1.5)':s=44100:d=10[pad]"
print(";".join(srcs + [pad]) + ";" + "".join(labels) + f"[pad]amix=inputs={len(labels)+1}:normalize=0,afade=t=out:st=8:d=2,volume=0.9,aformat=sample_rates=44100:channel_layouts=mono[out]")
