/**
 * Time-based one-time codes (TOTP) for two-factor login, using otplib
 * (works with Google Authenticator, Microsoft Authenticator, etc.).
 */
import { generateSecret, generateURI, verify } from 'otplib';

export function newTotpSecret(): string {
  return generateSecret();
}

/** otpauth:// link; the frontend shows it as a QR code to scan. */
export function totpUri(secret: string, accountLabel: string): string {
  return generateURI({ issuer: 'ERP Portal', label: accountLabel, secret });
}

/**
 * Checks a 6-digit code. Allows one 30-second step of clock difference.
 * Returns the matched time step (save it to block re-use of the same code),
 * or null if the code is wrong, expired or already used.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  lastUsedTimeStep: number | null,
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const result = await verify({
    secret,
    token: code,
    epochTolerance: 30,
    ...(lastUsedTimeStep !== null ? { afterTimeStep: lastUsedTimeStep } : {}),
  });
  return result.valid && 'timeStep' in result ? result.timeStep : null;
}
