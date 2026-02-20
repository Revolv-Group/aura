/**
 * Authentication & Security Middleware
 *
 * This module provides:
 * - Password hashing with bcrypt
 * - Session-based authentication with single-session enforcement
 * - Route protection middleware
 * - Audit logging for security events
 * - Account lockout after failed attempts
 * - 2FA/TOTP authentication
 * - Device/IP tracking and new device alerts
 */

import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { TOTP, generateSecret, generateURI, verifySync } from "otplib";

// Compatibility shim for otplib v5+ (no more `authenticator` export)
const authenticator = {
  generateSecret: () => generateSecret(),
  keyuri: (account: string, issuer: string, secret: string) =>
    generateURI({ type: "totp", account, issuer, secret }),
  verify: ({ token, secret }: { token: string; secret: string }) =>
    verifySync({ otp: token, secret }),
};
import * as QRCode from "qrcode";
import { db } from "../db";
import { users, auditLogs, sessions, TrustedDevice } from "@shared/schema";
import { eq, sql, ne } from "drizzle-orm";
import { logger } from "./logger";

// Constants
const BCRYPT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD_MAX_AGE_DAYS = 90; // Warn after 90 days
const TOTP_ISSUER = "SB-OS";
const BACKUP_CODE_COUNT = 10;

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      isAuthenticated?: boolean;
    }
  }
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Get client IP address from request
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(
  userId: string | null,
  action: string,
  req: Request,
  details?: Record<string, unknown>,
  resource?: string,
  resourceId?: string,
  status: "success" | "failure" | "blocked" = "success"
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      resource,
      resourceId,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || null,
      details,
      status,
    });
  } catch (error) {
    logger.error({ error }, "Failed to create audit log");
  }
}

/**
 * Check if user account is locked
 */
async function isAccountLocked(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.id, userId));

  if (!user?.lockedUntil) return false;
  return new Date(user.lockedUntil) > new Date();
}

/**
 * Update failed login attempts
 */
async function updateFailedAttempts(userId: string, increment: boolean): Promise<void> {
  if (increment) {
    const [user] = await db
      .select({ failedLoginAttempts: users.failedLoginAttempts })
      .from(users)
      .where(eq(users.id, userId));

    const attempts = (user?.failedLoginAttempts || 0) + 1;
    const updates: Record<string, unknown> = { failedLoginAttempts: attempts };

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      updates.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    }

    await db.update(users).set(updates).where(eq(users.id, userId));
  } else {
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, userId));
  }
}

/**
 * Invalidate all other sessions for a user (single active session enforcement)
 */
export async function invalidateOtherSessions(userId: string, currentSessionId?: string): Promise<number> {
  try {
    // Delete all sessions for this user except the current one
    // Sessions table stores userId in the sess JSONB column
    const result = await db.execute(sql`
      DELETE FROM sessions
      WHERE (sess->>'userId')::text = ${userId}
      ${currentSessionId ? sql`AND sid != ${currentSessionId}` : sql``}
    `);

    const deletedCount = (result as any).rowCount || 0;
    if (deletedCount > 0) {
      logger.info({ userId, deletedCount }, "Invalidated other sessions for single-session enforcement");
    }
    return deletedCount;
  } catch (error) {
    logger.error({ error, userId }, "Failed to invalidate other sessions");
    return 0;
  }
}

/**
 * Check if this is a new device/IP and log accordingly
 */
export async function checkNewDevice(
  userId: string,
  req: Request
): Promise<{ isNewDevice: boolean; isNewIp: boolean; deviceFingerprint: string }> {
  const currentIp = getClientIp(req);
  const currentUserAgent = req.headers["user-agent"] || "unknown";
  const deviceFingerprint = crypto
    .createHash("sha256")
    .update(`${currentIp}:${currentUserAgent}`)
    .digest("hex")
    .substring(0, 16);

  try {
    const [user] = await db
      .select({
        lastKnownIp: users.lastKnownIp,
        lastKnownUserAgent: users.lastKnownUserAgent,
        trustedDevices: users.trustedDevices,
      })
      .from(users)
      .where(eq(users.id, userId));

    const isNewIp = user?.lastKnownIp !== currentIp;
    const isNewUserAgent = user?.lastKnownUserAgent !== currentUserAgent;
    const trustedDevices = user?.trustedDevices || [];

    // Check if this device fingerprint is in trusted devices
    const isTrustedDevice = trustedDevices.some(d =>
      d.id === deviceFingerprint || (d.ipAddress === currentIp && d.userAgent === currentUserAgent)
    );

    const isNewDevice = !isTrustedDevice && (isNewIp || isNewUserAgent);

    // Update last known IP/UA
    await db
      .update(users)
      .set({
        lastKnownIp: currentIp,
        lastKnownUserAgent: currentUserAgent,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { isNewDevice, isNewIp, deviceFingerprint };
  } catch (error) {
    logger.error({ error, userId }, "Failed to check device");
    return { isNewDevice: true, isNewIp: true, deviceFingerprint };
  }
}

/**
 * Check if password is aging and should be changed
 */
export async function checkPasswordAge(userId: string): Promise<{ shouldWarn: boolean; daysSinceChange: number }> {
  try {
    const [user] = await db
      .select({ passwordChangedAt: users.passwordChangedAt })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.passwordChangedAt) {
      return { shouldWarn: true, daysSinceChange: PASSWORD_MAX_AGE_DAYS + 1 };
    }

    const daysSinceChange = Math.floor(
      (Date.now() - new Date(user.passwordChangedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      shouldWarn: daysSinceChange >= PASSWORD_MAX_AGE_DAYS,
      daysSinceChange,
    };
  } catch (error) {
    logger.error({ error, userId }, "Failed to check password age");
    return { shouldWarn: false, daysSinceChange: 0 };
  }
}

/**
 * Authenticate user with email and password
 */
export async function authenticateUser(
  email: string,
  password: string,
  req: Request
): Promise<{
  success: boolean;
  userId?: string;
  error?: string;
  requiresTwoFactor?: boolean;
  isNewDevice?: boolean;
  isNewIp?: boolean;
  passwordAgeWarning?: boolean;
  daysSincePasswordChange?: number;
}> {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (!user) {
      await createAuditLog(null, "login_attempt", req, { email, reason: "user_not_found" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid credentials" };
    }

    // Check if account is locked
    if (await isAccountLocked(user.id)) {
      await createAuditLog(user.id, "login_blocked", req, { reason: "account_locked" }, "auth", undefined, "blocked");
      return { success: false, error: "Account temporarily locked. Please try again later." };
    }

    // Check if password is set
    if (!user.passwordHash) {
      // First-time setup: password not yet configured
      await createAuditLog(user.id, "login_attempt", req, { reason: "no_password_set" }, "auth", undefined, "failure");
      return { success: false, error: "Password not configured. Please set up your account." };
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);

    if (!isValid) {
      await updateFailedAttempts(user.id, true);
      await createAuditLog(user.id, "login_failed", req, { reason: "invalid_password" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid credentials" };
    }

    // Check device/IP for new device detection
    const { isNewDevice, isNewIp, deviceFingerprint } = await checkNewDevice(user.id, req);

    // Check password age
    const { shouldWarn: passwordAgeWarning, daysSinceChange } = await checkPasswordAge(user.id);

    // Check if 2FA is enabled
    if (user.totpEnabled) {
      // Don't complete login yet - require 2FA
      await createAuditLog(user.id, "login_2fa_required", req, {
        isNewDevice,
        isNewIp,
        deviceFingerprint
      }, "auth");

      return {
        success: false,
        userId: user.id,
        requiresTwoFactor: true,
        isNewDevice,
        isNewIp,
      };
    }

    // Success - reset failed attempts and update last login
    await updateFailedAttempts(user.id, false);
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    // Log with enhanced details
    await createAuditLog(user.id, "login_success", req, {
      isNewDevice,
      isNewIp,
      deviceFingerprint,
      twoFactorUsed: false,
    }, "auth");

    // If new device, also create a specific alert
    if (isNewDevice) {
      await createAuditLog(user.id, "new_device_login", req, {
        deviceFingerprint,
        userAgent: req.headers["user-agent"],
      }, "auth", undefined, "success");
    }

    return {
      success: true,
      userId: user.id,
      isNewDevice,
      isNewIp,
      passwordAgeWarning,
      daysSincePasswordChange: daysSinceChange,
    };
  } catch (error) {
    logger.error({ error }, "Authentication error");
    return { success: false, error: "Authentication failed" };
  }
}

/**
 * Set or update user password
 */
export async function setUserPassword(
  userId: string,
  newPassword: string,
  req: Request
): Promise<{ success: boolean; error?: string }> {
  try {
    // Password strength validation
    if (newPassword.length < 12) {
      return { success: false, error: "Password must be at least 12 characters" };
    }

    if (!/[A-Z]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one uppercase letter" };
    }

    if (!/[a-z]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one lowercase letter" };
    }

    if (!/[0-9]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one number" };
    }

    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one special character" };
    }

    const hash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({
        passwordHash: hash,
        passwordChangedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await createAuditLog(userId, "password_change", req, {}, "auth");

    return { success: true };
  } catch (error) {
    logger.error({ error }, "Error setting password");
    return { success: false, error: "Failed to update password" };
  }
}

/**
 * Check if authentication is required based on environment
 */
export function isAuthRequired(): boolean {
  // Allow explicitly disabling auth with REQUIRE_AUTH=false (even in production)
  if (process.env.REQUIRE_AUTH === "false") {
    return false;
  }
  // Auth is required in production or when explicitly enabled
  return process.env.NODE_ENV === "production" ||
         process.env.REQUIRE_AUTH === "true";
}

/**
 * Check if password has been set for the default user
 */
export async function isPasswordConfigured(): Promise<boolean> {
  try {
    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, DEFAULT_USER_ID));

    return !!user?.passwordHash;
  } catch {
    return false;
  }
}

/**
 * Authentication middleware - protects routes that require authentication
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth check if not required
  if (!isAuthRequired()) {
    req.userId = DEFAULT_USER_ID;
    req.isAuthenticated = true;
    return next();
  }

  // Check session
  const session = req.session as any;

  if (!session?.userId) {
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }

  req.userId = session.userId;
  req.isAuthenticated = true;
  next();
}

/**
 * Middleware to check if this is the initial setup (no password configured)
 */
export async function checkInitialSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isAuthRequired()) {
    return next();
  }

  const configured = await isPasswordConfigured();

  if (!configured && !req.path.includes("/auth/setup")) {
    // Allow setup endpoints even without auth
    if (req.path.includes("/auth/")) {
      return next();
    }
    res.status(403).json({
      error: "Initial setup required",
      code: "SETUP_REQUIRED",
      message: "Please configure your password to secure your account"
    });
    return;
  }

  next();
}

/**
 * Log out user and destroy session
 */
export async function logoutUser(req: Request): Promise<void> {
  const session = req.session as any;
  const userId = session?.userId;

  if (userId) {
    await createAuditLog(userId, "logout", req, {}, "auth");
  }

  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) {
        logger.error({ error: err }, "Error destroying session");
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// ============================================================================
// 2FA/TOTP FUNCTIONS
// ============================================================================

/**
 * Generate TOTP secret and QR code for setup
 */
export async function setupTwoFactor(
  userId: string,
  req: Request
): Promise<{ success: boolean; secret?: string; qrCode?: string; backupCodes?: string[]; recoveryKey?: string; error?: string }> {
  try {
    const [user] = await db
      .select({ email: users.email, totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return { success: false, error: "User not found" };
    }

    if (user.totpEnabled) {
      return { success: false, error: "2FA is already enabled. Disable it first to reconfigure." };
    }

    // Generate secret
    const secret = authenticator.generateSecret();

    // Generate QR code
    const otpauth = authenticator.keyuri(user.email || "user", TOTP_ISSUER, secret);
    const qrCode = await QRCode.toDataURL(otpauth);

    // Generate backup codes
    const backupCodes: string[] = [];
    const hashedBackupCodes: string[] = [];

    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      backupCodes.push(code);
      hashedBackupCodes.push(await bcrypt.hash(code, 10));
    }

    // Generate emergency recovery key (32 bytes = 64 hex chars)
    // Format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX for readability
    const recoveryKeyRaw = crypto.randomBytes(32).toString("hex").toUpperCase();
    const recoveryKey = recoveryKeyRaw.match(/.{1,4}/g)!.join("-");
    const recoveryKeyHash = await bcrypt.hash(recoveryKeyRaw, 12);

    // Store secret temporarily (not enabled until verified)
    await db
      .update(users)
      .set({
        totpSecret: secret, // In production, encrypt this
        totpBackupCodes: hashedBackupCodes,
        totpRecoveryKeyHash: recoveryKeyHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await createAuditLog(userId, "2fa_setup_initiated", req, {}, "auth");

    return {
      success: true,
      secret,
      qrCode,
      backupCodes, // Show these once, user must save them
      recoveryKey, // CRITICAL: Show once, user MUST store securely
    };
  } catch (error) {
    logger.error({ error, userId }, "Failed to setup 2FA");
    return { success: false, error: "Failed to setup two-factor authentication" };
  }
}

/**
 * Verify TOTP code and enable 2FA
 */
export async function verifyAndEnableTwoFactor(
  userId: string,
  token: string,
  req: Request
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user] = await db
      .select({ totpSecret: users.totpSecret, totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.totpSecret) {
      return { success: false, error: "2FA setup not initiated. Please start setup first." };
    }

    if (user.totpEnabled) {
      return { success: false, error: "2FA is already enabled." };
    }

    // Verify the token
    const isValid = authenticator.verify({ token, secret: user.totpSecret });

    if (!isValid) {
      await createAuditLog(userId, "2fa_verification_failed", req, { reason: "invalid_token" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid verification code. Please try again." };
    }

    // Enable 2FA
    await db
      .update(users)
      .set({
        totpEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await createAuditLog(userId, "2fa_enabled", req, {}, "auth");

    return { success: true };
  } catch (error) {
    logger.error({ error, userId }, "Failed to verify 2FA");
    return { success: false, error: "Failed to verify two-factor authentication" };
  }
}

/**
 * Verify TOTP code during login
 */
export async function verifyTwoFactorLogin(
  userId: string,
  token: string,
  req: Request
): Promise<{ success: boolean; error?: string; usedBackupCode?: boolean }> {
  try {
    const [user] = await db
      .select({
        totpSecret: users.totpSecret,
        totpEnabled: users.totpEnabled,
        totpBackupCodes: users.totpBackupCodes,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.totpEnabled || !user.totpSecret) {
      return { success: false, error: "2FA is not enabled for this account." };
    }

    // First try TOTP code
    const isValidTotp = authenticator.verify({ token, secret: user.totpSecret });

    if (isValidTotp) {
      await createAuditLog(userId, "2fa_login_success", req, { method: "totp" }, "auth");
      return { success: true, usedBackupCode: false };
    }

    // Try backup codes
    const backupCodes = user.totpBackupCodes || [];
    for (let i = 0; i < backupCodes.length; i++) {
      const isValidBackup = await bcrypt.compare(token.toUpperCase(), backupCodes[i]);
      if (isValidBackup) {
        // Remove used backup code
        const updatedCodes = [...backupCodes];
        updatedCodes.splice(i, 1);

        await db
          .update(users)
          .set({
            totpBackupCodes: updatedCodes,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        await createAuditLog(userId, "2fa_login_success", req, {
          method: "backup_code",
          remainingBackupCodes: updatedCodes.length,
        }, "auth");

        return { success: true, usedBackupCode: true };
      }
    }

    await createAuditLog(userId, "2fa_login_failed", req, { reason: "invalid_code" }, "auth", undefined, "failure");
    return { success: false, error: "Invalid verification code." };
  } catch (error) {
    logger.error({ error, userId }, "Failed to verify 2FA login");
    return { success: false, error: "Failed to verify two-factor authentication" };
  }
}

/**
 * Disable 2FA (requires current password)
 */
export async function disableTwoFactor(
  userId: string,
  password: string,
  req: Request
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user] = await db
      .select({ passwordHash: users.passwordHash, totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return { success: false, error: "User not found" };
    }

    if (!user.totpEnabled) {
      return { success: false, error: "2FA is not enabled." };
    }

    // Verify password before disabling
    if (!user.passwordHash) {
      return { success: false, error: "Password not configured." };
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      await createAuditLog(userId, "2fa_disable_failed", req, { reason: "invalid_password" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid password." };
    }

    // Disable 2FA
    await db
      .update(users)
      .set({
        totpSecret: null,
        totpEnabled: false,
        totpBackupCodes: null,
        totpRecoveryKeyHash: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await createAuditLog(userId, "2fa_disabled", req, {}, "auth");

    return { success: true };
  } catch (error) {
    logger.error({ error, userId }, "Failed to disable 2FA");
    return { success: false, error: "Failed to disable two-factor authentication" };
  }
}

/**
 * Emergency recovery - disable 2FA using recovery key
 * Use when all backup codes are lost and authenticator is unavailable
 */
export async function emergencyRecovery(
  email: string,
  password: string,
  recoveryKey: string,
  req: Request
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        totpEnabled: users.totpEnabled,
        totpRecoveryKeyHash: users.totpRecoveryKeyHash,
      })
      .from(users)
      .where(eq(users.email, email));

    if (!user) {
      await createAuditLog(null, "emergency_recovery_failed", req, { email, reason: "user_not_found" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid credentials or recovery key." };
    }

    if (!user.totpEnabled) {
      return { success: false, error: "2FA is not enabled on this account." };
    }

    if (!user.totpRecoveryKeyHash) {
      await createAuditLog(user.id, "emergency_recovery_failed", req, { reason: "no_recovery_key" }, "auth", undefined, "failure");
      return { success: false, error: "No recovery key configured for this account." };
    }

    // Verify password first
    if (!user.passwordHash) {
      return { success: false, error: "Password not configured." };
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      await createAuditLog(user.id, "emergency_recovery_failed", req, { reason: "invalid_password" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid credentials or recovery key." };
    }

    // Verify recovery key (remove dashes for comparison)
    const recoveryKeyRaw = recoveryKey.replace(/-/g, "").toUpperCase();
    const isRecoveryKeyValid = await bcrypt.compare(recoveryKeyRaw, user.totpRecoveryKeyHash);

    if (!isRecoveryKeyValid) {
      await createAuditLog(user.id, "emergency_recovery_failed", req, { reason: "invalid_recovery_key" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid credentials or recovery key." };
    }

    // Disable 2FA completely
    await db
      .update(users)
      .set({
        totpSecret: null,
        totpEnabled: false,
        totpBackupCodes: null,
        totpRecoveryKeyHash: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await createAuditLog(user.id, "emergency_recovery_success", req, {}, "auth");

    return { success: true };
  } catch (error) {
    logger.error({ error }, "Emergency recovery failed");
    return { success: false, error: "Recovery failed. Please contact support." };
  }
}

/**
 * Regenerate backup codes
 */
export async function regenerateBackupCodes(
  userId: string,
  password: string,
  req: Request
): Promise<{ success: boolean; backupCodes?: string[]; error?: string }> {
  try {
    const [user] = await db
      .select({ passwordHash: users.passwordHash, totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.totpEnabled) {
      return { success: false, error: "2FA is not enabled." };
    }

    // Verify password
    if (!user.passwordHash) {
      return { success: false, error: "Password not configured." };
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      await createAuditLog(userId, "backup_codes_regenerate_failed", req, { reason: "invalid_password" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid password." };
    }

    // Generate new backup codes
    const backupCodes: string[] = [];
    const hashedBackupCodes: string[] = [];

    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      backupCodes.push(code);
      hashedBackupCodes.push(await bcrypt.hash(code, 10));
    }

    await db
      .update(users)
      .set({
        totpBackupCodes: hashedBackupCodes,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await createAuditLog(userId, "backup_codes_regenerated", req, {}, "auth");

    return { success: true, backupCodes };
  } catch (error) {
    logger.error({ error, userId }, "Failed to regenerate backup codes");
    return { success: false, error: "Failed to regenerate backup codes" };
  }
}

/**
 * Get 2FA status for user
 */
export async function getTwoFactorStatus(
  userId: string
): Promise<{ enabled: boolean; backupCodesRemaining: number }> {
  try {
    const [user] = await db
      .select({
        totpEnabled: users.totpEnabled,
        totpBackupCodes: users.totpBackupCodes,
      })
      .from(users)
      .where(eq(users.id, userId));

    return {
      enabled: user?.totpEnabled || false,
      backupCodesRemaining: user?.totpBackupCodes?.length || 0,
    };
  } catch (error) {
    logger.error({ error, userId }, "Failed to get 2FA status");
    return { enabled: false, backupCodesRemaining: 0 };
  }
}

/**
 * Reset password using recovery key (for when user is locked out)
 * This allows resetting password without being logged in, using the recovery key
 */
export async function resetPasswordWithRecoveryKey(
  email: string,
  recoveryKey: string,
  newPassword: string,
  req: Request
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user] = await db
      .select({
        id: users.id,
        totpRecoveryKeyHash: users.totpRecoveryKeyHash,
      })
      .from(users)
      .where(eq(users.email, email));

    if (!user) {
      await createAuditLog(null, "password_reset_failed", req, { email, reason: "user_not_found" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid email or recovery key." };
    }

    if (!user.totpRecoveryKeyHash) {
      await createAuditLog(user.id, "password_reset_failed", req, { reason: "no_recovery_key" }, "auth", undefined, "failure");
      return { success: false, error: "No recovery key configured. You must have set up 2FA to use this feature." };
    }

    // Verify recovery key (remove dashes for comparison)
    const recoveryKeyRaw = recoveryKey.replace(/-/g, "").toUpperCase();
    const isRecoveryKeyValid = await bcrypt.compare(recoveryKeyRaw, user.totpRecoveryKeyHash);

    if (!isRecoveryKeyValid) {
      await createAuditLog(user.id, "password_reset_failed", req, { reason: "invalid_recovery_key" }, "auth", undefined, "failure");
      return { success: false, error: "Invalid email or recovery key." };
    }

    // Validate new password
    if (newPassword.length < 12) {
      return { success: false, error: "Password must be at least 12 characters" };
    }

    if (!/[A-Z]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one uppercase letter" };
    }

    if (!/[a-z]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one lowercase letter" };
    }

    if (!/[0-9]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one number" };
    }

    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      return { success: false, error: "Password must contain at least one special character" };
    }

    // Reset password and invalidate all sessions
    const passwordHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Invalidate all sessions
    await invalidateOtherSessions(user.id);

    await createAuditLog(user.id, "password_reset_success", req, { method: "recovery_key" }, "auth");

    return { success: true };
  } catch (error) {
    logger.error({ error }, "Password reset failed");
    return { success: false, error: "Password reset failed. Please try again." };
  }
}

/**
 * Complete login after 2FA verification (used after verifyTwoFactorLogin)
 */
export async function completeTwoFactorLogin(
  userId: string,
  req: Request
): Promise<{ success: boolean; isNewDevice?: boolean; passwordAgeWarning?: boolean; daysSincePasswordChange?: number }> {
  try {
    // Reset failed attempts and update last login
    await updateFailedAttempts(userId, false);
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId));

    // Check device/IP
    const { isNewDevice, isNewIp, deviceFingerprint } = await checkNewDevice(userId, req);

    // Check password age
    const { shouldWarn: passwordAgeWarning, daysSinceChange } = await checkPasswordAge(userId);

    // Log success
    await createAuditLog(userId, "login_success", req, {
      isNewDevice,
      isNewIp,
      deviceFingerprint,
      twoFactorUsed: true,
    }, "auth");

    if (isNewDevice) {
      await createAuditLog(userId, "new_device_login", req, {
        deviceFingerprint,
        userAgent: req.headers["user-agent"],
      }, "auth", undefined, "success");
    }

    return {
      success: true,
      isNewDevice,
      passwordAgeWarning,
      daysSincePasswordChange: daysSinceChange,
    };
  } catch (error) {
    logger.error({ error, userId }, "Failed to complete 2FA login");
    return { success: false };
  }
}
