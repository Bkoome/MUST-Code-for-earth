'use client';

import { useEffect, useState } from 'react';
import { clearArchiveCache, fetchStatus } from 'app/lib/api/exceedance';
import type { BuilderStatus } from 'app/types/exceedance';

const POLL_MS = 4000;

// Poll /xr/status while the summary builder runs; stop once the archive is complete.
export function useBuilderProgress(): BuilderStatus | null {
  const [status, setStatus] = useState<BuilderStatus | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let lastCount = -1;

    const tick = async () => {
      try {
        const next = await fetchStatus();
        if (stopped) return;
        if (lastCount >= 0 && next.summarized > lastCount) clearArchiveCache();
        lastCount = next.summarized;
        setStatus(next);
        if (next.summarized < next.total) timer = window.setTimeout(tick, POLL_MS);
      } catch {
        if (!stopped) timer = window.setTimeout(tick, POLL_MS * 2);
      }
    };
    tick();

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return status;
}
