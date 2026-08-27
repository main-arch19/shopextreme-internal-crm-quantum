'use server'

import { serviceClient } from '@/lib/supabase/service'
import { hashInviteToken, validateInvite, type InviteRow } from '@/lib/invites'

export interface AcceptResult {
  ok: boolean
  error?: string
}

/**
 * Consumes an invite and creates the employee (§9.2).
 *
 * The account lands `active` at the invited role — no separate approval step,
 * because the executive already made that decision when they sent the invite.
 */
export async function acceptInvite(
  token: string,
  fullName: string,
  password: string,
): Promise<AcceptResult> {
  if (password.length < 12) {
    return { ok: false, error: 'Password must be at least 12 characters.' }
  }

  const supabase = serviceClient()
  const tokenHash = hashInviteToken(token)

  const { data } = await supabase
    .from('employee_invites')
    .select('id, email, role, expires_at, consumed_at, revoked_at, invited_by')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (validateInvite(data as InviteRow | null)) {
    return { ok: false, error: 'This invitation link cannot be used.' }
  }

  const invite = data as InviteRow & { invited_by: string }

  // Claim the invite BEFORE creating the account. The filter on
  // `consumed_at is null` makes this a compare-and-swap: two concurrent
  // submissions of the same link both reach here, but only one update matches
  // a row, and the loser stops before creating a second auth user.
  //
  // Ordering it this way means a crash between claim and create burns the
  // invite without producing an account. That is the safe direction to fail —
  // a re-invite is a minor annoyance, whereas the reverse ordering can leave
  // an orphaned auth user with no employees row and no way to sign in.
  const { data: claimed, error: claimError } = await supabase
    .from('employee_invites')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', invite.id)
    .is('consumed_at', null)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()

  if (claimError || !claimed) {
    return { ok: false, error: 'This invitation link cannot be used.' }
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true, // the invite itself proves control of the address
  })

  if (createError || !created.user) {
    // Release the claim so a genuine failure (a weak password rejected by the
    // auth server, say) does not permanently burn a valid invitation.
    await supabase
      .from('employee_invites')
      .update({ consumed_at: null })
      .eq('id', invite.id)

    return { ok: false, error: 'Could not create the account. Try again.' }
  }

  const { error: employeeError } = await supabase.from('employees').insert({
    id: created.user.id,
    email: invite.email,
    full_name: fullName.trim() || null,
    role: invite.role,
    status: 'active',
    approved_at: new Date().toISOString(),
    // The executive who sent the invite is the approver — that is where the
    // decision was actually made.
    approved_by: invite.invited_by,
  })

  if (employeeError) {
    // Roll back the auth user, or we leave an account that can authenticate
    // but has no employees row — which reads to the user as a silent,
    // permanent "pending" with no way to resolve it.
    await supabase.auth.admin.deleteUser(created.user.id)
    await supabase.from('employee_invites').update({ consumed_at: null }).eq('id', invite.id)

    return { ok: false, error: 'Could not create the account. Try again.' }
  }

  // Logged as a system actor: the new employee cannot be the actor for their
  // own creation, and the inviting executive is not the one submitting this
  // form. The entity_id ties it back to the invite, which carries invited_by.
  await supabase.rpc('write_audit', {
    p_action: 'employee.approved',
    p_entity_type: 'employee',
    p_entity_id: created.user.id,
    p_before: null,
    p_after: { email: invite.email, role: invite.role, via_invite: invite.id },
  })

  return { ok: true }
}
