import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Bearer-token check, constant-time so a byte-by-byte timing side-channel
 * can't be used to guess the token. Length must match first — timingSafeEqual
 * throws (rather than returning false) on mismatched buffer lengths. */
export function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
