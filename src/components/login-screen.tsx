import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { BrandLockup } from '@/components/brand-lockup'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * Login screen (id / password). Composition only — the submit handler is a no-op
 * placeholder until auth is wired up. `onSubmit` is invoked with the entered
 * credentials so the wiring later is a one-line change.
 */
export function LoginScreen({ onSubmit }: { onSubmit?: (id: string, password: string) => void }) {
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit?.(id, password)
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-[380px] flex-col gap-6">
        <BrandLockup size="lg" subtitle="sign in to continue" className="justify-center" />

        <Card className="p-6">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-id" className="text-[12px] font-medium text-muted-foreground">
                ID
              </label>
              <Input
                id="login-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoComplete="username"
                placeholder="username"
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-pw" className="text-[12px] font-medium text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <Input
                  id="login-pw"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" size="lg" className="mt-1 h-10 w-full">
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
