/**
 * lib/countries.ts — country dial codes for the phone sign-in step.
 *
 * The phone step asks for the country FIRST, then the number
 * (owner's rule: "whichever country, first country then number").
 * Afghanistan (+93) is the default. Country names are proper nouns
 * shown in English, like the reference flow; the dial code is what
 * the form uses. Numbers are normalised to E.164 in AuthWizard
 * (leading 0 stripped, e.g. 0789… → +93789…).
 */
export type CountryDial = { code: string; name: string; dial: string };

export const COUNTRY_DIALS: CountryDial[] = [
  { code: "AF", name: "Afghanistan", dial: "+93" },
  { code: "PK", name: "Pakistan", dial: "+92" },
  { code: "IR", name: "Iran", dial: "+98" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "BD", name: "Bangladesh", dial: "+880" },
  { code: "TR", name: "Türkiye", dial: "+90" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "IQ", name: "Iraq", dial: "+964" },
  { code: "KW", name: "Kuwait", dial: "+965" },
  { code: "QA", name: "Qatar", dial: "+974" },
  { code: "BH", name: "Bahrain", dial: "+973" },
  { code: "OM", name: "Oman", dial: "+968" },
  { code: "JO", name: "Jordan", dial: "+962" },
  { code: "LB", name: "Lebanon", dial: "+961" },
  { code: "SY", name: "Syria", dial: "+963" },
  { code: "EG", name: "Egypt", dial: "+20" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "NL", name: "Netherlands", dial: "+31" },
  { code: "SE", name: "Sweden", dial: "+46" },
  { code: "NO", name: "Norway", dial: "+47" },
  { code: "DK", name: "Denmark", dial: "+45" },
  { code: "FI", name: "Finland", dial: "+358" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "PT", name: "Portugal", dial: "+351" },
  { code: "PL", name: "Poland", dial: "+48" },
  { code: "RU", name: "Russia", dial: "+7" },
  { code: "UA", name: "Ukraine", dial: "+380" },
  { code: "KZ", name: "Kazakhstan", dial: "+7" },
  { code: "UZ", name: "Uzbekistan", dial: "+998" },
  { code: "TJ", name: "Tajikistan", dial: "+992" },
  { code: "TM", name: "Turkmenistan", dial: "+993" },
  { code: "KG", name: "Kyrgyzstan", dial: "+996" },
  { code: "AZ", name: "Azerbaijan", dial: "+994" },
  { code: "CN", name: "China", dial: "+86" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KR", name: "South Korea", dial: "+82" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "TH", name: "Thailand", dial: "+66" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "ZA", name: "South Africa", dial: "+27" },
];

export const DEFAULT_DIAL = "+93";

/** Normalise a local number + dial code to E.164: strip spaces,
 * dashes and a leading 0 (0789… → +93789…), never double the code. */
export function toE164(dial: string, raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const dialDigits = dial.replace(/\D/g, "");
  if (digits.startsWith(dialDigits)) return `+${digits}`;
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits) return null;
  const full = `${dialDigits}${digits}`;
  if (full.length < 7 || full.length > 15) return null;
  return `+${full}`;
}
