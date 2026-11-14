import type { ReactNode } from "react";
import { Component } from "react";

/** Shows `fallback` when the editor, or the code that loads it, throws. */
export class EditorBoundary extends Component<
  { fallback: ReactNode; onError: (error: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
