import React from 'react';

export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Route render failed:', error, errorInfo);
  }

  render() {
    const { error } = this.state;

    if (error) {
      return (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-300">Route Error</p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">This page could not load.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The app shell is still running, but this route hit a runtime error while rendering.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {error?.message || 'Unknown route error'}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
