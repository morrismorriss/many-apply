import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/** Keep one bad screen (or one bad file) from blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Many Apply screen error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="panel" style={{ maxWidth: 640 }}>
          <h2>Something went wrong on this screen</h2>
          <p className="muted">Your vault files are unchanged. Try again, or go back to the Dashboard.</p>
          <p className="muted"><code>{this.state.error.message}</code></p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button
              className="btn"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset?.();
              }}
            >
              Go to Dashboard
            </button>
            <button className="btn ghost" onClick={() => window.location.reload()}>Reload the app</button>
          </div>
        </div>
      </div>
    );
  }
}
