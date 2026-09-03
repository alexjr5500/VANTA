# VANTA Authentication System - Testing Guide

## Local Development Testing

### Setup

1. **Start Backend**:
```bash
cd backend
npm install
npm run dev
# Server runs on http://localhost:5000
```

2. **Start Frontend**:
```bash
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:3000
```

3. **View Backend Health**:
```bash
curl http://localhost:5000/health
# Response: {"status":"ok","message":"VANTA API is running"}
```

## Test Scenarios

### 1. Email/Password Registration

**Steps**:
1. Go to `http://localhost:3000/register`
2. Fill in form:
   - Username: `testuser123`
   - Email: `test@example.com`
   - Password: `TestPassword123`
3. Click "Create Account"

**Expected**:
- ✅ No error messages
- ✅ Redirected to `/discover`
- ✅ Token saved to localStorage
- ✅ User can see their profile

**Verify Backend**:
```bash
curl http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPassword123"}'

# Response:
# {
#   "message": "Logged in successfully",
#   "token": "eyJhbGciOi...",
#   "refreshToken": "eyJhbGciOi...",
#   "expiresIn": 604800,
#   "user": {
#     "id": "...",
#     "email": "test@example.com",
#     "username": "testuser123"
#   }
# }
```

### 2. Email/Password Login

**Steps**:
1. Clear localStorage (DevTools → Application → Storage → Clear Site Data)
2. Go to `http://localhost:3000/login`
3. Enter credentials:
   - Email: `test@example.com`
   - Password: `TestPassword123`
4. Click "Log In"

**Expected**:
- ✅ Login succeeds
- ✅ Token saved
- ✅ Redirected to `/discover`

### 3. Session Persistence

**Steps**:
1. Log in successfully
2. Refresh the page (F5)
3. Check if still logged in

**Expected**:
- ✅ Token restored from storage
- ✅ User data loaded
- ✅ No re-login required

### 4. Token Refresh

**Steps**:
1. Log in
2. Wait or monitor Network tab
3. After 5 minutes, make an API call

**Verify in DevTools Console**:
```javascript
// Get stored tokens
localStorage.getItem('vanta_token')
localStorage.getItem('vanta_refresh_token')
```

**Expected**:
- ✅ Access token refreshed automatically
- ✅ No interruption in functionality

### 5. Logout

**Steps**:
1. Log in successfully
2. Click "Log Out" button
3. Verify redirected to `/login`

**Expected**:
- ✅ Token cleared from storage
- ✅ Redirected to `/login`
- ✅ Cannot access protected pages without logging in again

### 6. Error Handling

**Test Invalid Login**:
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"WrongPassword"}'

# Expected Response: {"error":"Invalid password"}
```

**Test Missing Fields**:
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Expected Response: {"error":"Email, username, and password are required"}
```

**Test Duplicate Registration**:
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"test@example.com",
    "username":"testuser123",
    "password":"TestPassword123"
  }'

# Expected Response: {"error":"Email or username already exists"}
```

### 7. Protected Routes

**Steps**:
1. Try accessing `/discover` without logging in
2. Should redirect to `/login`

**Test**:
```bash
# This should return 401 without token
curl http://localhost:5000/api/auth/me
# Response: {"error":"Unauthorized"}

# This should work with token
curl http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer [your-token]"
# Response: {"message":"User profile retrieved","user":{...}}
```

### 8. Phone OTP (Development)

**Steps**:
1. Go to `/register` → "Phone OTP sign up"
2. Enter phone: `+1234567890`
3. Click "Send OTP"

**Verify**:
- Check backend console for OTP log:
  ```
  [DEV] OTP for +1234567890: 123456
  ```
- Enter this OTP in frontend
- Should complete registration

### 9. Google OAuth (Requires Setup)

**Prerequisites**:
- Google OAuth Client ID configured
- GOOGLE_CLIENT_ID set in frontend .env

**Steps**:
1. Go to `/register`
2. Click "Sign up with Google"
3. Log in with Google account
4. Should create/login user

**Expected**:
- ✅ User created with Google account
- ✅ Email auto-filled
- ✅ Redirected to `/discover`

### 10. Apple Sign In (Requires Setup)

**Prerequisites**:
- Apple Developer account configured
- APPLE_CLIENT_ID configured

**Steps**:
1. Go to `/register`
2. Click "Sign up with Apple"
3. Authenticate with Apple ID
4. Should create/login user

## Frontend Console Testing

### Monitor API Calls

Open DevTools → Network tab while:
1. Logging in
2. Navigating between pages
3. Calling API endpoints

Look for:
- ✅ Status 200/201 for successful requests
- ✅ Status 401 for unauthorized
- ✅ Proper Content-Type headers
- ✅ Authorization bearer tokens

### Check Token Format

```javascript
// In DevTools Console
const token = localStorage.getItem('vanta_token');
console.log(token);

// Decode JWT (install jwt-decode)
import jwt_decode from 'jwt-decode';
console.log(jwt_decode(token));
// Should show: {userId: "...", iat: ..., exp: ...}
```

### Monitor Storage

```javascript
// Check all stored items
Object.keys(localStorage).forEach(key => {
  console.log(`${key}:`, localStorage.getItem(key));
});
```

## Backend Testing with Postman/cURL

### Complete Registration Flow

```bash
# 1. Register
REGISTER=$(curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username":"postmanuser",
    "email":"postman@test.com",
    "password":"SecurePass123",
    "fullName":"Postman User"
  }')

echo $REGISTER
TOKEN=$(echo $REGISTER | jq -r '.token')
echo "Token: $TOKEN"

# 2. Get current user
curl -s -X GET http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq

# 3. Get sessions
curl -s -X GET http://localhost:5000/api/auth/sessions \
  -H "Authorization: Bearer $TOKEN" | jq

# 4. Logout
curl -s -X POST http://localhost:5000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Test Token Refresh

```bash
# 1. Register and get tokens
RESPONSE=$(curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username":"refreshtest",
    "email":"refresh@test.com",
    "password":"SecurePass123"
  }')

TOKEN=$(echo $RESPONSE | jq -r '.token')
REFRESH_TOKEN=$(echo $RESPONSE | jq -r '.refreshToken')

# 2. Refresh the token
curl -s -X POST http://localhost:5000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}" | jq
```

### Test Password Reset

```bash
# 1. Request password reset
curl -s -X POST http://localhost:5000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq

# 2. Check backend console for reset token

# 3. Verify reset token
curl -s -X POST http://localhost:5000/api/auth/verify-reset-token \
  -H "Content-Type: application/json" \
  -d '{"token":"[reset-token-from-console]"}' | jq

# 4. Reset password
curl -s -X POST http://localhost:5000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token":"[reset-token-from-console]",
    "newPassword":"NewSecurePass456"
  }' | jq
```

## Database Testing

### Connect to SQLite (Development)

```bash
cd backend
sqlite3 dev.db

# Common queries
sqlite> .schema User
sqlite> SELECT COUNT(*) FROM User;
sqlite> SELECT id, email, username FROM User;
sqlite> SELECT * FROM Session;
sqlite> .quit
```

### Verify User Created

```bash
# Backend console should show user creation
# Check with:
sqlite3 backend/dev.db "SELECT id, email, username, createdAt FROM User WHERE email='test@example.com';"
```

## Performance Testing

### Load Testing Auth Endpoints

```bash
# Install Apache Bench (ab)
# Test registration endpoint
ab -n 100 -c 10 -p data.json -T application/json http://localhost:5000/api/auth/login

# Test with different concurrent users
ab -n 1000 -c 50 http://localhost:5000/health
```

## Security Testing

### Test CORS

```bash
# From different origin
curl -i -X OPTIONS http://localhost:5000/api/auth/me \
  -H "Origin: http://invalid-origin.com"

# Should see CORS error for invalid origin
```

### Test Rate Limiting

```bash
# Send multiple requests
for i in {1..120}; do
  curl http://localhost:5000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"test"}'
done

# Should see rate limit error after limit is reached
```

### Test SQL Injection Prevention

```bash
# Try SQL injection in login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com\" OR \"1\"=\"1","password":"test"}'

# Should safely reject with validation error
```

## Regression Testing Checklist

Before each deploy, verify:

- [ ] Registration creates user
- [ ] Login returns token
- [ ] Token is valid JWT
- [ ] Refresh token works
- [ ] Expired token returns 401
- [ ] Protected routes require auth
- [ ] Logout clears session
- [ ] Phone OTP sends and verifies
- [ ] Google OAuth redirects properly
- [ ] Password reset flow works
- [ ] CORS allows valid origins
- [ ] Rate limiting active
- [ ] Error messages clear and helpful
- [ ] Frontend handles errors gracefully
- [ ] Session persists after refresh
- [ ] Multiple concurrent logins work

## Automated Tests

### Backend Unit Tests (Jest + ts-jest)

The backend includes 11 comprehensive test files covering all services:

```
backend/src/__tests__/
├── auth.service.test.ts      # Auth (register, login, JWT, OAuth, OTP, password reset)
├── user.service.test.ts      # Users (profiles, settings, follow, block, mute)
├── chat.service.test.ts      # Chat (conversations, messages, read receipts)
├── wallet.service.test.ts    # Wallet (coins, withdrawals, premium subscriptions)
├── payment.service.test.ts   # Payments (transactions, refunds, webhooks)
├── gift.service.test.ts      # Gifts (send, history, balance updates)
├── notification.service.test.ts # Notifications (CRUD, real-time, typed helpers)
├── live.service.test.ts      # Live streams (start, end, chat, viewers, stats)
├── security.test.ts          # Security (JWT, XSS, SQLi, CSRF, rate limiting, IDOR)
├── websocket.test.ts         # WebSocket (chat events, call signaling, presence)
└── integration.test.ts       # Integration (auth flows, wallet, stream lifecycle)
```

**Run tests:**
```bash
cd backend
npm test              # Run all tests
npm run test:coverage # Run with coverage report
npm run test:watch    # Watch mode
npm run test:ci       # CI mode (coverage + max 2 workers)
```

**Requirements:** `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest`

### Load Testing

```
backend/load-test.js  # Simulates 100+ concurrent users against all endpoints
```

**Run:**
```bash
node backend/load-test.js
# Or customize:
CONCURRENCY=100 TARGET=http://localhost:5000 node backend/load-test.js
```

### Health Monitoring

```
backend/health-check.js  # Continuous health monitoring with alerts
```

**Run:**
```bash
node backend/health-check.js
```

## Test Coverage Summary

| Category | Files | Tests |
|----------|-------|-------|
| **Unit Tests** | `auth.service.test.ts` | 25+ tests: register, login, verify, refresh, logout, sessions, OTP, OAuth, password reset |
| | `user.service.test.ts` | 20+ tests: profiles, updates, settings, follow, block, mute, stats |
| | `chat.service.test.ts` | 10+ tests: conversations, send, read receipts, search |
| | `wallet.service.test.ts` | 10+ tests: balance, add/deduct coins, withdrawals, premium |
| | `payment.service.test.ts` | 10+ tests: init, verify, refund, webhook, payment link |
| | `gift.service.test.ts` | 5+ tests: send gift, history, insufficient balance |
| | `notification.service.test.ts` | 10+ tests: CRUD, mark read, typed notifications |
| | `live.service.test.ts` | 15+ tests: start, end, join, leave, chat, stats |
| **Security Tests** | `security.test.ts` | 15+ tests: JWT, XSS, SQLi, CSRF, rate limiting, HMAC, IDOR |
| **WebSocket Tests** | `websocket.test.ts` | 10+ tests: chat events, call signaling, presence, auth |
| **Integration Tests** | `integration.test.ts` | 10+ tests: full user flows, data consistency |
| **Total** | **11 files** | **~140+ test cases** |
```
