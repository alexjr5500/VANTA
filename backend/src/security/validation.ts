/**
 * Enterprise validation and sanitization utilities for VANTA.
 * Protects against injection attacks, XSS, and malformed input.
 */
export class SecurityValidator {
  private static readonly emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  private static readonly usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  private static readonly fullNameRegex = /^[a-zA-ZÀ-ÿ' -]{2,100}$/;
  private static readonly hexColorRegex = /^#[0-9a-fA-F]{6}$/;
  private static readonly urlRegex = /^https?:\/\/.+/i;
  
  /** HTML tags to strip for XSS prevention */
  private static readonly XSS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
    /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
    /javascript:/gi,
    /on\w+=/gi,
    /data:text\/html/gi,
    /vbscript:/gi,
  ];

  /**
   * Validate email format
   */
  static isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    if (email.length > 254) return false; // RFC 5321
    return this.emailRegex.test(email);
  }

  /**
   * Validate username
   */
  static isValidUsername(username: string): boolean {
    if (!username || typeof username !== 'string') return false;
    return this.usernameRegex.test(username);
  }

  /**
   * Validate password strength
   */
  static isStrongPassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!password || password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    if (password.length > 128) {
      errors.push('Password must not exceed 128 characters');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    // Check for common patterns
    if (/(.)\1{2,}/.test(password)) {
      errors.push('Password must not contain repeated characters (3+)');
    }
    if (/^(password|admin|12345|qwerty|letmein)/i.test(password)) {
      errors.push('Password contains common patterns');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate full name
   */
  static isValidFullName(name: string): boolean {
    if (!name) return true; // optional field
    return this.fullNameRegex.test(name);
  }

  /**
   * Sanitize text content against XSS
   */
  static sanitizeText(input: string | null | undefined): string {
    if (!input) return '';
    
    let sanitized = String(input);
    
    // Strip XSS patterns
    for (const pattern of this.XSS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }
    
    // Encode HTML entities
    sanitized = sanitized
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
    
    // Strip control characters (except newlines and tabs)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    return sanitized.trim();
  }

  /**
   * Sanitize for display (allows some safe HTML tags)
   */
  static sanitizeForDisplay(input: string | null | undefined): string {
    if (!input) return '';
    
    let sanitized = String(input);
    
    // Strip dangerous tags entirely
    for (const pattern of this.XSS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }
    
    // Strip event handlers
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*\S+/gi, '');
    
    // Strip javascript: URLs
    sanitized = sanitized.replace(/href=["']javascript:/gi, 'href="#"');
    sanitized = sanitized.replace(/src=["']javascript:/gi, 'src=""');
    
    return sanitized.trim();
  }

  /**
   * Sanitize a URL
   */
  static sanitizeUrl(url: string | null | undefined): string {
    if (!url) return '';
    
    const sanitized = String(url).trim();
    
    // Block dangerous protocols
    if (/^(javascript|data|vbscript|file):/i.test(sanitized)) {
      return '';
    }
    
    // Only allow http and https
    if (!/^https?:\/\//i.test(sanitized)) {
      return '';
    }
    
    return sanitized;
  }

  /**
   * Validate and sanitize a phone number
   */
  static sanitizePhoneNumber(phone: string | null | undefined): string {
    if (!phone) return '';
    return String(phone).replace(/[^\d+]/g, '');
  }

  /**
   * Sanitize a JSON object recursively
   */
  static sanitizeObject<T extends Record<string, any>>(obj: T): T {
    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeText(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeObject(value);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'string' ? this.sanitizeText(item) :
          typeof item === 'object' && item !== null ? this.sanitizeObject(item) :
          item
        );
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  /**
   * Validate content length
   */
  static validateContentLength(content: string, maxLength: number): boolean {
    return content.length <= maxLength;
  }

  /**
   * Check if input contains SQL injection patterns
   */
  static hasSQLInjection(input: string): boolean {
    const sqlPatterns = [
      /(\bSELECT\b.*\bFROM\b)/i,
      /(\bDROP\b.*\bTABLE\b)/i,
      /(\bDELETE\b.*\bFROM\b)/i,
      /(\bINSERT\b.*\bINTO\b)/i,
      /(\bUPDATE\b.*\bSET\b)/i,
      /(\bALTER\b.*\bTABLE\b)/i,
      /(\bCREATE\b.*\bTABLE\b)/i,
      /(\bUNION\b.*\bSELECT\b)/i,
      /(\bOR\b.*\b1\s*=\s*1)/i,
      /('.*--)/,
      /('.*#)/,
      /(\bEXEC\b)/i,
      /(\bEXECUTE\b)/i,
    ];
    
    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Check for NoSQL injection patterns
   */
  static hasNoSQLInjection(input: string): boolean {
    const nosqlPatterns = [
      /\$where/,
      /\$ne/,
      /\$gt/,
      /\$regex/,
      /\$exists/,
      /\$mod/,
      /\$where/,
      /\$expr/,
      /\$jsonSchema/,
    ];
    
    return nosqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Comprehensive input validation for security
   */
  static isInputSafe(input: string): boolean {
    if (this.hasSQLInjection(input)) return false;
    if (this.hasNoSQLInjection(input)) return false;
    return true;
  }
}

/**
 * Express middleware for request validation
 */
import { Request, Response, NextFunction } from 'express';

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'email' | 'url' | 'phone' | 'password';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  sanitize?: boolean;
}

export function validateRequest(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];
    const body = req.body || {};

    for (const rule of rules) {
      const value = body[rule.field];
      
      // Check required
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`${rule.field} is required`);
        continue;
      }
      
      // Skip if not required and empty
      if (!rule.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type-specific validation
      switch (rule.type) {
        case 'email':
          if (!SecurityValidator.isValidEmail(value)) {
            errors.push(`Invalid email format for ${rule.field}`);
          }
          break;
          
        case 'password':
          if (rule.minLength || rule.maxLength) {
            const passValidation = SecurityValidator.isStrongPassword(value);
            if (!passValidation.valid) {
              errors.push(...passValidation.errors);
            }
          }
          break;
          
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`${rule.field} must be a string`);
          } else {
            if (rule.minLength && value.length < rule.minLength) {
              errors.push(`${rule.field} must be at least ${rule.minLength} characters`);
            }
            if (rule.maxLength && value.length > rule.maxLength) {
              errors.push(`${rule.field} must not exceed ${rule.maxLength} characters`);
            }
          }
          break;
          
        case 'number':
          if (typeof value !== 'number' || isNaN(value)) {
            errors.push(`${rule.field} must be a number`);
          } else {
            if (rule.min !== undefined && value < rule.min) {
              errors.push(`${rule.field} must be at least ${rule.min}`);
            }
            if (rule.max !== undefined && value > rule.max) {
              errors.push(`${rule.field} must not exceed ${rule.max}`);
            }
          }
          break;
      }

      // Sanitize if needed
      if (rule.sanitize && typeof value === 'string' && errors.length === 0) {
        body[rule.field] = SecurityValidator.sanitizeText(value);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
      return;
    }

    next();
  };
}