'use client';

// 브리핑 영상 시청 이벤트 전송. 페이지 안의 첫 <video>에 붙는다.
// 이벤트는 페이지 한 번 열 때 이벤트마다 한 번씩만 보낸다(open · play · half · complete).
import { useEffect } from 'react';

const VISITOR_KEY = 'sparkscope-briefing-visitor';

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export default function BriefingTracker({ dateKey, token }: { dateKey: string; token?: string }) {
  useEffect(() => {
    const vid = visitorId();
    const sent = new Set<string>();

    const send = (event: string) => {
      if (sent.has(event)) return;
      sent.add(event);
      const body = JSON.stringify({ dateKey, event, token: token ?? '', visitorId: vid });
      fetch('/api/briefing/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    };

    send('open');

    const video = document.querySelector('video');
    if (!video) return;
    const onPlay = () => send('play');
    const onTime = () => {
      if (video.duration > 0 && video.currentTime >= video.duration * 0.5) send('half');
    };
    const onEnded = () => send('complete');

    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('ended', onEnded);
    };
  }, [dateKey, token]);

  return null;
}
