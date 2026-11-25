/**
 * app/signup/page.tsx — renders the same "Log in or sign up"
 * wizard as /login and /register (there is no separate
 * password-creation signup any more: new accounts are created
 * by email/phone OTP or Google, then Full name + Age).
 * Keeping the /signup URL avoids a 404 on the standard sign-up
 * address; all three routes serve the identical flow.
 * Founder order 2026-11-25 22:44: /signup returned 404 on the
 * live preview — it must be a real working route, not a fake page.
 */
import AuthWizard from "@/components/AuthWizard";

export default function SignupPage() {
  return <AuthWizard />;
}
