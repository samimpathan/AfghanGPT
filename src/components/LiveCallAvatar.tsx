"use client";

import { useState } from "react";
import Image from "next/image";
import { type LiveAvatarState } from "@/lib/liveAvatar";

/**
 * LiveCallAvatar — the LIVE-CALL avatar system, INDEPENDENT from the
 * chat avatar (WritingHero in src/app/page.tsx). Different component,
 * different state, no shared timers: this component owns the
 * live-call stage, its loading state and its speaking/listening
 * state, and is driven only by the `speaking` prop, which
 * LiveCall.tsx sets from the AI's REAL audio state (playPcmChunk
 * while Live API audio plays; TTS callbacks on the fallback path;
 * cleared when the audio ends or the turn is interrupted).
 *
 * ENGINE: PHOTO_ENGINE (see src/lib/liveAvatar.ts) — the founder's
 * real seated photo, whole figure, no zoom, no crop, no fake lip
 * sync / blinking / gestures. The photo's mouth is closed and
 * still while the AI speaks; the orb's pulse is a speaking
 * INDICATOR (the container breathes), never a mouth animation.
 *
 * FRAMING (founder correction 2026-11-25): SEATED, head to knees,
 * exactly like /avatar.jpg (blue shirt + black checkered vest,
 * both arms, hands clasped). NO feet — the "head to toe" wording
 * was a mistake, and no feet exist in the source files. The BIG
 * stage shows the whole seated figure in a square frame
 * (object-fit contain, no transform). The small variant is a 36px
 * circular status indicator — a chip, not the avatar display.
 * The loading placeholder holds the stage until the real photo
 * arrives, so the stage never sits empty on weak internet.
 */
export function LiveCallAvatar({
  speaking,
  small = false,
}: {
  speaking: boolean;
  small?: boolean;
}) {
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const state: LiveAvatarState = small
    ? speaking
      ? "speaking"
      : "listening"
    : !avatarLoaded
      ? "loading"
      : speaking
        ? "speaking"
        : "listening";
  return (
    <div
      data-testid="live-call-avatar"
      data-state={state}
      className={`voice-orb flex items-center justify-center rounded-full ${
        small ? "h-20 w-20" : "h-72 w-72 sm:h-80 sm:w-80"
      } ${speaking ? "voice-orb-speaking" : ""}`}
    >
      {small ? (
        <span className="ai-avatar-frame h-9 w-9 ring-4 ring-white/60">
          <Image
            src="/avatar.jpg"
            alt="AfghanGPT"
            width={36}
            height={36}
            className="ai-avatar-img"
            priority
          />
        </span>
      ) : (
        <span className="ai-avatar-stage h-56 w-56 ring-4 ring-white/60 sm:h-64 sm:w-64">
          {!avatarLoaded && (
            <span
              aria-hidden
              data-testid="avatar-loading"
              className="absolute inset-0 animate-pulse bg-white/40"
            />
          )}
          <Image
            src="/avatar.jpg"
            alt="AfghanGPT"
            width={256}
            height={256}
            className="ai-avatar-stage-img"
            priority
            onLoadingComplete={() => setAvatarLoaded(true)}
          />
        </span>
      )}
    </div>
  );
}
