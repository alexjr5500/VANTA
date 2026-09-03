import { apiPost, apiGet } from './apiClient';
import type { ApiResponse } from './api';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  fullName?: string;
  avatar?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  profile?: Record<string, unknown>;
  role?: string;
  verified?: boolean;
  createdAt?: string;
  emailVerified?: boolean;
  lastLoginAt?: string;
  lastLogin?: string;
  coins?: number;
  earnings?: number;
  twoFactorEnabled?: boolean;
}

export interface AuthResponse extends ApiResponse {
  token?: string;
  refreshToken?: string;
  user?: AuthUser;
  expiresIn?: number;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  fullName?: string;
}

export interface LoginPayload {
  identifier: string;
  password: string;
  rememberMe?: boolean;
}

export interface GoogleAuthPayload {
  idToken: string;
}

export interface AppleAuthPayload {
  identityToken: string;
  userIdentifier: string;
}

export interface PhoneOTPSendPayload {
  phoneNumber: string;
}

export interface PhoneOTPVerifyPayload {
  phoneNumber: string;
  otp: string;
}

export interface RefreshTokenPayload {
  refreshToken: string;
}

/**
 * Register with email and password
 */
export const authRegister = async (payload: RegisterPayload): Promise<AuthResponse> => {
  return apiPost<AuthResponse>('/api/auth/register', payload);
};

/**
 * Login with email and password
 */
export const authLogin = async (payload: LoginPayload): Promise<AuthResponse> => {
  return apiPost<AuthResponse>('/api/auth/login', payload);
};

/**
 * Authenticate with Google OAuth
 */
export const authGoogle = async (payload: GoogleAuthPayload, token?: string): Promise<AuthResponse> => {
  return apiPost<AuthResponse>('/api/auth/google', payload, token);
};

/**
 * Authenticate with Apple Sign In
 */
export const authApple = async (payload: AppleAuthPayload, token?: string): Promise<AuthResponse> => {
  return apiPost<AuthResponse>('/api/auth/apple', payload, token);
};

/**
 * Send OTP for phone authentication
 */
export const authPhoneSendOTP = async (payload: PhoneOTPSendPayload): Promise<ApiResponse> => {
  return apiPost<ApiResponse>('/api/auth/phone/send-otp', payload);
};

/**
 * Verify OTP for phone authentication
 */
export const authPhoneVerifyOTP = async (payload: PhoneOTPVerifyPayload): Promise<AuthResponse> => {
  return apiPost<AuthResponse>('/api/auth/phone/verify-otp', payload);
};

/**
 * Refresh access token using refresh token
 */
export const authRefreshToken = async (payload: RefreshTokenPayload): Promise<AuthResponse> => {
  return apiPost<AuthResponse>('/api/auth/refresh', payload);
};

/**
 * Logout and invalidate token
 */
export const authLogout = async (token: string): Promise<ApiResponse> => {
  return apiPost<ApiResponse>('/api/auth/logout', {}, token);
};

/**
 * Get current user profile
 */
export const authGetMe = async (token: string): Promise<AuthResponse> => {
  return apiGet<AuthResponse>('/api/auth/me', token);
};

/**
 * Get all active sessions
 */
export const authGetSessions = async (token: string): Promise<ApiResponse> => {
  return apiGet<ApiResponse>('/api/auth/sessions', token);
};

/**
 * Verify password reset token
 */
export const authVerifyResetToken = async (token: string): Promise<ApiResponse> => {
  return apiPost<ApiResponse>('/api/auth/verify-reset-token', { token });
};

/**
 * Request password reset via email
 */
export const authForgotPassword = async (email: string): Promise<ApiResponse> => {
  return apiPost<ApiResponse>('/api/auth/forgot-password', { email });
};

/**
 * Reset password with token
 */
export const authResetPassword = async (token: string, newPassword: string): Promise<ApiResponse> => {
  return apiPost<ApiResponse>('/api/auth/reset-password', { token, newPassword });
};
