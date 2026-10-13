import { createHash } from "crypto";

/**
 * Document integrity layer (jurisdiction-agnostic core).
 *
 * Implements a SHA-256 hash chain over finalized sales documents, the same
 * integrity model required by Portuguese billing-software rules (each
 * document hashes its canonical fields + the previous document's hash).
 *
 * IMPORTANT: hash chaining is NOT fiscal certification. Certification,
 * ATCUD issuance, QR Code layout and SAF-T submission for Portugal depend
 * on legal validation and are exposed through the fiscal adapter registry
 * with an explicit "pending configuration" state. See docs/COMPLIANCE.md.
 */

export interface HashableDocument {
  docType: string;
  documentNumber: string;
  totalCents: number;
  taxCents: number;
  createdAt: number;
  status: string;
  [key: string]: string | number;
}

/** Canonical, stable serialization for hashing (sorted keys). */
export function canonicalString(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalString).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalString(record[k])}`)
    .join(",")}}`;
}

export function hashDocument(
  doc: HashableDocument,
  prevHash: string | null,
): string {
  const payload = `${canonicalString(doc)};prev=${prevHash ?? ""}`;
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyChainEntry(
  doc: HashableDocument,
  prevHash: string | null,
  recordedHash: string,
): boolean {
  return hashDocument(doc, prevHash) === recordedHash;
}

/**
 * Full document number, e.g. "FT AB/143".
 * Series uniqueness is enforced per (org, docType, prefix, fiscalYear).
 */
export function formatDocumentNumber(
  docType: string,
  prefix: string,
  sequence: number,
): string {
  return `${docType} ${prefix}/${sequence}`;
}

/** ATCUD-style document unique code placeholder: ATCUD:<series>-<seq>.
 * The real ATCUD requires a code issued by the AT — until the fiscal
 * adapter is configured with a validated integration, documents carry
 * this deterministic internal identifier and the receipt prints
 * "ATCUD: pending certification" instead of a fake code. */
export function internalDocumentCode(
  seriesId: string,
  sequence: number,
): string {
  return `${seriesId}-${sequence}`;
}
