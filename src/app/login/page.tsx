/**
 * app/login/page.tsx — the single "Log in or sign up" wizard.
 *
 * One flow handles both login and signup (email OTP, phone OTP,
 * Google OAuth, password for existing accounts, then Full name +
 * Age for new accounts). See components/AuthWizard.tsx.
 * Existing logged-in sessions keep working: the wizard detects a
 * signed-in user on mount and routes complete accounts home.
 */
import AuthWizard from "@/components/AuthWizard";

export default function LoginPage() {
  return <AuthWizard />;
}
