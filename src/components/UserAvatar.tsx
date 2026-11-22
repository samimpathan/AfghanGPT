/**
 * UserAvatar — the user's own avatar, like Muse shows it.
 * If the user set a profile photo (Settings → Profile photo, stored
 * as a downscaled data URL in settings.avatarDataUrl), show that
 * photo as a circle. Otherwise generate an avatar from their name:
 * initials (first letters of the first two words, or the first two
 * letters) in white/dark text on a deterministic colour picked from
 * the name. Guests (no name, no email) get a neutral grey "?" —
 * never a fake photo, never another person's photo.
 * The AI's avatar (Samim's real photo, /avatar.jpg) is separate and
 * is NOT touched by this component.
 */

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
  size = 32,
  className = "",
}: {
  name?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name ?? email ?? "User"}
        width={size}
        height={size}
        style={style}
        className={`shrink-0 rounded-full object-cover ${className}`}
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
