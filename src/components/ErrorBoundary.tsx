import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; copied: boolean };

/**
 * Last line of defence: if a render throws, show a recoverable screen instead of a blank page.
 * The photo session autosaves to IndexedDB, so a reload normally restores the user's work.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('StackCarve crashed', error, info.componentStack);
  }

  private copy = async () => {
    const e = this.state.error;
    const text = `${e?.name ?? 'Error'}: ${e?.message ?? ''}\n${e?.stack ?? ''}`;
    try { await navigator.clipboard.writeText(text); this.setState({ copied: true }); } catch { /* clipboard unavailable */ }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <div className="crash-screen" role="alert">
      <div className="crash-card">
        <b>Something went wrong</b>
        <p>StackCarve hit an error it could not recover from. Your photo session is autosaved, so reloading should bring your work back.</p>
        <code>{error.message || String(error)}</code>
        <div className="crash-actions">
          <button className="primary" onClick={() => location.reload()}>Reload app</button>
          <button onClick={this.copy}>{this.state.copied ? 'Copied' : 'Copy error details'}</button>
        </div>
      </div>
    </div>;
  }
}
