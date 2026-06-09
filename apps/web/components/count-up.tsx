"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Smoothly animates a number toward its latest value. Honors
 * prefers-reduced-motion by snapping to the end value.
 */
export function CountUp({
  value,
  decimals = 0,
  durationMs = 500,
  className = "",
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return;
    startRef.current = null;

    const step = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(from + delta * eased);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return (
    <span className={className}>
      {display.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  );
}
