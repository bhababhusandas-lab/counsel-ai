import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

// Tells the visitor when the assistant's backend is restarting or being updated,
// instead of leaving them with a silent "Network Error" on their next question.
//
// The site itself is served from the CDN and stays up while the backend restarts,
// so this component can keep polling /health and show a small notice until the
// backend answers again. It needs nothing from the backend beyond /health.
const CHECK_EVERY_MS = 30_000;      // normal cadence while everything is fine
const RECHECK_EVERY_MS = 8_000;     // faster while we are waiting for it to return
const REQUEST_TIMEOUT_MS = 10_000;  // a heavy query can briefly delay /health
const FAILURES_BEFORE_NOTICE = 2;   // one blip is not an outage
const LONG_OUTAGE_MS = 10 * 60_000; // after this, stop promising "a minute or two"

type Phase = 'ok' | 'down' | 'recovered';

async function backendHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiUrl()}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const BackendStatus = () => {
  const [phase, setPhase] = useState<Phase>('ok');
  const [downSince, setDownSince] = useState<number | null>(null);
  const [, forceTick] = useState(0); // re-render so the long-outage wording can switch
  const failures = useRef(0);
  const phaseRef = useRef<Phase>('ok');

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const setBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

    const check = async () => {
      if (stopped) return;
      // Don't poll from a background tab; check again as soon as it is visible.
      if (document.visibilityState === 'hidden') { schedule(CHECK_EVERY_MS); return; }

      const ok = await backendHealthy();
      if (stopped) return;

      if (ok) {
        failures.current = 0;
        if (phaseRef.current === 'down') {
          setBoth('recovered');
          setDownSince(null);
          hideTimer = setTimeout(() => { if (!stopped) setBoth('ok'); }, 4000);
        }
        schedule(CHECK_EVERY_MS);
      } else {
        failures.current += 1;
        if (failures.current >= FAILURES_BEFORE_NOTICE && phaseRef.current !== 'down') {
          clearTimeout(hideTimer);
          setBoth('down');
          setDownSince(Date.now());
        }
        forceTick(n => n + 1);
        schedule(RECHECK_EVERY_MS);
      }
    };

    const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(check, ms); };
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(0); };

    document.addEventListener('visibilitychange', onVisible);
    schedule(3000); // first check shortly after load

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(hideTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (phase === 'ok') return null;

  const longOutage = phase === 'down' && downSince !== null && Date.now() - downSince > LONG_OUTAGE_MS;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-16 z-[70] flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm">
        {phase === 'recovered' ? (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" />
        ) : (
          <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-primary" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {phase === 'recovered'
              ? 'Counsel AI is back'
              : longOutage
                ? 'Counsel AI is temporarily unavailable'
                : 'Counsel AI is updating'}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {phase === 'recovered'
              ? 'You can ask your question now.'
              : longOutage
                ? 'This is taking longer than usual. You can leave this page open; it will reconnect on its own.'
                : 'The assistant will be back in a minute or two. You can leave this page open; it will reconnect on its own.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default BackendStatus;
