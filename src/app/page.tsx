import { redirect } from 'next/navigation'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export const dynamic = 'force-dynamic'

export default function RootPage() {
  // Checked here too: this page redirects without calling getEmployee(), so
  // it would otherwise bounce to /overview and fail there instead.
  if (!isSupabaseConfigured()) redirect('/setup')
  redirect('/overview')
}
