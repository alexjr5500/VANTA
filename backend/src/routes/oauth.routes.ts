import { Router } from 'express';
import { rateLimiter } from '../security';
import {
  authorize,
  callback,
  exchange,
  register,
  status,
} from '../controllers/oauth.controller';

const router = Router();

// Public OAuth provider endpoints. In addition to these route-level limits,
// the global `/api` rate limiter in index.ts already bounds every request.
// The browser-facing redirect endpoints stay lenient (a single OAuth round
// trip performs several of them); state/code tickets enforce their own
// short-lived expiry and single-use semantics.

// Provider readiness (used by the login/register UI to enable buttons).
router.get('/status/:provider', status);

// Start the provider Authorization Code flow (302 to Google/Telegram).
router.get('/authorize/:provider', rateLimiter.login, authorize);

// Provider redirects here with ?code=&state= (and ?error= on cancellation).
router.get('/callback/:provider', callback);

// Redeem the one-time exchange code handed back after a successful callback.
router.post('/exchange', rateLimiter.login, exchange);

// Finish creating a VANTA account for a verified provider identity.
router.post('/register', rateLimiter.register, register);

export default router;