import React, { useEffect, useState } from 'react';
import { isIOSDevice } from '@/lib/device/isIOSDevice';
import { unlockAudioContext } from '@/hooks/useMobileAudio';
import { Volume2, X } from 'lucide-react';

const DISMISS_KEY = 'voiceUnlockDismissed';

const AudioUnlocker = () => {
  const [isVisible, setIsVisible] = useState(false);

  const dismiss = () => {
    setIsVisible(false);
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  useEffect(() => {
    const isMobile = isIOSDevice() || /Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    try { if (sessionStorage.getItem(DISMISS_KEY) === '1') return; } catch { /* ignore */ }

    setIsVisible(true);

    // Any real user gesture (tapping the input, scrolling, a keypress) both
    // unlocks the audio context AND means the prompt has done its job — so hide
    // it. This is why it used to "not close": nothing dismissed it but its own
    // button. Now the first interaction anywhere clears it.
    const onGesture = () => {
      unlockAudioContext().catch(() => { /* ignore */ });
      dismiss();
      cleanup();
    };
    const opts: AddEventListenerOptions = { once: true, capture: true };
    window.addEventListener('pointerdown', onGesture, opts);
    window.addEventListener('touchstart', onGesture, opts);
    window.addEventListener('keydown', onGesture, opts);

    // Fallback: never let it linger — fade out on its own after a few seconds.
    const timer = window.setTimeout(() => setIsVisible(false), 6000);

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onGesture, opts);
      window.removeEventListener('touchstart', onGesture, opts);
      window.removeEventListener('keydown', onGesture, opts);
    }
    return cleanup;
  }, []);

  if (!isVisible) return null;

  const handleTap = async () => {
    try { await unlockAudioContext(); } catch { /* ignore */ }
    dismiss();
  };

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="relative flex items-center gap-3 bg-primary/90 text-white shadow-lg rounded-full pl-5 pr-11 py-3 backdrop-blur-sm border border-white/20">
        <button type="button" onClick={handleTap} className="flex items-center gap-3 text-left">
          <Volume2 className="w-5 h-5 animate-pulse shrink-0" />
          <span className="flex flex-col leading-tight">
            <span className="font-semibold text-sm">Enable voice</span>
            <span className="text-xs opacity-80">Tap to activate AI voice</span>
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-white/20"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default AudioUnlocker;
