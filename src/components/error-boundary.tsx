import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * Last-resort boundary so a single bad render (e.g. a malformed payload) shows a
 * recoverable message instead of blanking the whole console. Resets on reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="font-mono text-[12.5px] break-all text-muted-foreground">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
