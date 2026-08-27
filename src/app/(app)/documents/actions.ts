'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { voidDocument } from '@/lib/posting/post'

export async function voidDocumentAction(
  documentId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const result = await voidDocument(supabase, documentId, reason)

  if (result.ok) revalidatePath('/documents')

  return { ok: result.ok, error: result.error }
}
