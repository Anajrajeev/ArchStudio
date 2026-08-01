/**
 * Error boundary around the 3D viewport.
 *
 * A throw anywhere inside the r3f tree unmounts the whole canvas and leaves a blank void with no
 * explanation — which is exactly how a blocked WebGL extension presented in the wild. Containing
 * it here means a rendering failure degrades to a readable message plus a retry, and the rest of
 * the app (panels, model tree, export) keeps working.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ViewportBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Viewport failed to render:', error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const message = error.message || String(error)
    // The known cause worth naming explicitly: a WebGL extension blocked by the browser.
    const isGlCapability = /instanced_arrays|WebGL|SDF|context/i.test(message)

    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--sp-12)',
          padding: 'var(--sp-24)',
          textAlign: 'center',
          background: 'var(--canvas-3d)',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 'var(--fs-heading)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--status-error)',
          }}
        >
          The 3D viewport stopped rendering
        </p>
        <p
          style={{
            margin: 0,
            maxWidth: 460,
            fontSize: 'var(--fs-body)',
            color: 'var(--text-dim)',
          }}
        >
          {isGlCapability
            ? 'Your browser blocked a WebGL feature this viewport needs. Shields or anti-fingerprinting settings are the usual cause — allowing WebGL for this site normally fixes it.'
            : 'An unexpected rendering error occurred. Your model is unchanged and can still be exported.'}
        </p>
        <code
          style={{
            maxWidth: 460,
            fontSize: 'var(--fs-label)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-placeholder)',
            wordBreak: 'break-word',
          }}
        >
          {message}
        </code>
        <button className="btn" onClick={this.reset}>
          Retry
        </button>
      </div>
    )
  }
}
