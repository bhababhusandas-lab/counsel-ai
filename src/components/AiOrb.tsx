import { useState, useEffect, useRef, useMemo } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useWhisperRecognition } from '@/hooks/useWhisperRecognition';
import { useLanguage } from '@/contexts/LanguageContext';
import { isIOSDevice } from '@/lib/device/isIOSDevice';
import { isMacDevice } from '@/lib/device/isMacDevice';
import Seal from './Seal';
import { useTheme } from '@/contexts/ThemeContext';
import { unlockAudioContext } from '@/hooks/useMobileAudio';

interface AiOrbProps {
  onTranscript?: (transcript: string, language: string) => void;
  isProcessing?: boolean;
  responseText?: string;
  responseLanguage?: string;
  // TTS state is owned by MainContent's single useOpenAITTS instance and passed
  // down, so the app has exactly ONE speaker (no duplicate/overlapping audio).
  isSpeaking?: boolean;
  onStopSpeaking?: () => void;
  isTTSLoading?: boolean;
}

const AiOrb = ({ onTranscript, isProcessing = false, responseText, responseLanguage = 'en-IN', isSpeaking = false, onStopSpeaking, isTTSLoading = false }: AiOrbProps) => {
  const [isActive, setIsActive] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false); // CHANGED TO FALSE: Manual Tap Only
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const { theme } = useTheme();
  const isLightMode = theme === 'light';

  const isIOS = useMemo(() => isIOSDevice(), []);
  const isMac = useMemo(() => isMacDevice(), []);

  // Mac users get a 30% larger orb + title for better presence on big displays.
  const orbSizeClasses = isMac
    ? 'w-40 h-40 sm:w-52 sm:h-52 lg:w-56 lg:h-56'
    : 'w-32 h-32 sm:w-40 sm:h-40 lg:w-44 lg:h-44';
  const titleSizeClasses = isMac
    ? 'text-3xl sm:text-4xl lg:text-5xl'
    : 'text-2xl sm:text-3xl lg:text-4xl';
  const subtitleSizeClasses = isMac
    ? 'text-sm sm:text-base lg:text-lg'
    : 'text-xs sm:text-sm lg:text-base';

  const { currentLanguage } = useLanguage();

  const {
    isListening: webIsListening,
    transcript: webTranscript,
    detectedLanguage: webDetectedLanguage,
    startListening: startWebListening,
    stopListening: stopWebListening,
    resetTranscript: resetWebTranscript,
    isSupported: webSpeechSupported,
    error: webSpeechError,
  } = useSpeechRecognition(currentLanguage.code);

  const {
    isRecording,
    transcript: whisperTranscript,
    error: whisperError,
    startRecording,
    stopRecording,
    resetTranscript: resetWhisperTranscript,
    isSupported: whisperSupported,
    isProcessing: isProcessingVoice,
    lastErrorCode: whisperLastErrorCode,
  } = useWhisperRecognition();

  // Prefer Native Web Speech API (SFSpeechRecognizer on iOS) if supported
  // Only fall back to Whisper (WavRecorder) if native is not available
  const useNativeSpeech = webSpeechSupported;

  const isListening = useNativeSpeech ? webIsListening : isRecording;
  const transcript = useNativeSpeech ? webTranscript : whisperTranscript;
  // Native path: language from the recognizer (which now trusts the selection).
  // Whisper path: don't hard-code en-IN (that made Telugu/Bengali speakers get
  // English/Hindi) — route to the user's selected language.
  const detectedLanguage = useNativeSpeech ? webDetectedLanguage : currentLanguage.code;
  const speechSupported = useNativeSpeech ? webSpeechSupported : whisperSupported;
  const speechError = useNativeSpeech ? webSpeechError : whisperError;

  const resetTranscript = () => (useNativeSpeech ? resetWebTranscript() : resetWhisperTranscript());

  // Single-speaker architecture: these come from MainContent's one TTS instance.
  const stopSpeaking = onStopSpeaking ?? (() => {});
  const isLoading = isTTSLoading;

  // Auto-send timer ref
  const autoSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscriptRef = useRef<string>('');
  const wasSpeakingRef = useRef<boolean>(false);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current);
      }
    };
  }, []);

  // NUCLEAR OPTION: Listen for Global Speech Events to Hard-Stop Microphone
  useEffect(() => {
    const handleSpeechStart = () => {
      console.log('AI Started Speaking - HARD STOP MIC');
      if (useNativeSpeech) stopWebListening();
      else stopRecording();
      setIsActive(false);
      wasSpeakingRef.current = true;
    };

    const handleSpeechStop = () => {
      console.log('AI Stopped Speaking - Ready for manual tap');
      // In manual mode, we do NOT queue a mic restart. We wait for user tap.
    };

    window.addEventListener('ai-speech-started', handleSpeechStart);
    window.addEventListener('ai-speech-stopped', handleSpeechStop);

    return () => {
      window.removeEventListener('ai-speech-started', handleSpeechStart);
      window.removeEventListener('ai-speech-stopped', handleSpeechStop);
    };
  }, [continuousMode, isProcessing, isLoading, useNativeSpeech, startWebListening, stopWebListening, startRecording, stopRecording, resetTranscript]);

  // Auto-send after 2 seconds of pause while listening
  useEffect(() => {
    // On iOS native, we might not get partial results as frequently, but this logic still holds
    if (isListening && transcript && transcript !== lastTranscriptRef.current) {
      lastTranscriptRef.current = transcript;
      
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current);
      }
      
      autoSendTimerRef.current = setTimeout(() => {
        if (transcript.trim() && onTranscript) {
          
          // MANUAL MODE FIX:
          // Immediately STOP listening when we detect a pause and send the message.
          if (useNativeSpeech) {
             stopWebListening();
          } else {
             stopRecording();
          }
          setIsActive(false); // Turn off the Orb
          
          onTranscript(transcript.trim(), detectedLanguage);
          resetTranscript();
          lastTranscriptRef.current = '';
        }
      }, 1000); // Reduced delay to 1.0s for snappier "Stop & Send"
    }
  }, [isIOS, transcript, isListening, onTranscript, stopWebListening, resetTranscript, detectedLanguage, useNativeSpeech, responseText]);

  // NOTE: The orb no longer speaks. MainContent owns the single useOpenAITTS
  // instance and auto-speaks every assistant response exactly once. Removing the
  // duplicate speaker here is the root-cause fix for double/overlapping audio.
  // The orb still reacts to speech via the shared `isSpeaking` prop and the
  // global `ai-speech-started` event (now emitted by useOpenAITTS) to hard-stop
  // the mic and prevent echo/feedback.

  // Continuous conversation: auto-start listening when speaking ends
  useEffect(() => {
    // Note: We removed the !continuousMode check to allow auto-restart
    if (isIOS) return; 

    if (isSpeaking) {
      wasSpeakingRef.current = true;
      // HARD LOCK: Ensure listening is OFF while speaking
      if (isListening) {
         if (useNativeSpeech) stopWebListening();
         else stopRecording();
         setIsActive(false);
      }
    }
    
    if (!isSpeaking && wasSpeakingRef.current && continuousMode && speechSupported && !isProcessing && !isLoading) {
      wasSpeakingRef.current = false;
      // We are in manual mode now, so this won't trigger, but leaving it for safety
      const timer = setTimeout(async () => {
        // DOUBLE CHECK: Are we still NOT speaking?
        if (!isListening && !isProcessing && !isSpeaking) { 
          try {
            // HARD RESET: Clear any buffered transcript
            resetTranscript();
            lastTranscriptRef.current = '';
            
            if (useNativeSpeech) {
              await startWebListening();
            } else {
              await startRecording();
            }
            setIsActive(true);
          } catch (e) {
            console.error('Failed to auto-start listening:', e);
          }
        }
      }, 1200); // 1.2 SECONDS DELAY - Optimal balance for echo vs speed
      return () => clearTimeout(timer);
    }
  }, [isIOS, isSpeaking, continuousMode, speechSupported, isProcessing, isListening, startWebListening, startRecording, isLoading, useNativeSpeech, stopWebListening, stopRecording, resetTranscript]);

  const handleOrbClick = async () => {
    // Mark that user has interacted (enables audio on mobile)
    setHasUserInteracted(true);
    unlockAudioContext(); // Unlock audio immediately on gesture

    // DO NOT await unlockAudioContext here - it breaks iOS gesture chain for getUserMedia
    // Audio unlock happens inside startRecording after getUserMedia succeeds

    if (isSpeaking || isLoading) {
      stopSpeaking();
      return;
    }

    if (isListening) {
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current);
      }
      
      if (transcript.trim() && onTranscript) {
        onTranscript(transcript.trim(), detectedLanguage);
        resetTranscript();
        lastTranscriptRef.current = '';
      }
      
      if (useNativeSpeech) {
        stopWebListening();
      } else {
        await stopRecording();
      }
      setIsActive(false);
    } else {
       // Start listening
       if (useNativeSpeech) {
         try {
           await startWebListening();
           setIsActive(true);
         } catch (e) {
            console.error('Failed to start native listening:', e);
            setIsActive(false);
         }
       } else if (speechSupported) {
          try {
            await startRecording();
            setIsActive(true);
          } catch (e) {
            console.error('Failed to start recording:', e);
            setIsActive(false);
          }
       }
    }
  };

  const displayState = (isLoading || isProcessing || isProcessingVoice) ? 'thinking' : isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle';

  const languageNames: Record<string, string> = {
    'hi-IN': 'हिंदी',
    'ta-IN': 'தமிழ்',
    'te-IN': 'తెలుగు',
    'kn-IN': 'ಕನ್ನಡ',
    'ml-IN': 'മലയാളം',
    'bn-IN': 'বাংলা',
    'gu-IN': 'ગુજરાતી',
    'pa-IN': 'ਪੰਜਾਬੀ',
    'mr-IN': 'मराठी',
    'or-IN': 'ଓଡ଼ିଆ',
    'en-IN': 'English'
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={handleOrbClick}
        disabled={isProcessing}
        className="seal-button relative rounded-full cursor-pointer disabled:cursor-wait touch-manipulation"
        aria-label={displayState === 'idle' ? 'Tap to start speaking' : displayState === 'listening' ? 'Tap to stop' : 'Voice assistant'}
      >
        <Seal state={displayState} className={orbSizeClasses} />
      </button>

      {/* Text labels */}
      <div className="text-center mt-2">
        <h2 className={`${titleSizeClasses} font-display text-foreground whitespace-nowrap`}>
          Counsel AI
        </h2>
        <p className={`text-muted-foreground ${subtitleSizeClasses} mt-2 tracking-wide`}>
          {displayState === 'thinking' && (isLoading ? 'Preparing audio…' : 'Looking into it…')}
          {displayState === 'speaking' && 'Speaking…'}
          {displayState === 'listening' && `Listening in ${languageNames[detectedLanguage] || 'English'}…`}
          {displayState === 'idle' && (speechSupported ? 'Tap the seal and ask your question' : 'Voice isn’t supported in this browser. Type your question below.')}
        </p>
        
        {/* Error display */}
        {speechError && (
          <p className="text-destructive text-xs mt-1">
            {speechError}
            {isIOS && whisperLastErrorCode && (
              <span className="block text-muted-foreground/60 text-[10px]">[{whisperLastErrorCode}]</span>
            )}
          </p>
        )}
      </div>

      {/* Live transcript */}
      {isListening && transcript && (
        <div className="text-center max-w-xs sm:max-w-md px-4 animate-fade-in">
          <p className="text-foreground/80 text-xs sm:text-sm italic">"{transcript}"</p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            Auto-sending in 2 seconds...
          </p>
        </div>
      )}

    </div>
  );
};

export default AiOrb;
