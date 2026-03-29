/**
 * useSpeechInput — headless voice dictation via the Web Speech API.
 *
 * Usage:
 *   const { listening, supported, start, stop } = useSpeechInput({
 *     onResult: (transcript) => setValue(transcript),
 *     onPartial: (interim)   => setPreview(interim),   // optional
 *   });
 *
 * - onResult is called with the final transcript when the user stops speaking.
 * - onPartial is called with interim results as the user speaks (optional).
 * - start() begins listening; stop() cancels before a result is returned.
 * - supported is false on browsers without SpeechRecognition (e.g. Firefox without flag).
 */
import { useState, useRef, useCallback, useEffect } from 'react';

export function useSpeechInput({ onResult, onPartial } = {}) {
  const [listening, setListening]   = useState(false);
  const [supported]                 = useState(() =>
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
  const recognitionRef = useRef(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    if (recognitionRef.current) stop();

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang          = 'en-AU';
    recognition.interimResults = typeof onPartial === 'function';
    recognition.maxAlternatives = 1;
    recognition.continuous    = false;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      let interim = '';
      let final   = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      if (interim && onPartial) onPartial(interim);
      if (final   && onResult)  onResult(final.trim());
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognition.onerror = (e) => {
      if (e.error !== 'aborted') console.warn('[useSpeechInput]', e.error);
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [supported, onResult, onPartial, stop]);

  return { listening, supported, start, stop };
}
