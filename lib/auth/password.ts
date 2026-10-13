import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "crypto";

/**
 * Password hashing with Node's built-in scrypt (memory-hard KDF).
 * Format: scrypt$N$r$p$saltB64$hashB64
 * Passwords and PINs are NEVER logged or stored in plaintext.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const salt = Buffer.from(saltB64!, "base64");
    const expected = Buffer.from(hashB64!, "base64");
    const actual = scryptSync(secret, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Session tokens / invite tokens: store only the SHA-256 digest. */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Basic password policy for operator accounts. */
export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) errors.push("Mínimo de 8 caracteres.");
  if (!/[A-Za-z]/.test(password)) errors.push("Deve conter letras.");
  if (!/[0-9]/.test(password)) errors.push("Deve conter números.");
  return errors;
}

export function pinPolicyErrors(pin: string): string[] {
  if (!/^\d{4,8}$/.test(pin)) return ["PIN deve ter 4 a 8 dígitos."];
  return [];
}
