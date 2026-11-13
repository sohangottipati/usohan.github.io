import { useEffect, useState } from 'react';

/**
 * True once `on` has stayed true for `delay` ms. For "Saving…" / spinners:
 * fast responses never flash a busy state (Doherty threshold); the trigger is
 * disabled immediately by the caller instead.
 */
export function useDelayed(on: boolean, delay = 300): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [on, delay]);
  return shown;
}
