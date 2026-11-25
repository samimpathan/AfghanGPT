/**
 * UserAvatar — the user's own avatar, like Muse shows it.
 * If the user set a profile photo (Settings → Profile photo, stored
 * as a downscaled data URL in settings.avatarDataUrl), show that
 * photo as a circle. Otherwise, for a LOGGED-IN user, `fallbackPhoto`
 * (the developer photo "/avatar.jpg", passed by the caller) is used
 * as the default avatar — never for guests, who keep the neutral
 * grey "?" on a soft grey gradient. If no photo at all, generate
 * initials (first letters of the first two words, or the first two
 * letters) in white on a rich multi-stop GRADIENT picked
 * deterministically from the name/email — or the gradient the user
 * chose in Settings (settings.avatarGradient, prop `gradientId`).
 * Every avatar — photo, founder fallback, initials, guest "?" —
 * sits inside the same thin luminous gradient ring with a soft
 * shadow, so the whole system looks like one designed piece.
 * ROUND 3C: the founder fallback ("/avatar.jpg") is a square
 * portrait with a large centred face, so it renders through the
 * face-zoom frame (.ai-avatar-frame/.ai-avatar-img in globals.css,
 * 1.8× zoom) — otherwise the head-and-shoulders crop looks loose
 * at 32–40px. An uploaded photo keeps plain object-cover.
 * An empty-string photo (Settings → Remove photo
 * stores "") means "no photo" and falls through to the fallback /
 * initials instead of rendering a broken src="".
 * If a photo fails to load, fall back to initials — an uploaded
 * photo is never replaced by the fallback photo.
 * An EXPLICITLY chosen gradient (Settings → Avatar colour,
 * prop `gradientId`) wins for EVERYONE, guests included: the "?"
 * fill and the photo ring both use it. Only Auto ("" / unknown)
 * keeps the grey guest gradient and the deterministic gradient
 * for a named user.
 * The AI's avatar (Samim's real photo, /avatar.jpg) is separate and
 * is NOT touched by this component.
 */
"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export type AvatarGradient = {
  id: string;
  /** Short English label (a colour name, used as aria-label). */
  label: string;
  /** CSS background for the initials fill AND the ring. */
  background: string;
};

/** Curated premium gradients — deep, saturated, Muse-polished.
 * Each has 3 stops so the circle never looks flat. */
export const AVATAR_GRADIENTS: AvatarGradient[] = [
  { id: "ocean", label: "Ocean", background: "linear-gradient(135deg, #2457FF 0%, #00B4FF 55%, #00D4FF 100%)" },
  { id: "violet", label: "Violet", background: "linear-gradient(135deg, #7C3AED 0%, #A855F7 55%, #EC4899 100%)" },
  { id: "emerald", label: "Emerald", background: "linear-gradient(135deg, #0F766E 0%, #10B981 55%, #34D399 100%)" },
  { id: "sunset", label: "Sunset", background: "linear-gradient(135deg, #F59E0B 0%, #F97316 50%, #F43F5E 100%)" },
  { id: "indigo", label: "Indigo", background: "linear-gradient(135deg, #1E3A8A 0%, #4F46E5 55%, #8B5CF6 100%)" },
  { id: "rose", label: "Rose", background: "linear-gradient(135deg, #BE185D 0%, #EC4899 55%, #FB7185 100%)" },
  { id: "teal", label: "Teal", background: "linear-gradient(135deg, #0E7490 0%, #06B6D4 55%, #22D3EE 100%)" },
  { id: "gold", label: "Gold", background: "linear-gradient(135deg, #92400E 0%, #D97706 50%, #FACC15 100%)" },
];

/** Guests keep "?" — on a soft grey gradient, never flat grey. */
export const GUEST_GRADIENT: AvatarGradient = {
  id: "guest",
  label: "Guest",
  background: "linear-gradient(135deg, #94A3B8 0%, #64748B 55%, #475569 100%)",
};

/** The "Auto" swatch in Settings: every hue at once, so it reads
 * as "pick for me" instead of one more colour. */
export const AUTO_GRADIENT_BACKGROUND =
  "conic-gradient(from 210deg, #2457FF, #A855F7, #EC4899, #F97316, #FACC15, #22C55E, #00D4FF, #2457FF)";

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

/** Deterministic gradient for a user — same name/email, same style. */
export function gradientFor(seed: string): AvatarGradient {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function gradientById(id?: string | null): AvatarGradient | null {
  if (!id) return null;
  return AVATAR_GRADIENTS.find((g) => g.id === id) ?? null;
}

export default function UserAvatar({
  name,
  email,
  photoUrl,
  fallbackPhoto,
  gradientId,
  size = 32,
  className = "",
}: {
  name?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  /** Default photo for a LOGGED-IN user with no uploaded photo
   * (pass "/avatar.jpg"). Callers must NOT pass this for guests. */
  fallbackPhoto?: string | null;
  /** Chosen gradient (settings.avatarGradient). Empty/unknown =
   * automatic — the deterministic gradient for this user. */
  gradientId?: string | null;
  size?: number;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // A newly chosen photo retries loading (e.g. changed in Settings).
  useEffect(() => {
    setImgFailed(false);
  }, [photoUrl, fallbackPhoto]);
  const initials = initialsOf(name, email);
  const isGuest = initials === "?";
  // One personal gradient drives BOTH the initials fill and the
  // luminous ring — photos get the same ring, so the system is one.
  // An EXPLICITLY chosen gradient wins for everyone, guests
  // included (their "?" fill and photo ring use it too) — the old
  // code hardcoded grey for guests here, so a picked Violet/Sunset
  // never rendered anywhere (2026-11-23 browser test). Only Auto
  // (""/unknown) keeps the old behaviour: the deterministic
  // gradient for a named user, soft grey for a guest.
  const gradient =
    gradientById(gradientId) ??
    (isGuest ? GUEST_GRADIENT : gradientFor(`${name ?? ""}|${email ?? ""}`));
  const ring = size >= 64 ? 3 : 2;
  const fontSize = Math.max(10, Math.round(size * 0.38));
  // An empty-string photo means "no photo" (see header comment).
  const cleanPhoto = photoUrl && photoUrl.trim() ? photoUrl : null;
  // An uploaded photo always wins; the fallback only applies when
  // there is no uploaded photo at all.
  const src = !imgFailed ? (cleanPhoto ?? fallbackPhoto ?? null) : null;
  // The founder fallback is the square founder portrait — zoom to
  // the face; an uploaded photo is shown as-is.
  const isFounderFallback = !cleanPhoto && !!fallbackPhoto;

  const ringStyle: CSSProperties = {
    width: size,
    height: size,
    background: gradient.background,
    padding: ring,
    borderRadius: 9999,
    // Soft drop shadow + a faint white hairline inside the ring edge
    // — the "polished" lift Muse's avatar has, in light and dark.
    boxShadow:
      "0 4px 14px rgba(15, 23, 42, 0.22), 0 1px 3px rgba(15, 23, 42, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.22)",
  };

  if (src) {
    if (isFounderFallback) {
      return (
        <span style={ringStyle} className={`inline-flex shrink-0 select-none ${className}`}>
          <span style={{ width: "100%", height: "100%" }} className="ai-avatar-frame">
            <img
              src={src}
              alt={name ?? email ?? "User"}
              width={size}
              height={size}
              onError={() => setImgFailed(true)}
              className="ai-avatar-img"
            />
          </span>
        </span>
      );
    }
    return (
      <span style={ringStyle} className={`inline-flex shrink-0 select-none ${className}`}>
        <img
          src={src}
          alt={name ?? email ?? "User"}
          width={size}
          height={size}
          style={{ width: "100%", height: "100%" }}
          onError={() => setImgFailed(true)}
          className="shrink-0 rounded-full object-cover"
        />
      </span>
    );
  }
  return (
    <span style={ringStyle} className={`inline-flex shrink-0 select-none ${className}`}>
      <span
        aria-label={name ?? email ?? "Guest"}
        style={{
          width: "100%",
          height: "100%",
          background: gradient.background,
          color: "#FFFFFF",
          fontSize,
          textShadow: "0 1px 2px rgba(0, 0, 0, 0.30)",
        }}
        className="inline-flex items-center justify-center rounded-full font-bold"
      >
        {initials}
      </span>
    </span>
  );
}
