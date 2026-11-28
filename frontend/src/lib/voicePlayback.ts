export function parseVoicePlaybackRate(raw: string | null): number {
  try {
    const speed = JSON.parse(raw || '{}')?.speed;
    return speed === '1.5' ? 1.5 : speed === '2' ? 2 : 1;
  } catch { return 1; }
}

export function getVoicePlaybackRate(): number {
  try { return parseVoicePlaybackRate(window.localStorage.getItem('vanta_voice_playback')); }
  catch { return 1; }
}
