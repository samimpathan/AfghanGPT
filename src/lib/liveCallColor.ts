import type { CSSProperties } from "react";
import { store } from "./store";

/** Live-call colour (founder order 2026-11-25): whatever colour is
 * picked in Settings, the home live-call button AND the voice-screen
 * orb take that colour. ONLY those two — the rest of the app keeps
 * the brand blue. The choice is stored in Settings.liveCallColor
 * (a hex string; "" = the default blue). */

export type LiveCallColor = { id: string; name: string; hex: string };

/** Curated set: every colour reads in light AND dark (the button
 * sits in the composer pill, the orb on the voice screen). */
export const LIVE_CALL_COLORS: LiveCallColor[] = [
  { id: "blue", name: "Blue", hex: "#2457FF" },
  { id: "cyan", name: "Cyan", hex: "#06B6D4" },
  { id: "green", name: "Green", hex: "#16A34A" },
  { id: "purple", name: "Purple", hex: "#7C3AED" },
  { id: "orange", name: "Orange", hex: "#EA580C" },
  { id: "pink", name: "Pink", hex: "#DB2777" },
];

export const DEFAULT_LIVE_CALL_COLOR = "#2457FF";

/** Stored value -> the colour to use. Unknown/garbage values fall
 * back to the default blue (never a broken colour). */
export function resolveLiveCallColor(stored: string | undefined | null): string {
  if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) return stored;
  return DEFAULT_LIVE_CALL_COLOR;
}

/** Black or white text on top of the colour, by relative
 * luminance — so the button label stays readable on every
 * choice, in light and dark. */
export function liveCallTextColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? "#000000" : "#ffffff";
}

function shade(hex: string, f: number): string {
  // f in [-1, 1]: >0 mixes toward white, <0 toward black.
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const target = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  const mix = (v: number) => Math.round(v + (target - v) * p);
  const to = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to(mix(r))}${to(mix(g))}${to(mix(b))}`;
}

function rgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** The home live-call buttons read the colour from CSS variables,
 * NOT from a render-time store read. (The home page is statically
 * prerendered: a render-time read returns the default blue on the
 * first paint and only flips after a client re-render — the button
 * stayed blue until the user typed. CSS variables set on
 * <html> apply at paint time, no re-render needed.) */
export const LIVE_CALL_BUTTON_VAR_STYLE: CSSProperties = {
  backgroundColor: "var(--live-call, #2457FF)",
  color: "var(--live-call-text, #ffffff)",
};

/** Apply the stored live-call colour to <html> as CSS variables.
 * Called once at app mount (Providers) and on every Settings save,
 * so the buttons + orb follow the choice across navigations
 * without any re-render. Default blue = remove the overrides, so
 * the CSS fallbacks render the exact approved blue/cyan orb. */
export function applyLiveCallColor(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const main = resolveLiveCallColor(store.settings().liveCallColor);
  root.style.setProperty("--live-call", main);
  root.style.setProperty("--live-call-text", liveCallTextColor(main));
  if (main.toLowerCase() === DEFAULT_LIVE_CALL_COLOR.toLowerCase()) {
    for (const v of ["--orb-a", "--orb-b", "--orb-c", "--orb-main", "--orb-deep", "--orb-rgb", "--orb-c-rgb"]) {
      root.style.removeProperty(v);
    }
    return;
  }
  const mid = shade(main, 0.3);
  root.style.setProperty("--orb-a", shade(main, 0.88));
  root.style.setProperty("--orb-b", shade(main, 0.6));
  root.style.setProperty("--orb-c", mid);
  root.style.setProperty("--orb-main", main);
  root.style.setProperty("--orb-deep", shade(main, -0.25));
  root.style.setProperty("--orb-rgb", rgbTriplet(main));
  root.style.setProperty("--orb-c-rgb", rgbTriplet(mid));
}
