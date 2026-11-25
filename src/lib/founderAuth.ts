/**
 * lib/founderAuth.ts — FOUNDER-ONLY image generation (user order
 * 2026-11-25). Only the founder (Abdul Samim Niazai, logged in with
 * samimpatan8@gmail.com) may generate images. Everyone else — guest
 * or any other logged-in user — gets a refusal and an offer to have
 * a detailed image prompt written as text instead.
 *
 * SERVER-SIDE ONLY: the check verifies the caller's Supabase JWT
 * against the Auth server (supabase.auth.getUser with the anon key)
 * and compares the verified email with the admin/founder email.
 * There is no service_role key in this app and none is needed —
 * getUser validates the token server-side. A guest sends no token
 * and is refused, because without a verified login the app cannot
 * know it is the founder. Fail closed: any error means non-founder.
 * The client sends its session access token as
 * `Authorization: Bearer <token>` on the image paths (see
 * lib/client.ts, app/page.tsx, components/LiveCall.tsx and the
 * Studio pages).
 */
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "./admin";
import type { Lang } from "./i18n";

/** The refusal text in all 4 languages. The Pashto text is the
 * founder's exact wording (2026-11-25) — do not rephrase it. The
 * other three are faithful translations of the same message, with
 * the same six categories (nature, culture, people, clothes, food,
 * historical place). The Studio pages use the same strings through
 * i18n key "imageFounderOnly" — keep both copies identical. */
export const FOUNDER_IMAGE_REFUSAL: Record<Lang, string> = {
  ps: "زه په دې چټ کې انځور/عکس نه شم جوړولی — زه یوازې متن لیکم. خو که وغواړې، زه تا لپاره د عکس مفصل توصیف (پرامپټ) لیکلی شم چې په هر عکس جوړوونکي اپ کې یې وکاروې. وایه چې کوم ډول عکس غواړې: طبیعت، کولتور، خلک، جامه، خواړه، یا تاریخي ځای — بیا به دقیق پرامپټ درکړم.",
  en: "I can't create images in this chat — I only write text. But if you'd like, I can write a detailed description (prompt) of the image for you, which you can use in any image-making app. Tell me what kind of image you want: nature, culture, people, clothes, food, or a historical place — then I'll give you an exact prompt.",
  fa: "من در این چت نمی‌توانم تصویر/عکس بسازم — من فقط متن می‌نویسم. اما اگر بخواهی، می‌توانم توصیف مفصل (پرامپټ) تصویر را برایت بنویسم تا در هر اپ ساخت تصویر از آن استفاده کنی. بگو چه نوع تصویری می‌خواهی: طبیعت، فرهنگ، مردم، لباس، غذا، یا مکان تاریخی — بعد برایت پرامپټ دقیق می‌نویسم.",
  ar: "لا أستطيع إنشاء صور في هذه المحادثة — أنا أكتب النصوص فقط. لكن إذا أردت، يمكنني أن أكتب لك وصفًا مفصلًا (برومبت) للصورة لتستخدمه في أي تطبيق لصنع الصور. قل لي ما نوع الصورة التي تريدها: طبيعة، ثقافة، أشخاص، ملابس، طعام، أو مكان تاريخي — وسأعطيك برومبتًا دقيقًا.",
};

/** Which language to refuse in, from the request text. Pashto-only
 * letters first (ټ ډ ړ ږ ښ ڼ ې ګ څ ځ), then Dari's ی/ک, then any
 * other Arabic script (Arabic), else English. A Pashto request
 * almost always contains a Pashto-only letter (e.g. ړ in کړه). */
export function detectRefusalLang(text: string): Lang {
  if (/[ټډړږښڼېګڅځ]/.test(text)) return "ps";
  if (/[یک]/.test(text)) return "fa";
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "ar";
  return "en";
}

/** The refusal text in the language of the request. */
export function refusalTextFor(text: string): string {
  return FOUNDER_IMAGE_REFUSAL[detectRefusalLang(text)];
}

/** True only when the request carries a valid Supabase session
 * token for the founder's account (samimpatan8@gmail.com). */
export async function isFounderRequest(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  try {
    const supabase = createClient(url, anonKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.email) return false;
    return isAdminEmail(data.user.email);
  } catch {
    return false;
  }
}
