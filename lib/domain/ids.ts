import { randomUUID } from "crypto";

export type IdPrefix =
  | "org"
  | "br"
  | "wh"
  | "trm"
  | "usr"
  | "ses"
  | "inv"
  | "role"
  | "cat"
  | "prod"
  | "var"
  | "bc"
  | "kit"
  | "pl"
  | "pli"
  | "promo"
  | "batch"
  | "ser"
  | "stk"
  | "mov"
  | "trf"
  | "trfl"
  | "cnt"
  | "cntl"
  | "cust"
  | "loy"
  | "loytx"
  | "dreq"
  | "sup"
  | "po"
  | "pol"
  | "gr"
  | "grl"
  | "sph"
  | "pm"
  | "shift"
  | "cs"
  | "csm"
  | "dser"
  | "sale"
  | "sl"
  | "sp"
  | "held"
  | "ret"
  | "rl"
  | "rp"
  | "gc"
  | "gctx"
  | "tbl"
  | "rord"
  | "mg"
  | "mo"
  | "tick"
  | "tl"
  | "roi"
  | "res"
  | "rec"
  | "reci"
  | "waste"
  | "sres"
  | "appt"
  | "wo"
  | "wop"
  | "veh"
  | "pc"
  | "rule"
  | "rex"
  | "appr"
  | "ntf"
  | "run"
  | "aud"
  | "int"
  | "dashp"
  | "cli";

/** Generates a prefixed, URL-safe unique id. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Client-generated reference for offline-first operations.
 * Accepted from clients and de-duplicated server-side (unique index).
 */
export function isClientRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("cli_") &&
    value.length >= 8 &&
    value.length <= 80
  );
}

/** Short numeric sequence labels (e.g. kitchen ticket "#12"). */
export function padSequence(n: number, size = 3): string {
  return String(n).padStart(size, "0");
}
