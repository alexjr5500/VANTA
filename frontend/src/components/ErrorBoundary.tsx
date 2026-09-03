"use client";

import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error.message, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[min(70vh,520px)] items-center justify-center bg-[#050505] px-6 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/[.09] bg-[#111111] p-8 text-center shadow-2xl shadow-black/30">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/[.08]">
              <AlertTriangle size={21} className="text-[#d4af37]" />
            </div>
            <div className="mx-auto mb-5 h-px w-12 bg-[#d4af37]/70" />
            <h3 className="mb-2 text-lg font-medium text-white">Unable to load this content</h3>
            <p className="mb-7 text-sm leading-6 text-white/45">
              Something went wrong while loading this page. You can try again or return home.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-white transition hover:border-[#d4af37]/60 hover:text-[#d4af37]"
              >
                <RefreshCw size={15} />
                Try Again
              </button>
              <HomeButton />
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function HomeButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push('/home')}
      className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
    >
      <Home size={15} />
      Go Home
    </button>
  );
}