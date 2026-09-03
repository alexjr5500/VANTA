import { API_BASE_URL, authHeaders, ApiError, type ApiResponse } from './api';

// In-memory request cache for GET requests
const requestCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30_000; // 30 seconds default cache
const pendingRequests = new Map<string, Promise<any>>(); // Request deduplication
const inflightControllers = new Map<string, AbortController>(); // In-flight request cancellation

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay
const RETRY_BACKOFF = 2; // Exponential backoff multiplier

// Request batching
interface BatchEntry {
  path: string;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}
const batchQueue = new Map<string, BatchEntry[]>();
const BATCH_WINDOW_MS = 50; // 50ms bat
const BATCH_ENDPOINTS = ['/api/feed', '/api/notifications', '/api/messages']; // Batchable endpoints

const getCacheKey = (method: string, url: string, body?: string): string => {
  if (body) return `${method}:${url}:${body}`;
  return `${method}:${url}`;
};

const readJson = async (response: Response) => {
  const contentType = response.headers.get('content-type');
  
  if (contentType && contentType.includes('application/json')) {
    const data = await response.json();
    
    if (!response.ok) {
      throw new ApiError(
        response.status,
        data.error || data.message || response.statusText,
        data
      );
    }
    
    return data;
  }
  
  const text = await response.text();
  
  if (!response.ok) {
    throw new ApiError(response.status, text || response.statusText);
  }
  
  return { message: text };
};

// Notify AuthProvider so it can recover with the persistent refresh token.
// The request layer must not clear storage: a 401 can be recovered, while
// network errors and cancelled requests are never authentication decisions.
const handleSessionExpiry = (error: unknown, token?: string) => {
  if (error instanceof ApiError && error.statusCode === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vanta-auth-expired', {
      detail: { token },
    }));
  }
};

// Exponential backoff sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Cancel an active request by URL pattern
export const cancelRequest = (pathPattern: string): void => {
  for (const [key, controller] of inflightControllers) {
    if (key.includes(pathPattern)) {
      controller.abort();
      inflightControllers.delete(key);
    }
  }
};

// Cancel all active requests
export const cancelAllRequests = (): void => {
  for (const [, controller] of inflightControllers) {
    controller.abort();
  }
  inflightControllers.clear();
};

// Request batching for specific endpoints
const tryBatchRequest = async <T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string }
): Promise<T | null> => {
  // Only batch GET requests to specific endpoints
  if (method !== 'GET') return null;
  
  const basePath = '/' + path.split('/').slice(1, 3).join('/');
  if (!BATCH_ENDPOINTS.includes(basePath)) return null;

  return new Promise<T>((resolve, reject) => {
    if (!batchQueue.has(path)) {
      batchQueue.set(path, []);
      
      // Schedule batch processing after a short delay
      setTimeout(() => {
        const entries = batchQueue.get(path) || [];
        batchQueue.delete(path);
        
        if (entries.length === 0) return;
        
        // Execute single request for all batched entries
        makeRequestInternal<T>(method, path, options)
          .then((data) => {
            entries.forEach((entry) => entry.resolve(data));
          })
          .catch((error) => {
            entries.forEach((entry) => entry.reject(error));
          });
      }, BATCH_WINDOW_MS);
    }
    
    batchQueue.get(path)!.push({ path, resolve, reject } as BatchEntry);
  });
};

const makeRequestInternal = async <T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
    cacheTTL?: number;
    skipCache?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<T> => {
  const url = `${API_BASE_URL}${path}`;
  const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
  const cacheKey = getCacheKey(method, url, bodyStr);
  const now = Date.now();

  // Return cached data for GET requests if valid
  if (method === 'GET' && !options.skipCache) {
    const cached = requestCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < (options.cacheTTL || CACHE_TTL)) {
      return cached.data as T;
    }

    // Deduplicate concurrent GET requests
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  // Concurrent GETs have already been deduplicated above. Never abort an
  // otherwise valid request merely because another component asks for the same
  // resource; that made route transitions surface as application failures.
  // Explicit caller cancellation remains supported through `options.signal`,
  // `cancelRequest`, and `cancelAllRequests`.
  const controller = new AbortController();
  if (method === 'GET') {
    inflightControllers.set(cacheKey, controller);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Accept compressed responses
    'Accept-Encoding': 'gzip, deflate, br',
    ...authHeaders(options.token),
    ...options.headers,
  };

  const executeFetch = async (retryCount: number = 0): Promise<T> => {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: bodyStr,
        credentials: 'include',
        signal: options.signal || controller.signal,
        // Enable keep-alive for connection reuse
        keepalive: method !== 'GET',
        // Enable cache mode for GET requests
        cache: method === 'GET' ? 'default' : 'no-store',
      });

      const data = await readJson(response);

      // Cache successful GET responses
      if (method === 'GET') {
        requestCache.set(cacheKey, { data, timestamp: Date.now() });
      }

      return data as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(499, 'The request was cancelled before it completed.');
      }

      if (error instanceof ApiError) {
        // Don't retry client errors (4xx)
        if (error.statusCode >= 400 && error.statusCode < 500) {
          // Public endpoint 401s (for example, a bad login password) are not
          // session expiry and must remain visible on the form.
          if (options.token && error.statusCode === 401) handleSessionExpiry(error, options.token);
          throw error;
        }
      }

      // Retry on network errors or 5xx with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY * Math.pow(RETRY_BACKOFF, retryCount);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[API] Retry ${retryCount + 1}/${MAX_RETRIES} for ${method} ${url} after ${delay}ms`);
        }
        await sleep(delay);
        return executeFetch(retryCount + 1);
      }

      // Network error or parsing error after all retries
      console.error(`[API] Error ${method} ${url}:`, error);
      throw new ApiError(
        500,
        error instanceof Error ? error.message : 'Network Error',
        error
      );
    }
  };

  const promise = executeFetch().finally(() => {
    // A newer request may already own this key. Do not remove its controller
    // when an older request settles after being aborted.
    if (inflightControllers.get(cacheKey) === controller) {
      inflightControllers.delete(cacheKey);
    }
  });

  // Store pending promise for deduplication
  if (method === 'GET') {
    pendingRequests.set(cacheKey, promise);
    promise.finally(() => {
      pendingRequests.delete(cacheKey);
    });
  }

  return promise;
};

const makeRequest = async <T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
    cacheTTL?: number;
    skipCache?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<T> => {
  // Try batching first
  const batchResult = await tryBatchRequest<T>(method, path, options);
  if (batchResult !== null) return batchResult;

  return makeRequestInternal<T>(method, path, options);
};

// Invalidate cache for a specific path pattern
export const invalidateCache = (pathPattern?: string) => {
  if (!pathPattern) {
    requestCache.clear();
    return;
  }
  for (const key of requestCache.keys()) {
    if (key.includes(pathPattern)) {
      requestCache.delete(key);
    }
  }
};

// Prefetch data for faster navigation
export const prefetchData = (path: string, token?: string): void => {
  if (typeof window === 'undefined') return;
  const url = `${API_BASE_URL}${path}`;
  const cacheKey = `GET:${url}`;
  
  if (!requestCache.has(cacheKey)) {
    // Use low priority fetch
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        makeRequestInternal('GET', path, { token, cacheTTL: CACHE_TTL }).catch(() => {});
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
        makeRequestInternal('GET', path, { token, cacheTTL: CACHE_TTL }).catch(() => {});
      }, 1000);
    }
  }
};

export const apiGet = async <T>(
  path: string, 
  token?: string, 
  options?: { cacheTTL?: number; skipCache?: boolean; signal?: AbortSignal }
): Promise<T> => {
  return makeRequest<T>('GET', path, { token, ...options });
};

export const apiPost = async <T>(
  path: string,
  payload: unknown,
  token?: string
): Promise<T> => {
  // Invalidate related caches on mutation
  invalidateCache(path.split('/').slice(1, 3).join('/'));
  return makeRequest<T>('POST', path, { body: payload, token });
};

export const apiPut = async <T>(
  path: string,
  payload: unknown,
  token?: string
): Promise<T> => {
  invalidateCache(path.split('/').slice(1, 3).join('/'));
  return makeRequest<T>('PUT', path, { body: payload, token });
};

export const apiPatch = async <T>(
  path: string,
  payload: unknown,
  token?: string
): Promise<T> => {
  invalidateCache(path.split('/').slice(1, 3).join('/'));
  return makeRequest<T>('PATCH', path, { body: payload, token });
};

export const apiDelete = async <T>(
  path: string,
  token?: string
): Promise<T> => {
  invalidateCache(path.split('/').slice(1, 3).join('/'));
  return makeRequest<T>('DELETE', path, { token });
};

/**
 * Upload a file via FormData.
 * Supports both POST and PUT methods. The browser automatically sets
 * the correct Content-Type (multipart/form-data) for FormData bodies.
 */
export const apiUpload = async <T>(
  path: string,
  formData: FormData,
  token?: string,
  method: 'POST' | 'PUT' = 'POST',
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<T> => {
  const url = `${API_BASE_URL}${path}`;
  invalidateCache(path.split('/').slice(1, 3).join('/'));
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[API] ${method} ${url} (FormData)`);
  }

  const executeUpload = async (retryCount: number = 0): Promise<T> => {
    try {
      // Use XMLHttpRequest for upload progress tracking
      if (onProgress && typeof XMLHttpRequest !== 'undefined') {
        return await new Promise<T>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const abortUpload = () => xhr.abort();
          if (signal?.aborted) { reject(new ApiError(499, 'Upload cancelled')); return; }
          signal?.addEventListener('abort', abortUpload, { once: true });
          
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const percent = Math.round((e.loaded / e.total) * 100);
              onProgress(percent);
            }
          });
          
          xhr.addEventListener('load', () => {
            signal?.removeEventListener('abort', abortUpload);
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(data as T);
              } else {
                reject(new ApiError(
                  xhr.status,
                  data.error || data.message || `Upload failed with status ${xhr.status}`,
                  data
                ));
              }
            } catch {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve({ message: xhr.responseText } as T);
              } else {
                reject(new ApiError(xhr.status, xhr.responseText || 'Upload failed'));
              }
            }
          });
          
          xhr.addEventListener('error', () => {
            signal?.removeEventListener('abort', abortUpload);
            reject(new ApiError(0, 'Network error during upload'));
          });
          
          xhr.addEventListener('abort', () => {
            signal?.removeEventListener('abort', abortUpload);
            reject(new ApiError(499, 'Upload cancelled'));
          });
          
          xhr.open(method, url);
          
          // Set auth header
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
          
          // Don't set Content-Type - browser sets it for FormData
          xhr.send(formData);
        });
      }

      // Fallback to fetch if XHR is not available or no progress needed
      const response = await fetch(url, {
        method,
        headers: {
          ...authHeaders(token),
          // Don't set Content-Type - browser sets it for FormData
        },
        body: formData,
        credentials: 'include',
        signal,
      });

      const data = await readJson(response);
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        // Don't retry client errors (4xx)
        if (error.statusCode >= 400 && error.statusCode < 500) {
          if (token && error.statusCode === 401) handleSessionExpiry(error, token);
          throw error;
        }
      }

      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY * Math.pow(RETRY_BACKOFF, retryCount);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[API] Upload retry ${retryCount + 1}/${MAX_RETRIES} for ${method} ${url} after ${delay}ms`);
        }
        await sleep(delay);
        return executeUpload(retryCount + 1);
      }
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      console.error(`[API] Error uploading to ${url}:`, error);
      throw new ApiError(
        500,
        error instanceof Error ? error.message : 'Upload failed',
        error
      );
    }
  };

  return executeUpload();
};

// Get cache stats for monitoring
export const getCacheStats = () => ({
  size: requestCache.size,
  pendingRequests: pendingRequests.size,
  inflightRequests: inflightControllers.size,
  batchQueueSize: batchQueue.size,
});