import { useEffect, useState } from 'react'

/**
 * Auth gate — STUB. There is no auth backend yet, so `authenticated` defaults to
 * true (the console is not gated). The login screen can still be previewed with
 * the `#login` URL hash. Wiring later means replacing this hook's body with a
 * real session check; the App gate below already consumes its shape.
 */
export function useAuth() {
  const [authenticated, setAuthenticated] = useState(true)

  // Dev/preview: `#login` forces the login screen without a real logout.
  const [previewLogin, setPreviewLogin] = useState(() => window.location.hash === '#login')
  useEffect(() => {
    const onHash = () => setPreviewLogin(window.location.hash === '#login')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return {
    authenticated: authenticated && !previewLogin,
    signIn: (_id: string, _password: string) => setAuthenticated(true),
    signOut: () => setAuthenticated(false),
  }
}
