import { describe, expect, test } from "@jest/globals";
import multer from "multer";
import { AppError, normalizeError, conflict, forbidden, notFound } from "../utils/api-error";

describe("normalizeError", () => {
  test("passes AppError through unchanged", () => {
    const error = conflict("USERNAME_ALREADY_EXISTS", "That username is already in use. Please choose another one.");
    expect(normalizeError(error)).toEqual({
      statusCode: 409,
      code: "USERNAME_ALREADY_EXISTS",
      message: "That username is already in use. Please choose another one.",
    });
  });

  test("maps Prisma P2002 unique constraint to a human 409 (never exposes the code)", () => {
    const error = Object.assign(new Error("Unique constraint failed on the fields (`handle`)"), { code: "P2002" });
    const normalized = normalizeError(error);
    expect(normalized.statusCode).toBe(409);
    expect(normalized.code).toBe("DUPLICATE");
    expect(normalized.message).toMatch(/already in use/i);
    expect(normalized.message).not.toContain("P2002");
  });

  test("maps Prisma P2025 record not found to a safe 404", () => {
    const error = Object.assign(new Error("Record to update not found."), { code: "P2025" });
    const normalized = normalizeError(error);
    expect(normalized.statusCode).toBe(404);
    expect(normalized.code).toBe("NOT_FOUND");
  });

  test("maps known service conflicts to 409 with a contextual message", () => {
    expect(normalizeError(new Error("Channel name already exists")).statusCode).toBe(409);
    expect(normalizeError(new Error("Group name already exists")).code).toBe("NAME_ALREADY_EXISTS");
    expect(normalizeError(new Error("Email or username already exists")).code).toBe("EMAIL_ALREADY_EXISTS");
  });

  test("maps not-found / permission messages to 404 / 403", () => {
    expect(normalizeError(new Error("Channel not found")).statusCode).toBe(404);
    expect(normalizeError(new Error("Only channel administrators can do that")).statusCode).toBe(403);
    expect(normalizeError(new Error("Only the group owner can manage administrators")).code).toBe("FORBIDDEN");
    expect(normalizeError(new Error("Only group administrators can edit this group")).statusCode).toBe(403);
    expect(normalizeError(new Error("You do not have permission to pin messages")).statusCode).toBe(403);
  });

  test("maps a bare \"Unauthorized\" service message to a permission 403", () => {
    const normalized = normalizeError(new Error("Unauthorized"));
    expect(normalized.statusCode).toBe(403);
    expect(normalized.code).toBe("FORBIDDEN");
  });

  test("maps session problems to a 401 instead of a 404/500", () => {
    const normalized = normalizeError(new Error("Session not found or unauthorized"));
    expect(normalized.statusCode).toBe(401);
    expect(normalized.code).toBe("UNAUTHORIZED");
  });

  test("does not treat non-permission \"Only\" statements as a 403", () => {
    expect(normalizeError(new Error("Only pending withdrawals can be processed")).statusCode).not.toBe(403);
    expect(normalizeError(new Error("Only successful transactions can be refunded")).code).not.toBe("FORBIDDEN");
  });

  test("maps Multer too-large files to 413 with a human message", () => {
    const error = new multer.MulterError("LIMIT_FILE_SIZE", "file");
    const normalized = normalizeError(error);
    expect(normalized.statusCode).toBe(413);
    expect(normalized.code).toBe("UPLOAD_FILE_TOO_LARGE");
    expect(normalized.message).toMatch(/smaller file/i);
  });

  test("falls back to a generic 500 for unknown errors without leaking internals", () => {
    const normalized = normalizeError(new Error("Cannot read properties of undefined (reading 'x')"));
    expect(normalized.statusCode).toBe(500);
    expect(normalized.code).toBe("INTERNAL_ERROR");
    expect(normalized.message).toMatch(/something went wrong/i);
    expect(normalized.message).not.toContain("undefined");
  });

  test("AppError factories carry correct status codes", () => {
    expect(forbidden().statusCode).toBe(403);
    expect(notFound("NOT_FOUND", "missing").statusCode).toBe(404);
    expect(new AppError(429, "RATE_LIMITED", "Slow down").statusCode).toBe(429);
  });
});