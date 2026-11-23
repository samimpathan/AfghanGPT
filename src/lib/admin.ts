/**
 * lib/admin.ts — who is the admin of AfghanGPT.
 * The admin is Samim Pathan ONLY, by email. No password or key is
 * stored here — the check is only an email comparison, and the real
 * authentication is still Supabase Auth (the user must be logged in).
 */
export const ADMIN_EMAIL = "samimpatan8@gmail.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}
