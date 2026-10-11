import { Component, type ReactNode } from "react";

/**
 * Catches a render error anywhere below it. Without this React unmounts the whole app and the window
 * goes blank; here it says what happened and offers a reload. The vault is already saved as it was.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h2>Something went wrong</h2>
        <p>Astali hit an error it didn't expect. Your work is saved; reloading brings you back to it.</p>
        <pre className="crash-detail">{error.message}</pre>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
