import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render/effect errors anywhere below it and shows the message instead
 * of letting React unmount to a blank page. Invaluable in a packaged app where
 * DevTools isn't readily available.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error:', error, info)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      return (
        <div className="errbox">
          <h2>Renderer error</h2>
          <p>Something failed while rendering. Details below:</p>
          <pre>{error.stack ?? error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
