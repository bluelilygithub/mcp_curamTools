/**
 * useReadAloud — headless text-to-speech via the Web Speech Synthesis API.
 *
 * Usage:
 *   const { speaking, supported, speak, stop } = useReadAloud();
 *   speak(text);   // strips markdown before speaking
 *   stop();        // cancels mid-speech
 *
 * - Text is cleaned by stripForSpeech before being passed to speechSynthesis.
 * - speak() with the same text while speaking calls stop() first (toggle behaviour).
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { stripForSpeech } from '../utils/stripForSpeech';

export function useReadAloud() {
  const [speaking, setSpeaking] = useState(false);
  const [supported]             = useState(() =>
    typeof window !== 'undefined' && 'speechSynthesis' in window
  );
  const utteranceRef = useRef(null);

  // Cancel on unmount
  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
    utteranceRef.current = null;
  }, [supported]);

  const speak = useCallback((text) => {
    if (!supported || !text?.trim()) return;

    // Toggle off if already speaking
    if (speaking) { stop(); return; }

    const cleaned  = stripForSpeech(text);
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang  = 'en-AU';
    utterance.rate  = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend   = () => { setSpeaking(false); utteranceRef.current = null; };
    utterance.onerror = () => { setSpeaking(false); utteranceRef.current = null; };

    utteranceRef.current = utterance;
    window.speechSynthesis.cancel(); // clear any queued speech first
    window.speechSynthesis.speak(utterance);
  }, [supported, speaking, stop]);

  return { speaking, supported, speak, stop };
}
