'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default class GiftPickerBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Gift picker render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <>
      <button aria-label="Close gift picker" onClick={this.props.onClose} className="fixed inset-0 z-[70] bg-black/70" />
      <section role="alertdialog" aria-modal="true" className="fixed inset-x-0 bottom-0 z-[80] bg-[#151517] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-white">
        <button aria-label="Close" onClick={this.props.onClose} className="absolute right-3 top-3 grid h-9 w-9 place-items-center text-white/60"><X size={19} /></button>
        <AlertTriangle className="mx-auto text-amber-300" />
        <h2 className="mt-3 font-semibold">Unable to open gifts</h2>
        <p className="mt-1 text-sm text-white/55">The Home page is still available. Close this panel and try again.</p>
      </section>
    </>;
  }
}