/**
 * app/register/page.tsx — renders the same "Log in or sign up"
 * wizard as /login (there is no separate password-creation signup
 * any more: new accounts are created by email/phone OTP or Google,
 * then Full name + Age). Keeping the /register URL avoids breaking
 * existing links; both routes serve the identical flow.
 */
import AuthWizard from "@/components/AuthWizard";

export default function RegisterPage() {
  return <AuthWizard />;
}
