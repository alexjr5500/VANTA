/**
 * DevSecOps integration for VANTA.
 * Security headers, dependency scanning, static analysis, and CI/CD checks.
 */
import { config } from './config';
import fs from 'fs';
import path from 'path';

export class DevSecOps {
  /**
   * Generate security headers report
   */
  static getSecurityHeadersChecklist(): Record<string, string> {
    return {
      'Strict-Transport-Security': `max-age=${config.hsts.maxAge}; includeSubDomains; preload`,
      'Content-Security-Policy': this.buildCSPString(),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
  }

  private static buildCSPString(): string {
    const csp = config.csp;
    const directives: string[] = [];
    
    const addDirective = (name: string, sources: string[]) => {
      if (sources.length > 0) {
        directives.push(`${name} ${sources.join(' ')}`);
      }
    };

    addDirective('default-src', csp.defaultSrc);
    addDirective('script-src', csp.scriptSrc);
    addDirective('style-src', csp.styleSrc);
    addDirective('img-src', csp.imgSrc);
    addDirective('connect-src', csp.connectSrc);
    addDirective('font-src', csp.fontSrc);
    addDirective('frame-src', csp.frameSrc);
    addDirective('media-src', csp.mediaSrc);
    addDirective('worker-src', csp.workerSrc);

    return directives.join('; ');
  }

  /**
   * Check for exposed secrets in source code
   */
  static scanForSecrets(filePath: string): string[] {
    const found: string[] = [];
    if (!fs.existsSync(filePath)) return found;

    const content = fs.readFileSync(filePath, 'utf-8');
    const patterns = [
      { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][^"']+["']/gi, name: 'API Key' },
      { regex: /(?:secret|password|passwd|pwd)\s*[:=]\s*["'][^"']+["']/gi, name: 'Secret/Password' },
      { regex: /(?:token|auth[_-]?token)\s*[:=]\s*["'][^"']+["']/gi, name: 'Token' },
      { regex: /(?:sk_live|pk_live)_[a-zA-Z0-9]+/g, name: 'Stripe Live Key' },
      { regex: /(?:xox[baprs]-)[a-zA-Z0-9-]+/g, name: 'Slack Token' },
      { regex: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key' },
      { regex: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}/g, name: 'GitHub Token' },
    ];

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          found.push(`Line ${i + 1}: Possible ${pattern.name} exposed`);
        }
      }
    }

    return found;
  }

  /**
   * Check package.json for known vulnerable dependency patterns
   */
  static checkDependencySecurity(packageJsonPath: string): string[] {
    const warnings: string[] = [];
    if (!fs.existsSync(packageJsonPath)) return warnings;

    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Check for deprecated/unmaintained packages
      const deprecatedPackages: Record<string, string> = {
        'request': 'Deprecated - use node-fetch or axios',
        'superagent': 'Consider migrating to fetch API',
        'moment': 'Consider using date-fns or dayjs (smaller, tree-shakeable)',
        'bcrypt': 'Use bcryptjs for pure JS or argon2 for modern hashing',
        'jsonwebtoken': 'Consider jose for newer JWT implementation',
        'helmet': 'Update to latest version for CSP improvements',
      };

      for (const [dep, reason] of Object.entries(deprecatedPackages)) {
        if (allDeps[dep]) {
          warnings.push(`${dep}: ${reason}`);
        }
      }

      // Check for missing security packages
      const recommendedPackages: Record<string, string> = {
        'helmet': 'Security headers - already included',
        'express-rate-limit': 'Rate limiting',
        'cors': 'CORS configuration - already included',
        'express-validator': 'Input validation',
        'argon2': 'Modern password hashing',
      };
    } catch {
      warnings.push('Could not parse package.json');
    }

    return warnings;
  }
}