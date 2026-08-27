import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Invite tokens (§9.2, invite-first onboarding).
 *
 * The raw token is generated once, mailed, and never stored. Only its SHA-256
 * hash goes in the database, so a leaked `employee_invites` table does not
 * hand an attacker a set of live credentials — the same reason password
 * hashes exist.
 *
 * 32 bytes of CSPRNG output is 256 bits of entropy. Brute force is not a
 * consideration at that width, which is why a plain hash is adequate here
 * where a password would need a slow KDF: there is no low-entropy secret to
 * protect.
 */

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Constant-time comparison. Lookup is by hash so this is belt-and-braces, but
 * comparing hex digests with `===` leaks position-of-first-difference through
 * timing, and the cost of avoiding it is nil.
 */
export function tokenHashMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface InviteRow {
  id: string
  email: string
  role: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
}

export type InviteRejection =
  | 'not_found'
  | 'already_consumed'
  | 'revoked'
  | 'expired'

/**
 * All four rejection reasons are reported to the caller as one generic
 * failure at the route boundary. Distinguishing "expired" from "not found"
 * tells an attacker probing tokens which guesses were once valid.
 */
export function validateInvite(invite: InviteRow | null): InviteRejection | null {
  if (!invite) return 'not_found'
  if (invite.consumed_at) return 'already_consumed'
  if (invite.revoked_at) return 'revoked'
  if (new Date(invite.expires_at) <= new Date()) return 'expired'
  return null
}

export function inviteUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return `${base}/invite/${token}`
}
