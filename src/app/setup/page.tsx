import { readSupabaseConfig, REQUIRED_PUBLIC_VARS } from '@/lib/supabase/config'

export const dynamic = 'force-dynamic'

/**
 * Shown when the app cannot reach Supabase because configuration is missing.
 *
 * This page must render with no environment variables set at all — that is
 * its entire purpose. It therefore imports nothing that constructs a Supabase
 * client.
 *
 * It reports variable NAMES and whether each is present. Never values. A
 * publicly reachable page that echoed configuration would leak what is set,
 * and would invite the same treatment for the service role key, which grants
 * unrestricted access to every table.
 */
export default function SetupPage() {
  const result = readSupabaseConfig()

  if (result.ok) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold">Configuration looks complete</h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Both public Supabase variables are set and the project URL parses. If pages are still
          failing, the cause is elsewhere — check the runtime logs for the actual error.
        </p>
        <a href="/login" className="mt-6 inline-block text-sm underline">
          Go to sign in
        </a>
      </main>
    )
  }

  const missing = new Set(result.missing)

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Setup needed</h1>
      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
        This deployment cannot reach its database. {result.missing.length} required{' '}
        {result.missing.length === 1 ? 'variable is' : 'variables are'} missing or unusable.
      </p>

      <ul className="mt-6 flex flex-col gap-4">
        {REQUIRED_PUBLIC_VARS.map((variable) => {
          const isMissing = missing.has(variable.name)
          return (
            <li
              key={variable.name}
              className="rounded border border-neutral-300 p-3 dark:border-neutral-700"
            >
              <div className="flex items-baseline justify-between gap-3">
                <code className="font-mono text-sm">{variable.name}</code>
                <span
                  className={
                    isMissing
                      ? 'text-sm text-red-600 dark:text-red-400'
                      : 'text-sm text-green-700 dark:text-green-400'
                  }
                >
                  {isMissing ? 'missing' : 'set'}
                </span>
              </div>
              {isMissing && (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  {variable.where}
                  <br />
                  <span className="text-xs text-neutral-500">
                    Looks like: <code className="font-mono">{variable.example}</code>
                  </span>
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">To fix</p>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
          <li>Vercel → your project → Settings → Environment Variables</li>
          <li>
            Add each missing variable, with <strong>Production</strong> ticked
          </li>
          <li>
            Deployments → most recent → ··· → <strong>Redeploy</strong>
          </li>
        </ol>
        <p className="mt-3 text-xs text-neutral-500">
          Environment variable changes do not reach deployments that already exist. A redeploy is
          required.
        </p>
      </div>

      <p className="mt-8 text-xs text-neutral-500">
        This page reports only whether each variable is set — never its value.
      </p>
    </main>
  )
}
