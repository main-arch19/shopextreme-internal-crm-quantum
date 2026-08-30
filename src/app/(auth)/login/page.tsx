import { redirect } from 'next/navigation'
import { getEmployee } from '@/lib/auth'
import { LoginForm } from './login-form'

// Reads cookies and environment per request; prerendering would bake in
// whatever configuration existed at build time.
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const employee = await getEmployee()

  if (employee) {
    redirect(employee.status === 'active' && employee.role !== 'pending' ? '/overview' : '/pending')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold">Inventory</h1>
      <p className="mt-1 text-sm text-neutral-500">Sign in to continue.</p>
      <LoginForm />
      <p className="mt-6 text-xs text-neutral-500">
        Accounts are created by invitation. If you need access, ask an administrator to invite you.
      </p>
    </main>
  )
}
