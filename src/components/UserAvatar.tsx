/**
 * UserAvatar — the user's own avatar, like Muse shows it.
 * If the user set a profile photo (Settings → Profile photo, stored
 * as a downscaled data URL in settings.avatarDataUrl), show that
 * photo as a circle. Otherwise, for a LOGGED-IN user, `fallbackPhoto`
 * (the developer photo "/avatar.jpg", passed by the caller) is used
 * as the default avatar — never for guests, who keep the neutral
 * grey "?". If no photo at all, generate initials (first letters of
 * the first two words, or the first two letters) in white/dark text
 * on a deterministic colour picked from the name. If a photo fails
 * to load, fall back to initials — an uploaded photo is never
 * replaced by the fallback photo.
 * The AI's avatar (Samim's real photo, /avatar.jpg) is separate and
 * is NOT touched by this component.
 */
"use client";

import { useEffect, useState } from "react";

const PALETTE: { bg: string; fg: string }[] = [
  { bg: "#2457FF", fg: "#FFFFFF" },
  { bg: "#00D4FF", fg: "#08222E" },
  { bg: "#a855f7", fg: "#FFFFFF" },
  { bg: "#22c55e", fg: "#FFFFFF" },
  { bg: "#f97316", fg: "#FFFFFF" },
  { bg: "#facc15", fg: "#111827" },
];

export function initialsOf(name?: string | null, email?: string | null): string {
  const clean = (name ?? "").trim();
  if (clean) {
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }
  const prefix = (email ?? "").split("@")[0].trim();
  if (prefix) return prefix.slice(0, 2).toUpperCase();
  return "?";
}

function colorFor(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export default function UserAvatar({
  name,
  email,
  photoUrl,
  fallbackPhoto,
  size = 32,
  className = "",
}: {
  name?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  /** Default photo for a LOGGED-IN user with no uploaded photo
   * (pass "/avatar.jpg"). Callers must NOT pass this for guests. */
  fallbackPhoto?: string | null;
  size?: number;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // A newly chosen photo retries loading (e.g. changed in Settings).
  useEffect(() => {
    setImgFailed(false);
  }, [photoUrl, fallbackPhoto]);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  // An uploaded photo always wins; the fallback only applies when
  // there is no uploaded photo at all.
  const src = !imgFailed ? (photoUrl ?? fallbackPhoto ?? null) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? email ?? "User"}
        width={size}
        height={size}
        style={style}
        onError={() => setImgFailed(true)}
        className={`shrink-0 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      />
    );
  }
  const initials = initialsOf(name, email);
  const isGuest = initials === "?";
  const color = isGuest ? { bg: "#64748B", fg: "#FFFFFF" } : colorFor(`${name ?? ""}|${email ?? ""}`);
  return (
    <span
      aria-label={name ?? email ?? "Guest"}
      style={{ ...style, backgroundColor: color.bg, color: color.fg }}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ${className}`}
    >
      {initials}
    </span>
  );
}
