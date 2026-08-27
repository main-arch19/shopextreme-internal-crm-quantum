import { serviceClient } from '@/lib/supabase/service'
import { hashInviteToken, validateInvite, type InviteRow } from '@/lib/invites'
import { AcceptInviteForm } from './accept-form'

/**
 * Invite acceptance (§9.2).
 *
 * Uses the service-role client because the invitee has no employees row yet
 * and therefore cannot pass is_active_employee() — one of the three
 * legitimate uses documented in lib/supabase/service.ts.
 *
 * The lookup is by token hash, so the raw token in the URL is never compared
 * against anything stored. A leaked employee_invites table yields hashes, not
 * usable links.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = serviceClient()

  const { data } = await supabase
    .from('employee_invites')
    .select('id, email, role, expires_at, consumed_at, revoked_at')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()

  const rejection = validateInvite(data as InviteRow | null)

  if (rejection) {
    // One generic message for all four rejection reasons. Telling the visitor
    // that a token was "expired" rather than "not found" confirms it was once
    // real, which is information worth withholding from someone probing.
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="text-xl font-semibold">Invitation unavailable</h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          This invitation link cannot be used. Invitations expire after seven days — ask an
          administrator to send a new one.
        </p>
      </main>
    )
  }

  const invite = data as InviteRow

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold">Set up your account</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Invited as <span className="font-medium">{invite.role}</span> — {invite.email}
      </p>
      <AcceptInviteForm token={token} email={invite.email} />
    </main>
  )
}
