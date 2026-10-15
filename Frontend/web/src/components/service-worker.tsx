'use client';
/** Registers /sw.js (offline page, cached app files). Not in development, where it would cache stale code. */
import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  }, []);
  return null;
}
