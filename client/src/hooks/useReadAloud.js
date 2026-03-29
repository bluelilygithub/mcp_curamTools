/**
 * useReadAloud — headless text-to-speech via the Web Speech Synthesis API.
 *
 * Usage:
 *   const { speaking, supported, speak, stop } = useReadAloud();
 *   speak(text);   // strips markdown before speaking
 *   stop();        // cancels mid-speech and does not restart
 *
 * - Text is cleaned by stripForSpeech before being passed to speechSynthesisUtterance.
 * - Clicking speak() while already speaking stops playback (toggle).
 * - stoppedRef guards against the browser firing onend after a manual cancel,
 *   which would otherwise cause a false "not speaking" state race on some browsers.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { stripForSpeech } from '../utils/stripForSpeech';

export function useReadAloud() {
  const [speaking, setSpeaking] = useState(false);
  const [supported]             = useState(() =>
    typeof window !== 'undefined' && 'speechSynthesis' in window
  );
  const utteranceRef = useRef(null);
  const stoppedRef   = useRef(false); // true = manual stop; suppress onend side-effects

  // Cancel on unmount
  useEffect(() => {
    return () => {
      if (supported) {
        stoppedRef.current = true;
        window.speechSynthesis.cancel();
      }
    };
  }, [supported]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
    utteranceRef.current = null;
  }, [supported]);

  const speak = useCallback((text) => {
    if (!supported || !text?.trim()) return;

    // Toggle off if already speaking
    if (speaking) { stop(); return; }

    stoppedRef.current = false;
    const cleaned   = stripForSpeech(text);
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang  = 'en-AU';
    utterance.rate  = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      if (!stoppedRef.current) setSpeaking(true);
    };
    utterance.onend = () => {
      if (!stoppedRef.current) setSpeaking(false);
      utteranceRef.current = null;
    };
    utterance.onerror = () => {
      if (!stoppedRef.current) setSpeaking(false);
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.cancel(); // clear any queued speech first
    window.speechSynthesis.speak(utterance);
  }, [supported, speaking, stop]);

  return { speaking, supported, speak, stop };
}
