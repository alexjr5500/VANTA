# Live Streaming Prerequisites

VANTA livestreams require a reachable LiveKit deployment in addition to the API,
frontend, database, and Redis services. Configure `LIVEKIT_HOST`, `LIVEKIT_API_KEY`, and
`LIVEKIT_API_SECRET` on the backend. Configure `NEXT_PUBLIC_LIVEKIT_URL` and
`NEXT_PUBLIC_SOCKET_URL` at frontend build time. Production browser endpoints must use
`https://` and `wss://`; camera and microphone capture is blocked on insecure origins.

LiveKit must expose its signaling port and configured WebRTC UDP/TCP port range through
the load balancer/firewall. The API and Socket.IO endpoint must share the same JWT secret,
and all frontend origins must be included in the backend CORS allowlist. Apply the Prisma
schema before deployment and seed the gift catalog and livestream categories. A stream can
only start when the backend can create a real LiveKit room; there is no fallback simulation.

# VANTA Authentication System - Complete Deployment Guide

## Overview

This guide walks you through deploying the complete VANTA authentication system with OAuth (Google & Apple), Phone OTP, and JWT-based session management.

## Architecture

```
┌─────────────────┐
│   Vercel        │
│   (Frontend)    │
│   Next.js       │
└────────┬────────┘
         │ HTTPS
         │
┌────────▼────────────────┐
│   Railway               │
│   (Backend)             │
│   Node.js + Express     │
│   + PostgreSQL          │
└─────────────────────────┘
```

## Prerequisites

- GitHub repository (for version control)
- Vercel account (for frontend deployment)
- Railway account (for backend deployment)
- PostgreSQL database (Railway provides this)
- Google OAuth credentials
- Apple Developer account (for Apple Sign In)
- Twilio account (for Phone OTP) OR Firebase project

## Part 1: Backend Deployment on Railway

### Step 1: Prepare Backend for Production

1. **Update environment variables** in backend `.env`:
   ```bash
   cp backend/.env.example backend/.env
   ```

2. **Generate secure JWT secrets**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Run this twice and use the outputs for JWT_SECRET and JWT_REFRESH_SECRET.

3. **Build locally to verify**:
   ```bash
   cd backend
   npm run build
   cd ..
   ```

### Step 2: Connect Railway to GitHub

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your VANTA repository
4. Railway will detect the monorepo

### Step 3: Configure Backend Service on Railway

1. In Railway dashboard, click the backend service
2. Go to "Settings" tab
3. Set "Root Directory" to `backend`
4. Go to "Variables" tab and add:

```
DATABASE_URL: (Railway auto-generates this)
PORT: 5000
NODE_ENV: production
JWT_SECRET: [your-generated-secret]
JWT_REFRESH_SECRET: [your-generated-refresh-secret]
JWT_EXPIRES_IN: 7d
JWT_REFRESH_EXPIRES_IN: 30d
FRONTEND_URL: https://your-vercel-domain.vercel.app
GOOGLE_CLIENT_ID: [your-google-client-id]
GOOGLE_CLIENT_SECRET: [your-google-client-secret]
APPLE_CLIENT_ID: [your-vanta-apple-service-id]
APPLE_TEAM_ID: [your-apple-team-id]
TWILIO_ACCOUNT_SID: [your-twilio-sid]
TWILIO_AUTH_TOKEN: [your-twilio-token]
TWILIO_PHONE_NUMBER: [your-twilio-number]
SENDGRID_API_KEY: [your-sendgrid-key]
```

### Step 4: Deploy Backend

1. Click "Deploy" button
2. Railway will run: `npm run build` from the backend directory
3. Then start the server
4. After deployment, copy your Railway backend URL (e.g., `https://your-backend.up.railway.app`)

### Step 5: Run Migrations

After first deployment:
```bash
# Via Railway dashboard terminal or SSH
npx prisma migrate deploy
npx prisma db seed
```

## Part 2: Frontend Deployment on Vercel

### Step 1: Connect Frontend to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project" → "Import Git Repository"
3. Select your VANTA repository
4. Vercel will auto-detect Next.js

### Step 2: Configure Build Settings

1. **Root Directory**: `frontend`
2. **Build Command**: `npm run build`
3. **Install Command**: `npm install`
4. **Output Directory**: `.next`

### Step 3: Add Environment Variables

Go to "Settings" → "Environment Variables" and add:

```
NEXT_PUBLIC_API_URL=https://your-backend.up.railway.app
NEXT_PUBLIC_GOOGLE_CLIENT_ID=[your-google-client-id]
NEXT_PUBLIC_FIREBASE_API_KEY=[your-firebase-key]
```

### Step 4: Deploy

Vercel will automatically deploy when you push to main branch.

## Part 3: Google OAuth Setup

### Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project: "VANTA"
3. Enable Google+ API
4. Go to "Credentials" → "Create OAuth 2.0 Client ID"
5. Choose "Web application"
6. Add Authorized Redirect URIs:
   - Local: `http://localhost:5000/api/auth/google/callback`
   - Production: `https://your-railway-domain/api/auth/google/callback`
7. Add Authorized JavaScript Origins:
   - Local: `http://localhost:3000`
   - Production: `https://your-vercel-domain.vercel.app`
8. Copy Client ID and Client Secret

### Update Environment Variables

Add to both backend and frontend:
```
GOOGLE_CLIENT_ID=[from Google Console]
GOOGLE_CLIENT_SECRET=[from Google Console] (backend only)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=[from Google Console] (frontend only)
```

## Part 4: Apple Sign In Setup

### Create Apple Developer Account

1. Go to [Apple Developer](https://developer.apple.com)
2. Create a Service ID for VANTA (for example, `com.yourdomain.vanta`)
3. Configure Sign In Settings:
   - Domains: `yourdomain.com`, `vercel.app`
   - Return URLs:
     - `https://your-railway-domain/api/auth/apple/callback`
     - `https://your-vercel-domain.vercel.app/auth/apple/callback`

4. Create private key for Server-to-Server communication
5. Download the key (.p8 file)

### Update Environment Variables

```
APPLE_CLIENT_ID=[your-vanta-apple-service-id]
APPLE_TEAM_ID=[from Apple Developer]
APPLE_KEY_ID=[from your key file]
APPLE_KEY_SECRET=[content of .p8 file]
```

## Part 5: Phone OTP with Twilio

### Create Twilio Account

1. Go to [twilio.com](https://www.twilio.com)
2. Create account
3. Get "Account SID" and "Auth Token"
4. Verify phone number or request production account
5. Get a Twilio phone number

### Update Environment Variables

```
TWILIO_ACCOUNT_SID=[your-account-sid]
TWILIO_AUTH_TOKEN=[your-auth-token]
TWILIO_PHONE_NUMBER=[your-twilio-number]
```

## Part 6: Email Service Setup (Password Reset)

### Using SendGrid

1. Go to [sendgrid.com](https://sendgrid.com)
2. Create account
3. Go to Settings → API Keys
4. Create new key
5. Copy the key

### Update Environment Variables

```
EMAIL_SERVICE=sendgrid
SENDGRID_API_KEY=[your-sendgrid-key]
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
```

## Part 7: CORS Configuration

The backend is already configured for CORS. Update `FRONTEND_URL` in backend environment variables:

```
FRONTEND_URL=https://your-vercel-domain.vercel.app
```

## Part 8: Custom Domain Setup

### For Vercel Frontend

1. Go to Vercel Project Settings → Domains
2. Add custom domain
3. Update DNS records
4. Enable HTTPS (automatic with Vercel)

### For Railway Backend

1. Go to Railway Project → Settings → Domains
2. Add custom domain
3. Update DNS records

## Part 9: Health Check & Testing

### Test Backend Health

```bash
curl https://your-railway-domain/health
```

Response:
```json
{
  "status": "ok",
  "message": "VANTA API is running"
}
```

### Test Authentication Endpoints

1. **Register**:
```bash
curl -X POST https://your-railway-domain/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "SecurePass123"
  }'
```

2. **Login**:
```bash
curl -X POST https://your-railway-domain/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123"
  }'
```

3. **Get Current User**:
```bash
curl https://your-railway-domain/api/auth/me \
  -H "Authorization: Bearer [your-token]"
```

## Part 10: Production Checklist

- [ ] Database migrations run successfully
- [ ] All environment variables set in Railway
- [ ] All environment variables set in Vercel
- [ ] Google OAuth working
- [ ] Apple Sign In configured
- [ ] Twilio SMS configured and tested
- [ ] Email service configured
- [ ] CORS properly configured
- [ ] HTTPS enforced on both frontend and backend
- [ ] Health endpoint returns 200
- [ ] Registration works end-to-end
- [ ] Login works end-to-end
- [ ] Token refresh works
- [ ] OAuth Google login works
- [ ] Phone OTP works
- [ ] Rate limiting configured
- [ ] Error logging configured
- [ ] Monitoring/alerts set up

## Part 11: Monitoring & Maintenance

### Enable Vercel Analytics

In `frontend/src/app/layout.tsx`:
```typescript
import { Analytics } from "@vercel/analytics/next";

export default function RootLayout() {
  return (
    <>
      {/* Your app */}
      <Analytics />
    </>
  );
}
```

### Set Up Error Tracking

Consider integrating Sentry or similar for production error tracking.

## Part 12: Troubleshooting

### "Failed to fetch" Error

**Cause**: NEXT_PUBLIC_API_URL not set or incorrect
**Solution**: 
1. Check Vercel environment variables
2. Ensure backend URL is correct and accessible
3. Check CORS configuration on backend

### Token Expired Error

**Cause**: Access token expired, refresh token either invalid or expired
**Solution**:
1. Check JWT_EXPIRES_IN and JWT_REFRESH_EXPIRES_IN
2. Ensure database sessions are properly stored
3. Check system time sync between frontend and backend

### OAuth Not Working

**Cause**: Redirect URI mismatch or missing credentials
**Solution**:
1. Verify redirect URIs match exactly in OAuth provider settings
2. Check that CLIENT_ID and CLIENT_SECRET are correct
3. Ensure callback routes exist on backend

### Database Connection Failed

**Cause**: DATABASE_URL not set or incorrect
**Solution**:
1. Copy DATABASE_URL from Railway
2. Verify PostgreSQL service is running on Railway
3. Check connection string format

## Next Steps

1. Set up automated tests
2. Configure CI/CD pipeline
3. Set up staging environment
4. Implement rate limiting per IP
5. Add email verification
6. Implement 2FA
7. Set up automated backups
8. Configure CDN for static assets

## Support & Resources

- [Vercel Docs](https://vercel.com/docs)
- [Railway Docs](https://docs.railway.app)
- [Next.js Docs](https://nextjs.org/docs)
- [Express.js Docs](https://expressjs.com)
- [Prisma Docs](https://www.prisma.io/docs)
