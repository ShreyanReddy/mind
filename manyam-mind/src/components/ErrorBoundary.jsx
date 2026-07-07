import { Component } from 'react'

// A crash in one pane (Sidebar, the active view, ContextPanel) must never
// take down the rest of the app. Each pane region in App.jsx is wrapped in
// its own boundary so the other panes stay usable while the crashed one
// shows a fallback with a way to recover.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info)
  }

  reload = () => window.location.reload()

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="pane">
        <div className="pane-h">{this.props.label || 'Error'}</div>
        <div className="pane-body empty-hint" style={{ padding: 24 }}>
          <p style={{ color: 'var(--danger)', marginTop: 0 }}>
            This {this.props.label ? `“${this.props.label}”` : 'pane'} crashed: {error.message}
          </p>
          <button className="primary" onClick={this.reload}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
