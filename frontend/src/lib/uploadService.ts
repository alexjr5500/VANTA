'use client';

import { API_BASE_URL, authHeaders } from './api';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB (matches backend)
export const MAX_BANNER_SIZE = 10 * 1024 * 1024; // 10MB (matches backend)
export const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15MB
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024; // 5MB

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

// ============================================================================
// TYPES
// ============================================================================

export interface UploadResult {
  url: string;
  fileId?: string;
  user?: Record<string, any>;
  profile?: Record<string, any>;
  error?: string;
}

export interface UploadProgress {
  percent: number;
  status: 'compressing' | 'uploading' | 'done' | 'error';
  error?: string;
}

export type UploadCategory =
  | 'avatar'
  | 'banner'
  | 'post-image'
  | 'post-video'
  | 'story'
  | 'reel'
  | 'thumbnail'
  | 'message'
  | 'group-avatar'
  | 'channel-avatar'
  | 'community-avatar'
  | 'community-banner'
  | 'verification'
  | 'profile-media'
  | 'generic';

// ============================================================================
// VALIDATION
// ============================================================================

export interface ValidationOptions {
  maxSize: number;
  allowedTypes: string[];
  fieldName: string;
}

export function validateFile(file: File, options: ValidationOptions): string | null {
  if (!options.allowedTypes.includes(file.type)) {
    return `${options.fieldName} must be one of: ${options.allowedTypes
      .map(t => t.split('/')[1]?.toUpperCase() || t)
      .join(', ')}. Received: ${file.type || 'unknown type'}`;
  }
  if (file.size > options.maxSize) {
    const maxMB = options.maxSize / (1024 * 1024);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `${options.fieldName} must be under ${maxMB}MB. Current size: ${sizeMB}MB`;
  }
  return null;
}

/**
 * Validate an image file.
 */
export function validateImageFile(file: File, fieldName = 'File', maxSize = MAX_IMAGE_SIZE): string | null {
  return validateFile(file, {
    maxSize,
    allowedTypes: ALLOWED_IMAGE_TYPES,
    fieldName,
  });
}

/**
 * Validate a video file.
 */
export function validateVideoFile(file: File, fieldName = 'Video', maxSize = MAX_VIDEO_SIZE): string | null {
  return validateFile(file, {
    maxSize,
    allowedTypes: ALLOWED_VIDEO_TYPES,
    fieldName,
  });
}

/**
 * Validate a document file.
 */
export function validateDocumentFile(file: File, fieldName = 'Document', maxSize = MAX_DOCUMENT_SIZE): string | null {
  return validateFile(file, {
    maxSize,
    allowedTypes: ALLOWED_DOCUMENT_TYPES,
    fieldName,
  });
}

// ============================================================================
// IMAGE COMPRESSION
// ============================================================================

/**
 * Compress an image before upload.
 */
export function compressImage(file: File, maxWidth: number = 2048, quality: number = 0.85): Promise<Blob> {
  // Skip compression for files under 500KB
  if (file.size < 500 * 1024) {
    return Promise.resolve(file);
  }

  // Compression is a best-effort optimization — the server re-optimizes
  // images anyway. This implementation must NEVER hang or throw, otherwise
  // profile/photo uploads appear to do nothing. Every failure path falls
  // back to the original file so the upload still completes.
  return new Promise((resolve) => {
    let finished = false;
    const settle = (blob: Blob) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve(blob);
    };

    // Safety net: if decoding/re-encoding stalls (some runtimes use a
    // Promise-based toBlob while others use a callback), upload the original.
    const timer = window.setTimeout(() => settle(file), 6000);

    try {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          if (!width || !height) { settle(file); return; }

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) { settle(file); return; }

          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, 0, 0, width, height);

          const targetType = file.type === 'image/png' || file.type === 'image/gif' ? 'image/png' : 'image/jpeg';
          const targetQuality = targetType === 'image/png' ? 0.9 : quality;

          const complete = (blob: Blob | null) => {
            settle(blob && blob.size > 0 && blob.size < file.size ? blob : file);
          };

          if (typeof (canvas as any).toBlob === 'function') {
            const output = (canvas as any).toBlob(targetType, targetQuality);
            // Modern browsers return a Promise; older runtimes invoke a callback.
            if (output && typeof (output as any).then === 'function') {
              (output as Promise<Blob>).then(complete).catch(() => complete(null));
            } else {
              try {
                (canvas as any).toBlob((blob: Blob | null) => complete(blob), targetType, targetQuality);
              } catch {
                complete(null);
              }
            }
          } else {
            complete(null);
          }
        } catch {
          settle(file);
        }
      };

      img.onerror = () => { settle(file); };

      img.src = url;
    } catch {
      settle(file);
    }
  });
}

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function createCompressedImageFile(blob: Blob, prefix: string, source: File): File {
  const type = blob.type || source.type;
  const extension = IMAGE_EXTENSION_BY_TYPE[type] || 'img';
  return new File([blob], `${prefix}-${Date.now()}.${extension}`, { type });
}

// ============================================================================
// DIRECT UPLOAD (XHR with progress)
// ============================================================================

function directUpload(
  path: string,
  fieldName: string,
  file: File,
  token: string,
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const url = `${API_BASE_URL}${path}`;
    const formData = new FormData();
    formData.append(fieldName, file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          const imageUrl = response?.url || response?.data?.url || '';
          if (imageUrl) {
            resolve({
              url: imageUrl,
              fileId: response?.fileId || response?.file?.id || response?.id,
              user: response?.user,
              profile: response?.profile,
            });
          } else {
            resolve({ url: '', error: 'No URL returned from server' });
          }
        } else {
          const errorMsg = response?.error || response?.message || `Upload failed (${xhr.status})`;
          resolve({ url: '', error: errorMsg });
        }
      } catch {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ url: '', error: 'Invalid response from server' });
        } else {
          resolve({ url: '', error: `Upload failed (${xhr.status})` });
        }
      }
    });

    xhr.addEventListener('error', () => {
      resolve({ url: '', error: 'Network error during upload' });
    });

    xhr.addEventListener('abort', () => {
      resolve({ url: '', error: 'Upload cancelled' });
    });

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Do NOT set Content-Type - browser sets it with boundary for FormData
    xhr.send(formData);
  });
}

// ============================================================================
// UPLOAD FUNCTIONS
// ============================================================================

/**
 * Upload avatar image.
 */
export async function uploadAvatar(
  file: File,
  token: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const validationError = validateFile(file, {
    maxSize: MAX_AVATAR_SIZE,
    allowedTypes: ALLOWED_IMAGE_TYPES,
    fieldName: 'Avatar',
  });
  if (validationError) {
    return { url: '', error: validationError };
  }

  try {
    onProgress?.({ percent: 0, status: 'compressing' });

    const compressed = await compressImage(file, 512, 0.8);
    const compressedFile = createCompressedImageFile(compressed, 'avatar', file);

    onProgress?.({ percent: 30, status: 'uploading' });

    const result = await directUpload(
      '/api/upload/avatar',
      'avatar',
      compressedFile,
      token,
      (percent) => onProgress?.({ percent: 30 + percent * 0.7, status: 'uploading' })
    );

    if (result.url) {
      onProgress?.({ percent: 100, status: 'done' });
    } else {
      onProgress?.({ percent: 0, status: 'error', error: result.error });
    }

    return result;
  } catch (error: any) {
    const errorMsg = error.message || 'Avatar upload failed';
    onProgress?.({ percent: 0, status: 'error', error: errorMsg });
    return { url: '', error: errorMsg };
  }
}

/**
 * Upload banner image.
 */
export async function uploadBanner(
  file: File,
  token: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const validationError = validateFile(file, {
    maxSize: MAX_BANNER_SIZE,
    allowedTypes: ALLOWED_IMAGE_TYPES,
    fieldName: 'Banner',
  });
  if (validationError) {
    return { url: '', error: validationError };
  }

  try {
    onProgress?.({ percent: 0, status: 'compressing' });

    const compressed = await compressImage(file, 2048, 0.85);
    const compressedFile = createCompressedImageFile(compressed, 'banner', file);

    onProgress?.({ percent: 30, status: 'uploading' });

    const result = await directUpload(
      '/api/upload/banner',
      'banner',
      compressedFile,
      token,
      (percent) => onProgress?.({ percent: 30 + percent * 0.7, status: 'uploading' })
    );

    if (result.url) {
      onProgress?.({ percent: 100, status: 'done' });
    } else {
      onProgress?.({ percent: 0, status: 'error', error: result.error });
    }

    return result;
  } catch (error: any) {
    const errorMsg = error.message || 'Banner upload failed';
    onProgress?.({ percent: 0, status: 'error', error: errorMsg });
    return { url: '', error: errorMsg };
  }
}

/**
 * Generic media upload (images or videos).
 */
export async function uploadMedia(
  file: File,
  token: string,
  options: {
    fieldName?: string;
    path?: string;
    category?: string;
    onProgress?: (progress: UploadProgress) => void;
  } = {}
): Promise<UploadResult> {
  const { fieldName = 'file', path = '/api/upload', category = 'generic' } = options;

  // Validate based on type
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const isDocument = !isImage && !isVideo;

  let validationError: string | null = null;
  if (isImage) {
    validationError = validateImageFile(file, fieldName === 'file' ? 'File' : fieldName);
  } else if (isVideo) {
    validationError = validateVideoFile(file, fieldName === 'file' ? 'Video' : fieldName);
  } else {
    validationError = validateDocumentFile(file);
  }

  if (validationError) return { url: '', error: validationError };

  try {
    options.onProgress?.({ percent: 10, status: 'uploading' });

    // Compress images before upload
    let uploadFile = file;
    if (isImage) {
      options.onProgress?.({ percent: 5, status: 'compressing' });
      const compressed = await compressImage(file, 2048, 0.85);
      uploadFile = createCompressedImageFile(compressed, 'media', file);
      options.onProgress?.({ percent: 10, status: 'uploading' });
    }

    // Build form data with category
    const formData = new FormData();
    formData.append(fieldName, uploadFile);
    if (category) formData.append('category', category);

    const result = await new Promise<UploadResult>((resolve) => {
      const url = `${API_BASE_URL}${path}`;
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && options.onProgress) {
          const percent = 10 + Math.round((e.loaded / e.total) * 90);
          options.onProgress({ percent, status: 'uploading' });
        }
      });

      xhr.addEventListener('load', () => {
        try {
          const response = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            const mediaUrl = response?.url || response?.data?.url || '';
            if (mediaUrl) {
              resolve({
                url: mediaUrl,
                fileId: response?.fileId || response?.file?.id || response?.id,
              });
            } else {
              resolve({ url: '', error: 'No URL returned from server' });
            }
          } else {
            resolve({ url: '', error: response?.error || response?.message || `Upload failed (${xhr.status})` });
          }
        } catch {
          resolve({ url: '', error: `Upload failed (${xhr.status})` });
        }
      });

      xhr.addEventListener('error', () => resolve({ url: '', error: 'Network error during upload' }));
      xhr.addEventListener('abort', () => resolve({ url: '', error: 'Upload cancelled' }));

      xhr.open('POST', url);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });

    if (result.url) {
      options.onProgress?.({ percent: 100, status: 'done' });
    } else {
      options.onProgress?.({ percent: 0, status: 'error', error: result.error });
    }

    return result;
  } catch (error: any) {
    const errorMsg = error.message || 'Upload failed';
    options.onProgress?.({ percent: 0, status: 'error', error: errorMsg });
    return { url: '', error: errorMsg };
  }
}

/**
 * Upload a live stream thumbnail.
 */
export async function uploadThumbnail(
  file: File,
  token: string,
  streamId?: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const validationError = validateFile(file, {
    maxSize: MAX_THUMBNAIL_SIZE,
    allowedTypes: ALLOWED_IMAGE_TYPES,
    fieldName: 'Thumbnail',
  });
  if (validationError) return { url: '', error: validationError };

  try {
    onProgress?.({ percent: 10, status: 'uploading' });

    const formData = new FormData();
    formData.append('thumbnail', file);
    if (streamId) formData.append('streamId', streamId);

    const result = await new Promise<UploadResult>((resolve) => {
      const url = `${API_BASE_URL}/api/upload/thumbnail`;
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress({ percent: 10 + Math.round((e.loaded / e.total) * 90), status: 'uploading' });
        }
      });

      xhr.addEventListener('load', () => {
        try {
          const response = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && response?.url) {
            resolve({ url: response.url, fileId: response?.file?.id });
          } else {
            resolve({ url: '', error: response?.error || response?.message || 'Thumbnail upload failed' });
          }
        } catch {
          resolve({ url: '', error: 'Thumbnail upload failed' });
        }
      });

      xhr.addEventListener('error', () => resolve({ url: '', error: 'Network error during upload' }));
      xhr.addEventListener('abort', () => resolve({ url: '', error: 'Upload cancelled' }));

      xhr.open('POST', url);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });

    if (result.url) {
      onProgress?.({ percent: 100, status: 'done' });
    } else {
      onProgress?.({ percent: 0, status: 'error', error: result.error });
    }

    return result;
  } catch (error: any) {
    const errorMsg = error.message || 'Thumbnail upload failed';
    onProgress?.({ percent: 0, status: 'error', error: errorMsg });
    return { url: '', error: errorMsg };
  }
}

// ============================================================================
// BACKWARDS COMPATIBILITY
// ============================================================================

// Validate file before upload (sync check for immediate feedback)
export function validateUploadFile(file: File, type: 'avatar' | 'banner'): string | null {
  const maxSize = type === 'avatar' ? MAX_AVATAR_SIZE : MAX_BANNER_SIZE;
  const fieldName = type === 'avatar' ? 'Avatar' : 'Banner';
  return validateFile(file, { maxSize, allowedTypes: ALLOWED_IMAGE_TYPES, fieldName });
}