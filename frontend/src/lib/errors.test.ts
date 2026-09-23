// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ApiError } from './api';
import { friendlyError, errorMessage } from './errors';

describe('friendlyError', () => {
  it('maps a backend USERNAME_ALREADY_EXISTS code to human copy', () => {
    const error = new ApiError(409, 'That username is already in use. Please choose another one.', {
      error: 'That username is already in use. Please choose another one.',
      code: 'USERNAME_ALREADY_EXISTS',
    });
    const friendly = friendlyError(error, { action: 'create the channel', context: 'channel' });
    expect(friendly.title).toBe('Username unavailable');
    expect(friendly.message).toBe('That username is already in use. Please choose another one.');
    expect(friendly.code).toBe('USERNAME_ALREADY_EXISTS');
  });

  it('maps a NAME_ALREADY_EXISTS code to a context-specific channel message', () => {
    const error = new ApiError(409, 'That channel name is already in use. Please choose another one.', {
      code: 'NAME_ALREADY_EXISTS',
    });
    const friendly = friendlyError(error, { action: 'create the channel', context: 'channel' });
    expect(friendly.message).toContain('channel name is already in use');
  });

  it('maps HTTP 401 to a session-expired message and never exposes token jargon', () => {
    const error = new ApiError(401, 'Session expired or invalid');
    const friendly = friendlyError(error);
    expect(friendly.title).toBe('Session expired');
    expect(friendly.message).toContain('sign in again');
    expect(friendly.message).not.toMatch(/jwt|token|session/i);
  });

  it('maps HTTP 403 to a permission message', () => {
    const friendly = friendlyError(new ApiError(403, 'Forbidden'));
    expect(friendly.message).toContain("don't have permission");
  });

  it('maps a raw Prisma P2002 message to a safe DUPLICATE without leaking the code', () => {
    const error = new ApiError(400, 'P2002 Unique constraint failed on the fields (`handle`)', {
      error: 'P2002 Unique constraint failed on the fields (`handle`)',
    });
    const friendly = friendlyError(error, { action: 'create the channel', context: 'channel' });
    expect(friendly.message).toContain('already in use');
    expect(friendly.message).not.toContain('P2002');
  });

  it('maps network failures to a connect message instead of "Failed to fetch"', () => {
    const friendly = friendlyError(new TypeError('Failed to fetch'));
    expect(friendly.title).toBe("Couldn't connect to VANTA");
    expect(friendly.message).toContain('internet connection');
  });

  it('maps unknown errors to a generic message without exposing internals', () => {
    const friendly = friendlyError(new Error('Cannot read properties of undefined (reading "x")'));
    expect(friendly.message).toMatch(/try again/i);
    expect(friendly.message).not.toContain('undefined');
  });

  it('maps 413 to a file-too-large message', () => {
    const friendly = friendlyError(new ApiError(413, 'File is too large. Please choose a smaller file.'));
    expect(friendly.message).toContain('smaller file');
  });

  it('maps 429 to a rate-limit message', () => {
    const friendly = friendlyError(new ApiError(429, 'Too many requests'));
    expect(friendly.message).toContain('too quickly');
  });

  it('maps a raw ownership/role denial message to a permission message', () => {
    const friendly = friendlyError(new Error('Only channel administrators can edit this channel'));
    expect(friendly.title).toBe('Not allowed');
    expect(friendly.message).toContain("don't have permission");
    expect(friendly.code).toBe('FORBIDDEN');
  });

  it('maps a bare "Unauthorized" service message to a permission message', () => {
    const friendly = friendlyError(new Error('Unauthorized'));
    expect(friendly.code).toBe('FORBIDDEN');
    expect(friendly.message).toContain("don't have permission");
  });

  it('maps a raw session message to a sign-in prompt, not a 404', () => {
    const friendly = friendlyError(new Error('Session not found or unauthorized'));
    expect(friendly.title).toBe('Session expired');
    expect(friendly.message).toContain('sign in again');
    expect(friendly.code).toBe('UNAUTHORIZED');
  });

  it('keeps already-human validation messages from the backend', () => {
    const friendly = friendlyError(new ApiError(400, 'Please give your channel a name.'));
    expect(friendly.message).toBe('Please give your channel a name.');
    expect(errorMessage(friendly)).toBe('Please give your channel a name.');
  });
});