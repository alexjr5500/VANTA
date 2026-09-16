import { Router } from 'express';

const router = Router();

/**
 * Public WebRTC ICE server configuration for private 1-to-1 voice/video calls.
 *
 * The browser must know which STUN/TURN servers to use to punch through NAT
 * between two devices. VANTA ships with public Google STUN as the safe default
 * in the client, but deployments that need reliable relaying (symmetric NAT,
 * corporate networks, strict mobile carriers) can inject TURN servers through
 * the `RTC_ICE_SERVERS` environment variable — a JSON array of RTCIceServer
 * objects, e.g.:
 *
 *   RTC_ICE_SERVERS=[{"urls":["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349?transport=tcp"],"username":"user","credential":"secret"}]
 *
 * The endpoint is intentionally public/read-only: ICE server URLs and STUN
 * addresses are not sensitive, and clients that cannot reach it simply fall
 * back to the built-in STUN list. TURN credentials may be short-lived tokens
 * issued by a TURN provider; this route passes them through unchanged so
 * deployments keep full control over rotation without touching client code.
 */
router.get('/ice-config', (_req, res) => {
  const raw = process.env.RTC_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const servers = Array.isArray(parsed) ? parsed : parsed?.iceServers;
      if (Array.isArray(servers) && servers.length > 0) {
        res.json({ iceServers: servers });
        return;
      }
    } catch (error) {
      console.error('[rtc] Invalid RTC_ICE_SERVERS configuration:', error);
    }
  }
  res.json({ iceServers: [] });
});

export default router;