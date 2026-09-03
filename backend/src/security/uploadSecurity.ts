/**
 * Enterprise file upload security for VANTA.
 * Protects against malicious file uploads, path traversal,
 * and stores files securely with randomized names.
 */
import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from './config';
import { auditLog } from './auditLog';

export interface UploadValidationResult {
  valid: boolean;
  error?: string;
  sanitizedFilename?: string;
}

export class UploadSecurity {
  /**
   * Validate a file's MIME type against allowed types
   */
  static validateMimeType(mimeType: string, category: 'image' | 'video' | 'document'): boolean {
    const allowedTypes = {
      image: config.upload.allowedImageTypes,
      video: config.upload.allowedVideoTypes,
      document: config.upload.allowedDocumentTypes,
    };

    return allowedTypes[category].includes(mimeType);
  }

  /**
   * Validate file extension - blocks dangerous extensions
   */
  static validateExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    
    // Check against blocked extensions
    if (config.upload.blockedExtensions.includes(ext)) {
      return false;
    }

    // Block double extensions (e.g., file.php.jpg)
    const nameWithoutExt = path.basename(filename, ext);
    const doubleExt = path.extname(nameWithoutExt).toLowerCase();
    if (doubleExt && config.upload.blockedExtensions.includes(doubleExt)) {
      return false;
    }

    // Only allow known safe extensions
    const safeExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif',
      '.mp4', '.webm', '.mov', '.pdf', '.txt',
      '.svg', '.ico',
    ];

    return safeExtensions.includes(ext);
  }

  /**
   * Validate file size
   */
  static validateFileSize(size: number, category: 'image' | 'video' | 'document'): boolean {
    const maxSizes = {
      image: config.upload.maxImageSize,
      video: config.upload.maxVideoSize,
      document: config.upload.maxFileSize,
    };

    return size <= maxSizes[category];
  }

  /**
   * Generate a secure random filename
   */
  static generateSecureFilename(originalName: string): string {
    const ext = path.extname(originalName).toLowerCase();
    const randomName = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    return `${randomName}-${timestamp}${ext}`;
  }

  /**
   * Comprehensive file validation
   */
  static validateFile(
    file: Express.Multer.File,
    category: 'image' | 'video' | 'document'
  ): UploadValidationResult {
    // Check file exists
    if (!file) {
      return { valid: false, error: 'No file provided' };
    }

    // Validate extension
    if (!this.validateExtension(file.originalname)) {
      return {
        valid: false,
        error: `File extension not allowed: ${path.extname(file.originalname)}`,
      };
    }

    // Validate MIME type
    if (!this.validateMimeType(file.mimetype, category)) {
      return {
        valid: false,
        error: `File type not allowed: ${file.mimetype}`,
      };
    }

    // Validate size
    if (!this.validateFileSize(file.size, category)) {
      const maxSizeMB = {
        image: config.upload.maxImageSize / 1024 / 1024,
        video: config.upload.maxVideoSize / 1024 / 1024,
        document: config.upload.maxFileSize / 1024 / 1024,
      };

      return {
        valid: false,
        error: `File size exceeds maximum allowed (${maxSizeMB[category]}MB)`,
      };
    }

    // Generate secure filename
    const sanitizedFilename = this.generateSecureFilename(file.originalname);

    return { valid: true, sanitizedFilename };
  }

  /**
   * Scan file for malware signature patterns
   * In production, integrate with ClamAV or VirusTotal API
   */
  static async scanForMalware(filePath: string): Promise<{ safe: boolean; threat?: string }> {
    if (!config.upload.virusScanEnabled) {
      return { safe: true };
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const fileContent = buffer.toString('utf-8');

      // Basic signature detection for known malicious patterns
      const malwareSignatures = [
        { pattern: /<?php/i, name: 'PHP code' },
        { pattern: /\/script>/i, name: 'HTML script tag' },
        { pattern: /eval\(/i, name: 'eval() function' },
        { pattern: /base64_decode\(/i, name: 'base64 decode' },
        { pattern: /system\(/i, name: 'system() call' },
        { pattern: /exec\(/i, name: 'exec() call' },
        { pattern: /passthru\(/i, name: 'passthru() call' },
        { pattern: /shell_exec\(/i, name: 'shell_exec() call' },
        { pattern: /wscript\.shell/i, name: 'Windows Script Host' },
        { pattern: /CreateObject\(/i, name: 'ActiveX Object' },
      ];

      // Only scan text-based files for code injection
      const textMimeTypes = [
        'text/plain', 'text/html', 'application/pdf',
        'image/svg+xml',
      ];

      if (textMimeTypes.some(m => m === config.upload.allowedImageTypes[0])) {
        for (const sig of malwareSignatures) {
          if (sig.pattern.test(fileContent)) {
            // Remove the infected file
            fs.unlinkSync(filePath);

            return {
              safe: false,
              threat: `Potential malware detected: ${sig.name}`,
            };
          }
        }
      }

      // Check for executable magic bytes in non-executable files
      const executableMagicBytes = [
        { bytes: Buffer.from([0x4D, 0x5A]), name: 'Windows PE (EXE)' },        // MZ
        { bytes: Buffer.from([0x7F, 0x45, 0x4C, 0x46]), name: 'ELF binary' },  // ELF
        { bytes: Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]), name: 'Java class' },  // CAFEBABE
        { bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]), name: 'PDF' },         // %PDF (only safe for PDF)
      ];

      for (const sig of executableMagicBytes) {
        if (buffer.slice(0, sig.bytes.length).equals(sig.bytes)) {
          // Check if it's actually a PDF and we allow PDFs
          if (sig.name === 'PDF' && filePath.endsWith('.pdf')) {
            continue;
          }

          fs.unlinkSync(filePath);
          return {
            safe: false,
            threat: `Executable file detected: ${sig.name}`,
          };
        }
      }

      return { safe: true };
    } catch (error) {
      console.error('[UPLOAD SECURITY] Malware scan error:', error);
      return { safe: false, threat: 'Malware scan failed' };
    }
  }

  /**
   * Express middleware for upload validation
   */
  static middleware(category: 'image' | 'video' | 'document') {
    return (req: Request, res: Response, next: NextFunction): void => {
      const file = (req as any).file || (req as any).files?.[0];
      
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const validation = UploadSecurity.validateFile(file, category);
      
      if (!validation.valid) {
        // Remove the uploaded file
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }

        auditLog.log({
          userId: (req as any).user?.userId,
          action: 'UPLOAD_REJECTED',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: {
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            reason: validation.error,
          },
          severity: 'WARNING',
        });

        res.status(400).json({ error: validation.error });
        return;
      }

      // Replace filename with sanitized version
      file.filename = validation.sanitizedFilename;
      file.originalname = validation.sanitizedFilename;

      // Set the path to use the sanitized filename
      if (file.path) {
        const dir = path.dirname(file.path);
        const newPath = path.join(dir, validation.sanitizedFilename!);
        
        try {
          fs.renameSync(file.path, newPath);
          file.path = newPath;
          file.destination = dir;
        } catch (error) {
          // If rename fails, continue with original path
          console.error('[UPLOAD] Failed to rename file:', error);
        }
      }

      auditLog.log({
        userId: (req as any).user?.userId,
        action: 'UPLOAD_ACCEPTED',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: {
          originalFilename: file.originalname,
          sanitizedFilename: validation.sanitizedFilename,
          mimeType: file.mimetype,
          size: file.size,
          category,
        },
      });

      next();
    };
  }
}