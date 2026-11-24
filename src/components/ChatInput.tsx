import { useState, useEffect, forwardRef, useRef, useMemo, useCallback } from 'react';
import { Send, Mic, Square, Paperclip, X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DocumentDialog } from '@/components/DocumentDialog';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useWhisperRecognition } from '@/hooks/useWhisperRecognition';
import { useInactivityPrompt } from '@/hooks/useInactivityPrompt';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { isIOSDevice, isMobileDevice } from '@/lib/device/isIOSDevice';
import { shouldSubmitOnEnter } from '@/lib/keyboard';
import { unlockAudioContext } from '@/hooks/useMobileAudio';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

interface ChatInputProps {
  onSend: (message: string, documentContent?: string) => void;
  onDocumentUpload?: (documentContent: string, documentName: string) => void;
  isLoading?: boolean;
  isSpeaking?: boolean;
  onVoiceTranscript?: (transcript: string, language: string) => void;
  continuousMode?: boolean;
  onContinuousModeChange?: (active: boolean) => void;
  onInactivityPrompt?: (message: string) => void;
}

interface UploadedDocument {
  name: string;
  content: string;
}

// Detect iOS Safari where Web Speech API doesn't work

const ChatInput = forwardRef<HTMLDivElement, ChatInputProps>(({
  onSend,
  onDocumentUpload,
  isLoading = false,
  isSpeaking = false,
  onVoiceTranscript,
  continuousMode = false,
  onContinuousModeChange,
  onInactivityPrompt,
}, ref) => {
  const [message, setMessage] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<UploadedDocument | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Max height the composer can grow to before it starts scrolling internally
  // (~6-7 lines). Keeps the input from taking over the screen on long pastes.
  const TEXTAREA_MAX_HEIGHT = 200;

  // Auto-grow the textarea to fit its content, capped at TEXTAREA_MAX_HEIGHT.
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);
  
  // Use the user's selected language for speech recognition
  const { currentLanguage } = useLanguage();
  
  // Use Whisper for iOS, Web Speech API for others
  const isIOS = useMemo(() => isIOSDevice(), []);
  
  const webSpeech = useSpeechRecognition(currentLanguage.code);
  const whisper = useWhisperRecognition();
  
  // Prefer Native Web Speech API (SFSpeechRecognizer on iOS) if supported
  const useNativeSpeech = webSpeech.isSupported;

  // Choose the right recognition system
  const isListening = useNativeSpeech ? webSpeech.isListening : whisper.isRecording;
  const transcript = useNativeSpeech ? webSpeech.transcript : whisper.transcript;
  const detectedLanguage = useNativeSpeech ? webSpeech.detectedLanguage : (isIOS ? 'en-IN' : 'en-IN');
  const isSupported = useNativeSpeech ? webSpeech.isSupported : whisper.isSupported;
  const isProcessingVoice = useNativeSpeech ? false : whisper.isProcessing;
  const voiceError = useNativeSpeech ? webSpeech.error : whisper.error;
  const lastErrorCode = useNativeSpeech ? null : whisper.lastErrorCode;
  const lastFailureStage = useNativeSpeech ? null : whisper.lastFailureStage;
  
  // Unified control functions - wrapped in useCallback to maintain hook order
  const startListening = useCallback(async () => {
    if (useNativeSpeech) {
      await webSpeech.startListening();
    } else {
      await whisper.startRecording();
    }
  }, [useNativeSpeech, webSpeech.startListening, whisper.startRecording]);
  
  const stopListening = useCallback(async (): Promise<{ text: string; language: string }> => {
    if (useNativeSpeech) {
      webSpeech.stopListening();
      return { text: webSpeech.transcript, language: webSpeech.detectedLanguage };
    } else {
      const result = await whisper.stopRecording();
      return result;
    }
  }, [useNativeSpeech, webSpeech.stopListening, webSpeech.transcript, webSpeech.detectedLanguage, whisper.stopRecording]);
  
  const resetTranscript = useCallback(() => {
    if (useNativeSpeech) {
      webSpeech.resetTranscript();
    } else {
      whisper.resetTranscript();
    }
  }, [useNativeSpeech, webSpeech.resetTranscript, whisper.resetTranscript]);
  
  const autoSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscriptRef = useRef<string>('');
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wasSpeakingRef = useRef<boolean>(false);

  // Inactivity prompt handler - auto-close mic after 3 unanswered prompts
  const handleInactivityClose = useCallback(() => {
    console.log('Closing voice mode due to inactivity');
    setVoiceMode(false);
    setMessage('');
    resetTranscript();
    lastTranscriptRef.current = '';
    stopListening();
    toast.info('Voice mode closed due to inactivity');
  }, [resetTranscript, stopListening]);

  const handleInactivityPrompt = useCallback((promptMessage: string) => {
    console.log('Inactivity prompt:', promptMessage);
    if (onInactivityPrompt) {
      onInactivityPrompt(promptMessage);
    }
  }, [onInactivityPrompt]);

  const { onUserActivity, currentPromptIndex } = useInactivityPrompt({
    onPrompt: handleInactivityPrompt,
    onClose: handleInactivityClose,
    isActive: voiceMode,
    isListening,
    isSpeaking,
    isLoading
  });

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, []);

  // Update message with transcript and auto-send after pause (non-iOS only)
  useEffect(() => {
    // On iOS, we handle this differently - wait for stopRecording to return text
    // if (isIOS) return; // Removed restriction to allow native speech updates
    
    if (transcript && voiceMode) {
      setMessage(transcript);
      
      // Reset inactivity timer when user is speaking
      onUserActivity();
      
      // Auto-send after 2.5 seconds of pause
      if (transcript !== lastTranscriptRef.current) {
        lastTranscriptRef.current = transcript;
        
        if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
        
        autoSendTimerRef.current = setTimeout(() => {
        if (transcript.trim()) {
          // MANUAL MODE: Stop listening immediately on pause
          if (useNativeSpeech) {
             stopListening();
             // setVoiceMode(false); // OPTIONAL: Keep voice mode ON but stop listening? 
             // User requested: "stops before the ai starts processing"
             // To match AiOrb behavior, we turn off voice mode completely
             setVoiceMode(false); 
          } else {
             // For whisper, stopRecording returns the text
             // We'll let the existing logic handle it, but force stop
             // stopListening(); // This is async, handled below
          }
          
          if (onVoiceTranscript) {
            onVoiceTranscript(transcript.trim(), detectedLanguage);
          } else {
            onSend(transcript.trim(), uploadedDoc?.content);
          }
          setMessage('');
          resetTranscript();
          lastTranscriptRef.current = '';
          
          // Force stop if not already stopped
          if (useNativeSpeech) {
             stopListening();
          }
        }
      }, 1000); // 1.0s silence delay
      }
    }
  }, [transcript, detectedLanguage, onSend, onVoiceTranscript, voiceMode, uploadedDoc, isIOS, resetTranscript, onUserActivity, useNativeSpeech, stopListening]);

  // Restart listening when it stops (browser auto-stops after silence) - non-iOS only
  useEffect(() => {
    // iOS uses push-to-talk, not continuous
    if (isIOS && !useNativeSpeech) return;
    
    if (voiceMode && !isListening && isSupported && !isSpeaking && !isLoading) {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      
      restartTimerRef.current = setTimeout(async () => {
        if (voiceMode && !isSpeaking && !isLoading) {
          try {
            await startListening();
          } catch (e) {
            console.log('Auto-restart blocked, user interaction needed');
          }
        }
      }, 300);
    }
    
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, [isListening, voiceMode, isSupported, isSpeaking, isLoading, isIOS, startListening, useNativeSpeech]);

  // Manual Mode: Auto-resume is disabled.
  useEffect(() => {
    // Disabled auto-resume to match user request
  }, []);

  // Notify parent about voice mode changes
  useEffect(() => {
    onContinuousModeChange?.(voiceMode);
  }, [voiceMode, onContinuousModeChange]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 100MB.');
      return;
    }

    // Supported file types
    const supportedTypes = ['text/plain', 'application/pdf', 'text/markdown', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/bmp'];
    const supportedExtensions = ['.txt', '.md', '.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif', '.bmp'];

    const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const isImageExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif', '.bmp'].includes(fileExt);
    const isImage = (file.type || '').startsWith('image/') || isImageExt;
    const isSupported = supportedTypes.includes(file.type) || supportedExtensions.includes(fileExt) || isImage;

    if (!isSupported) {
      toast.error('Unsupported file type. Please upload TXT, MD, PDF, DOC, or an image (PNG/JPG/WebP).');
      return;
    }

    setIsUploading(true);

    try {
      let content = '';

      if (isImage) {
        // Image OCR runs fully in the browser via Tesseract.js — no API key, no
        // server call, no cost. The extracted text is then read/summarized by the
        // chat backend exactly like a PDF's text. Loaded lazily so it doesn't bloat
        // the initial bundle; the ~few-MB models (English + Hindi) are fetched once
        // and cached by the browser.
        const { default: Tesseract } = await import('tesseract.js');
        // Try English + Hindi; if the Hindi model can't load (slow/blocked network),
        // fall back to English so the read never hard-fails on the extra language.
        let text = '';
        try {
          const { data } = await Tesseract.recognize(file, 'eng+hin');
          text = (data?.text || '').trim();
        } catch {
          const { data } = await Tesseract.recognize(file, 'eng');
          text = (data?.text || '').trim();
        }
        content = text ? `--- Image: ${file.name} ---\n[Text extracted from image]\n${text}` : '';
      } else if (file.type === 'text/plain' || fileExt === '.txt' || fileExt === '.md') {
        content = await file.text();
      } else if (fileExt === '.pdf' || file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          pages.push(tc.items.map((item: any) => item.str).join(' '));
        }
        content = pages.join('\n\n');

        // Scanned PDF fallback: a PDF that is really page-images has no text layer,
        // so the above comes back nearly empty. Detect that and OCR the pages in the
        // browser (Tesseract.js) — no API, no cost. Capped at 15 pages to stay quick.
        if (content.replace(/\s/g, '').length < 40 && pdf.numPages > 0) {
          const { default: Tesseract } = await import('tesseract.js');
          const worker = await Tesseract.createWorker('eng+hin').catch(() => Tesseract.createWorker('eng'));
          try {
            const ocrPages: string[] = [];
            const maxPages = Math.min(pdf.numPages, 15);
            for (let i = 1; i <= maxPages; i++) {
              const page = await pdf.getPage(i);
              const viewport = page.getViewport({ scale: 2 });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) continue;
              await page.render({ canvasContext: ctx, viewport }).promise;
              const { data } = await worker.recognize(canvas);
              ocrPages.push((data?.text || '').trim());
            }
            const ocrText = ocrPages.join('\n\n').trim();
            if (ocrText) {
              content = `--- Scanned PDF: ${file.name}${pdf.numPages > maxPages ? ` (first ${maxPages} of ${pdf.numPages} pages)` : ''} ---\n[Text extracted by OCR]\n${ocrText}`;
            }
          } finally {
            await worker.terminate();
          }
        }
      } else if (fileExt === '.docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        content = result.value;
      } else {
        content = await file.text().catch(() => '');
      }

      if (!content || content.trim().length < 10) {
        toast.error('Could not extract text from file. Try a plain text or PDF file.');
        return;
      }

      // Limit content for AI processing (backend can now accept up to 60k)
      const truncatedContent = content.slice(0, 60000);
      
      setUploadedDoc({
        name: file.name,
        content: truncatedContent
      });
      
      // Attach the document to the NEXT message instead of auto-sending. The user
      // uploads, types their question, then sends — the document rides along with
      // that message (see doSend, which passes uploadedDoc.content to onSend and
      // then clears it). It shows as a chip until sent or removed.
      toast.success(`"${file.name}" attached. Type your question, then send.`);
    } catch (error) {
      console.error('File upload error:', error);
      toast.error('Failed to read file. Please try again.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeDocument = () => {
    setUploadedDoc(null);
    toast.info('Document removed');
  };

  // Shared send logic used by both the form submit and Enter-to-send.
  const doSend = () => {
    unlockAudioContext(); // Unlock audio on submit
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);

    if (message.trim() && !isLoading) {
      // Document requests go to the chat like anything else: the chat writes the
      // document, and Download PDF / Word buttons appear under the answer. No
      // popup. (The document button still opens the template form on demand.)
      onSend(message.trim(), uploadedDoc?.content);
      setMessage('');
      if (uploadedDoc) setUploadedDoc(null); // consume the attachment once sent
      resetTranscript();
      lastTranscriptRef.current = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSend();
  };

  // Enter sends, Shift+Enter makes a newline. Skipped on mobile (touch keyboards
  // use Enter for newline; sending is via the button there) and while an IME is
  // composing a word (Enter confirms the candidate, e.g. Hindi/Tamil/CJK input).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isMobileDevice()) return;
    if (shouldSubmitOnEnter({
      key: e.key,
      shiftKey: e.shiftKey,
      isComposing: (e.nativeEvent as any).isComposing,
      keyCode: (e.nativeEvent as any).keyCode,
    })) {
      e.preventDefault();
      doSend();
    }
  };

  const handleMicClick = async () => {
    unlockAudioContext(); // Unlock audio on mic click

    // DO NOT await unlockAudioContext here - it breaks iOS gesture chain for getUserMedia
    // Audio unlock happens inside startRecording after getUserMedia succeeds

    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    
    if (voiceMode || isListening) {
      // Turn off voice mode FIRST to allow typing immediately
      setVoiceMode(false);
      setMessage('');
      resetTranscript();
      lastTranscriptRef.current = '';
      
      // For iOS, stopListening returns the transcribed text and detected language
      const result = await stopListening();
      
      // Send any pending transcript with the detected language
      const textToSend = result.text || transcript;
      const langToUse = result.language || detectedLanguage;
      if (textToSend && textToSend.trim()) {
        if (onVoiceTranscript) {
          onVoiceTranscript(textToSend.trim(), langToUse);
        } else {
          onSend(textToSend.trim(), uploadedDoc?.content);
        }
      }
    } else {
      // Turn on voice mode / start recording
      setVoiceMode(true);
      resetTranscript();
      setMessage('');
      lastTranscriptRef.current = '';
      try {
        await startListening();
        if (isIOS && !useNativeSpeech) {
          toast.info('Recording... Tap again to send', { duration: 2000 });
        }
      } catch (error) {
        console.error('Failed to start listening:', error);
        setVoiceMode(false);
        const msg = error instanceof Error ? error.message : (voiceError || 'Failed to start voice input');
        toast.error(msg);
      }
    }
  };

  // Keep the textarea height in sync with the message (covers typing, sends that
  // clear the field, and voice-mode transcript updates).
  useEffect(() => {
    autoResizeTextarea();
  }, [message, voiceMode, autoResizeTextarea]);

  const placeholder = voiceMode
    ? (isProcessingVoice ? 'Transcribing...' : isSpeaking ? 'AI speaking...' : isListening ? (isIOS && !useNativeSpeech ? 'Recording...' : 'Listening...') : isLoading ? 'Processing...' : 'Ready to listen')
    : uploadedDoc
    ? 'Ask about this document…'
    : isLoading
    ? 'Processing…'
    : 'Ask a legal question…';

  return (
    <div ref={ref} className="w-full mx-auto">
      {/* Uploaded document indicator */}
      {uploadedDoc && (
        <div className="mb-2 flex items-center gap-2 bg-secondary rounded-lg px-3 py-2 text-sm">
          <FileText size={16} className="text-primary shrink-0" />
          <span className="text-foreground truncate flex-1">{uploadedDoc.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={removeDocument}
            className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
          >
            <X size={14} />
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className={`relative ${voiceMode && isSpeaking ? 'jarvis-speaking rounded-full' : ''}`}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.bmp,image/*"
          onChange={handleFileUpload}
          className="hidden"
        />

          {voiceMode && (
            <div className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1">
              <div className="flex items-center gap-0.5">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-0.5 rounded-full transition-all ${
                      isSpeaking
                        ? 'bg-primary waveform-bar'
                        : isListening
                        ? 'bg-green-500 waveform-bar'
                        : 'bg-muted-foreground/50 h-2'
                    }`}
                    style={{ animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
            </div>
          )}

        <textarea
          ref={textareaRef}
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onInput={autoResizeTextarea}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          // Enter sends (see handleKeyDown), Shift+Enter makes a newline.
          // Group 6: allow typing while the AI is speaking. `message` is independent
          // of the voice transcript, so text + voice can be active simultaneously.
          // Only block typing while a request is in flight.
          disabled={isLoading}
          style={{ maxHeight: `${TEXTAREA_MAX_HEIGHT}px` }}
          className={`w-full resize-none ${voiceMode ? 'pl-12' : 'pl-[4.5rem] sm:pl-20 lg:pl-24'} py-3 sm:py-3.5 lg:py-4 pr-24 sm:pr-28 lg:pr-32 rounded-md bg-card border shadow-[0_1px_0_hsl(var(--border)),0_12px_32px_-18px_hsl(var(--primary)/0.35)] leading-relaxed align-middle ${
            isSpeaking
              ? 'border-primary/50'
              : voiceMode
              ? 'border-seal/60'
              : uploadedDoc
              ? 'border-primary/30'
              : 'border-border'
          } text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-0 transition-colors disabled:opacity-50 text-sm sm:text-base lg:text-lg`}
        />

        {/* File upload button on left */}
        {!voiceMode && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || isUploading}
            className="absolute left-2 sm:left-3 bottom-1.5 sm:bottom-2 h-7 w-7 sm:h-8 sm:w-8 lg:h-9 lg:w-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded-full"
            aria-label="Upload document"
          >
            <Paperclip size={16} className={isUploading ? 'animate-spin' : ''} />
          </Button>
        )}

        {/* Generate a legal document (T&C, privacy policy) as Word / PDF */}
        {!voiceMode && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setDocDialogOpen(true)}
            disabled={isLoading}
            className="absolute left-9 sm:left-11 lg:left-14 bottom-1.5 sm:bottom-2 h-7 w-7 sm:h-8 sm:w-8 lg:h-9 lg:w-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded-full"
            aria-label="Generate a legal document"
          >
            <FileText size={16} />
          </Button>
        )}

        <DocumentDialog open={docDialogOpen} onOpenChange={setDocDialogOpen} />

        <div className="absolute right-2 bottom-1.5 sm:bottom-2 flex items-center gap-1">
          {isSupported && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleMicClick}
              className={`h-7 w-7 sm:h-8 sm:w-8 lg:h-9 lg:w-9 rounded-full transition-all ${
                voiceMode
                  ? isSpeaking
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-green-500 text-white hover:bg-green-600'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
              aria-label={voiceMode ? 'Stop voice mode' : 'Start voice mode'}
            >
              {voiceMode ? (
                <Square size={12} className="fill-current" />
              ) : (
                <Mic size={16} />
              )}
            </Button>
          )}
          <Button
            type="submit"
            size="icon"
            disabled={!message.trim() || isLoading}
            className="h-7 w-7 sm:h-8 sm:w-8 lg:h-9 lg:w-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            aria-label="Send message"
          >
            <Send size={14} />
          </Button>
        </div>
      </form>
      
      {voiceMode && (
        <p className={`text-center text-xs mt-2 ${
          currentPromptIndex > 0 ? 'text-orange-400 animate-pulse' :
          isProcessingVoice ? 'text-yellow-400 animate-pulse' :
          isSpeaking ? 'text-primary' : isListening ? 'text-green-400 animate-pulse' : 'text-muted-foreground'
        }`}>
          {currentPromptIndex > 0 ? `Waiting for response... (${currentPromptIndex}/3)` :
           isProcessingVoice ? 'Transcribing audio...' :
           isSpeaking ? (isIOS ? 'AI speaking...' : 'AI speaking... will resume listening after') : 
           isListening && transcript ? (isIOS && !useNativeSpeech ? 'Tap square to send' : 'Auto-sending after pause...') :
           isListening ? (isIOS && !useNativeSpeech ? 'Recording... tap to send' : 'Continuous listening mode active') : 
           isLoading ? 'Processing...' : 'Ready'}
        </p>
      )}
      
      {voiceError && (
        <p className="text-center text-xs mt-1 text-destructive">
          {voiceError}
          {lastErrorCode && lastFailureStage && (
            <span className="block text-muted-foreground/60 text-[10px] mt-0.5">
              [{lastFailureStage}:{lastErrorCode}]
            </span>
          )}
        </p>
      )}
      
      {!voiceMode && (
        <p className="text-center text-[10px] sm:text-xs text-muted-foreground/60 mt-2 sm:mt-3 px-2">
          {uploadedDoc 
            ? '📄 Document attached • Ask questions about it'
            : '📎 Attach documents • 🎙️ Tap mic for voice mode'}
        </p>
      )}
    </div>
  );
});

ChatInput.displayName = 'ChatInput';

export default ChatInput;
