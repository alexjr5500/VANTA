/**
 * Enterprise security configuration for VANTA.
 * All values can be overridden via environment variables.
 */
export const config = {
  /** Authentication policy */
  auth: {
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  },

  /** JWT Configuration */
  jwt: {
    accessToken: {
      secret: () => process.env.JWT_SECRET || '',
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    },
    refreshToken: {
      secret: () => process.env.JWT_REFRESH_SECRET || '',
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },
    rememberMe: {
      expiresIn: process.env.JWT_REMEMBER_ME_EXPIRES_IN || '30d',
    },
    emailVerification: {
      expiresIn: process.env.EMAIL_VERIFICATION_EXPIRES_IN || '24h',
    },
    passwordReset: {
      expiresIn: process.env.PASSWORD_RESET_EXPIRES_IN || '1h',
    },
  },

  /** Password Policy */
  password: {
    minLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '12', 10),
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxHistory: parseInt(process.env.PASSWORD_MAX_HISTORY || '5', 10),
    expiryDays: parseInt(process.env.PASSWORD_EXPIRY_DAYS || '90', 10),
  },

  /** bcrypt Password Hashing Configuration */
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  },

  /** 2FA Configuration */
  twoFactor: {
    issuer: process.env.TOTP_ISSUER || 'VANTA',
    backupCodesCount: parseInt(process.env.TOTP_BACKUP_CODES || '8', 10),
    trustedDeviceExpiryDays: parseInt(process.env.TRUSTED_DEVICE_EXPIRY_DAYS || '30', 10),
  },

  /** Rate Limiting */
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),  // 15 min
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    
    // Specific endpoint limits
    login: {
      windowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW || '900000', 10),
      max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '10', 10),
    },
    register: {
      windowMs: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW || '3600000', 10),
      max: parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '5', 10),
    },
    passwordReset: {
      windowMs: parseInt(process.env.RATE_LIMIT_PASSWORD_RESET_WINDOW || '3600000', 10),
      max: parseInt(process.env.RATE_LIMIT_PASSWORD_RESET_MAX || '3', 10),
    },
    otp: {
      windowMs: parseInt(process.env.RATE_LIMIT_OTP_WINDOW || '900000', 10),
      max: parseInt(process.env.RATE_LIMIT_OTP_MAX || '5', 10),
    },
    api: {
      windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW || '60000', 10),
      max: parseInt(process.env.RATE_LIMIT_API_MAX || '60', 10),
    },
    messaging: {
      windowMs: parseInt(process.env.RATE_LIMIT_MESSAGING_WINDOW || '1000', 10),
      max: parseInt(process.env.RATE_LIMIT_MESSAGING_MAX || '1', 10),
    },
    upload: {
      windowMs: parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW || '3600000', 10),
      max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || '10', 10),
    },
    search: {
      windowMs: parseInt(process.env.RATE_LIMIT_SEARCH_WINDOW || '60000', 10),
      max: parseInt(process.env.RATE_LIMIT_SEARCH_MAX || '30', 10),
    },
  },

  /** File Upload Security */
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),  // 10MB
    maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE || '5242880', 10),  // 5MB
    maxVideoSize: parseInt(process.env.MAX_VIDEO_SIZE || '104857600', 10), // 100MB
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
    allowedVideoTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    allowedDocumentTypes: ['application/pdf', 'text/plain'],
    blockedExtensions: [
      '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.js', '.vbs',
      '.ps1', '.sh', '.bash', '.php', '.py', '.rb', '.pl', '.asp',
      '.aspx', '.jsp', '.cgi', '.htaccess', '.dll', '.so', '.dylib',
    ],
    virusScanEnabled: process.env.VIRUS_SCAN_ENABLED === 'true',
  },

  /** Session Configuration */
  session: {
    maxSessionsPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '10', 10),
    cleanupInterval: parseInt(process.env.SESSION_CLEANUP_INTERVAL || '3600000', 10), // 1 hour
  },

  /** Bot Protection */
  botProtection: {
    enabled: process.env.BOT_PROTECTION_ENABLED !== 'false',
    captchaEnabled: process.env.CAPTCHA_ENABLED === 'true',
    captchaThreshold: parseFloat(process.env.CAPTCHA_THRESHOLD || '0.5'),
    suspiciousScoreThreshold: parseFloat(process.env.SUSPICIOUS_SCORE_THRESHOLD || '0.7'),
    maxFailedLogins: parseInt(process.env.MAX_FAILED_LOGINS || '5', 10),
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || '900000', 10), // 15 min
  },

  /** Audit Logging */
  auditLog: {
    enabled: process.env.AUDIT_LOG_ENABLED !== 'false',
    retentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '365', 10),
    logBody: process.env.AUDIT_LOG_BODY === 'true',
  },

  /** Account Lockout */
  lockout: {
    maxAttempts: parseInt(process.env.LOCKOUT_MAX_ATTEMPTS || '5', 10),
    duration: parseInt(process.env.LOCKOUT_DURATION_MS || '900000', 10), // 15 min
    escalationThreshold: parseInt(process.env.LOCKOUT_ESCALATION_THRESHOLD || '10', 10),
    escalationDuration: parseInt(process.env.LOCKOUT_ESCALATION_DURATION || '3600000', 10), // 1 hr
  },

  /** Encryption */
  encryption: {
    key: () => process.env.ENCRYPTION_KEY || '',
    algorithm: 'aes-256-gcm' as const,
  },

  /** CORS */
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    credentials: true,
    maxAge: parseInt(process.env.CORS_MAX_AGE || '86400', 10),
  },

  /** Content Security Policy */
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://vercel.live'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
    connectSrc: ["'self'", 'https://*.stripe.com', 'wss:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    frameSrc: ["'none'"],
    mediaSrc: ["'self'", 'blob:', 'data:'],
    workerSrc: ["'self'", 'blob:'],
  },

  /** HSTS */
  hsts: {
    maxAge: parseInt(process.env.HSTS_MAX_AGE || '31536000', 10), // 1 year
    includeSubDomains: true,
    preload: true,
  },

  /** Cookie Security */
  cookies: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  },

  /** Compliance */
  compliance: {
    gdprEnabled: process.env.GDPR_ENABLED !== 'false',
    dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS || '730', 10), // 2 years
    deletionGracePeriodDays: parseInt(process.env.DELETION_GRACE_PERIOD_DAYS || '30', 10),
  },
};

export default config;