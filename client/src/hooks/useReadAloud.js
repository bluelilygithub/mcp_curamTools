/**
 * useReadAloud — headless text-to-speech via the Web Speech Synthesis API.
 *
 * Usage:
 *   const { speaking, paused, supported, speak, pause, resume, stop } = useReadAloud();
 *   speak(text);   // strips markdown before speaking
 *   pause();       // pauses mid-speech
 *   resume();      // resumes from where it paused
 *   stop();        // cancels completely
 *
 * - Text is cleaned by stripForSpeech before being passed to SpeechSynthesisUtterance.
 * - speak() while already speaking pauses (toggle to pause rather than restart).
 * - stoppedRef guards against the browser firing onend after a manual cancel,
 *   which would otherwise cause a false "not speaking" state race on some browsers.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { stripForSpeech } from '../utils/stripForSpeech';

export function useReadAloud() {
  const [speaking, setSpeaking] = useState(false);
  const [paused,   setPaused]   = useState(false);
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
    setPaused(false);
    utteranceRef.current = null;
  }, [supported]);

  const pause = useCallback(() => {
    if (!supported || !speaking || paused) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [supported, speaking, paused]);

  const resume = useCallback(() => {
    if (!supported || !paused) return;
    stoppedRef.current = false;
    window.speechSynthesis.resume();
    setPaused(false);
  }, [supported, paused]);

  const speak = useCallback((text) => {
    if (!supported || !text?.trim()) return;

    // If paused, resume rather than restarting
    if (paused) { resume(); return; }

    // If already speaking, pause
    if (speaking) { pause(); return; }

    stoppedRef.current = false;
    const cleaned   = stripForSpeech(text);
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang  = 'en-AU';
    utterance.rate  = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      if (!stoppedRef.current) { setSpeaking(true); setPaused(false); }
    };
    utterance.onend = () => {
      if (!stoppedRef.current) { setSpeaking(false); setPaused(false); }
      utteranceRef.current = null;
    };
    utterance.onerror = () => {
      if (!stoppedRef.current) { setSpeaking(false); setPaused(false); }
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.cancel(); // clear any queued speech first
    window.speechSynthesis.speak(utterance);
  }, [supported, speaking, paused, pause, resume]);

  return { speaking, paused, supported, speak, pause, resume, stop };
}
