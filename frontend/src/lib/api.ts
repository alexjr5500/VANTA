// API Configuration
export const API_BASE_URL = (() => {
  if (typeof window === 'undefined') {
    // Server-side fallback
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  }
  
  // Client-side
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  
  if (!baseUrl) {
    // In a LAN/mobile development session the phone's `localhost` is the
    // phone, not the laptop running Express. Keep the current hostname but
    // use the backend port. Production deployments must provide
    // NEXT_PUBLIC_API_URL explicitly.
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      const backendHost = hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'localhost'
        : hostname;
      return `${window.location.protocol}//${backendHost}:5000`;
    }
    return 'http://localhost:5000';
  }
  
  return baseUrl.replace(/\/$/, '');
})();

// Socket.IO normally shares the API host, while allowing a separate production
// endpoint when the realtime service is deployed independently.
export const SOCKET_BASE_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_BASE_URL;

export type ApiResponse<T = any> = {
  data?: T;
  message?: string;
  error?: string;
  token?: string;
  user?: any;
  code?: number;
};

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const authHeaders = (token?: string | null): Record<string, string> => {
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};
