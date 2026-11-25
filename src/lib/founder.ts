/**
 * lib/founder.ts — the ONE central founder profile for AfghanGPT.
 * Official founder identity (user-provided 2026-11-23; corrected
 * 2026-11-23 20:15 — the official spelling is "Niazai", single "a").
 * Used by: the Gemini system prompt (src/lib/gemini.ts), the offline
 * brain founder answers (src/lib/offlineBrain.ts) and the About page
 * (src/app/about/page.tsx). Never invent awards, degrees, employment
 * or achievements here — only what the founder stated.
 */

export const FOUNDER = {
  fullName: "Abdul Samim Niazai",
  pashtoName: "عبدالصمیم نیازی",
  shortName: "Samim Pathan",
  pashtoShortName: "صمیم پټان",
  titles: ["Founder", "Creator", "Web Developer", "Programmer", "Technology Enthusiast"],
  country: "Afghanistan",
  province: "Laghman",
  district: "Alingar",
  education: {
    university: "Urozgan University",
    faculty: "Faculty of Computer Science",
    semester: "Third Semester",
  },
  // NOTE: the official spec lists NO CSS value — CSS is deliberately
  // left out of this profile. Do NOT invent a number for it.
  skills: [
    { name: "HTML", level: 95 },
    { name: "JavaScript", level: 90 },
    { name: "Bootstrap", level: 95 },
    { name: "jQuery", level: 75 },
    { name: "C++", level: 70 },
    { name: "Python", level: 65 },
    { name: "Java", level: 60 },
  ],
  interests: [
    "AI",
    "programming",
    "web development",
    "software engineering",
    "technology & innovation",
    "building useful digital products",
  ],
  vision:
    "A multilingual assistant for Pashto, Dari and English users — built by an Afghan, for the world.",
  philosophy:
    "Programming is not just writing code. It is a way of thinking, solving problems, creating ideas, and building innovative solutions.",
  // Pashto translation of the philosophy above (translation only —
  // the official wording is the English sentence).
  philosophyPs:
    "پروګرامینګ یوازې کوډ لیکل نه دي. دا د فکر کولو، ستونزو حلولو، نظرونو جوړولو او نوښتګرو حلونو جوړولو یوه لاره ده.",
  taglineEn: "Built by an Afghan, For the World.",
  taglinePs: "د افغانستان له زړه، نړۍ ته!",
} as const;

export type FounderLang = "ps" | "en" | "fa" | "ar";

/** Short bio: name, titles, location, education, what he built. */
export function founderBioShort(lang: FounderLang): string {
  if (lang === "ps") {
    return (
      "عبدالصمیم نیازی (صمیم پټان) د AfghanGPT او DevConnect بنسټګر دی.\n\n" +
      "له علینګار، لغمان، افغانستان څخه دی، او د ارزګان پوهنتون د کمپیوټر ساینس درېیم سمستر زده‌کوونکی دی. " +
      "هغه بنسټګر، جوړوونکی، ویب ډیولپر، پروګرامر او د ټکنالوژۍ مینه‌وال دی."
    );
  }
  if (lang === "fa") {
    return (
      "عبدالصمیم نیازی (صمیم پټان) بنیان‌گذار AfghanGPT و DevConnect است.\n\n" +
      "از علینګار، لغمان، افغانستان است و دانشجوی سمستر سوم کمپیوټر ساینس پوهنتون ارزګان است. " +
      "او بنیان‌گذار، سازنده، توسعه‌دهنده وب، برنامه‌نویس و علاقه‌مند تکنالوژی است."
    );
  }
  if (lang === "ar") {
    return (
      "عبدالصمیم نیازی (صمیم پټان) هو مؤسس AfghanGPT وDevConnect.\n\n" +
      "من علینګار، لغمان، أفغانستان، وهو طالب في الفصل الدراسي الثالث في علوم الحاسوب في جامعة ارزګان. " +
      "وهو مؤسس ومبتكر ومطوّر ويب ومبرمج ومحب للتكنولوجيا."
    );
  }
  return (
    "Abdul Samim Niazai (Samim Pathan) is the founder of AfghanGPT and DevConnect.\n\n" +
    "He is from Alingar, Laghman, Afghanistan, and is a 3rd-semester Computer Science student at Urozgan University. " +
    "He is a Founder, Creator, Web Developer, Programmer and Technology Enthusiast."
  );
}

/** Full bio: short bio + skills, philosophy and tagline. */
export function founderBioFull(lang: FounderLang): string {
  const short = founderBioShort(lang);
  const skillsLine = FOUNDER.skills.map((s) => `${s.name} ${s.level}%`).join(", ");
  if (lang === "ps") {
    return (
      short +
      "\n\nد هغه مهارتونه: " +
      skillsLine +
      ".\n\nهغه له AI، پروګرامینګ، ویب جوړونې، سافټویر انجینرۍ او نوې ټکنالوژۍ سره مینه لري، او ګټور ډیجیټل محصولات جوړوي. " +
      "د هغه فلسفه: «" +
      FOUNDER.philosophy +
      "»\n\n" +
      FOUNDER.taglinePs +
      " (" +
      FOUNDER.taglineEn +
      ")"
    );
  }
  if (lang === "fa") {
    return (
      short +
      "\n\nمهارت‌های او: " +
      skillsLine +
      ".\n\nاو به هوش مصنوعی، برنامه‌نویسی، توسعه وب، مهندسی نرم‌افزار و تکنالوژی نوین علاقه دارد و محصولات دیجیتال مفید می‌سازد. " +
      "فلسفه او: «" +
      FOUNDER.philosophy +
      "»\n\n" +
      FOUNDER.taglineEn
    );
  }
  if (lang === "ar") {
    return (
      short +
      "\n\nمهاراته: " +
      skillsLine +
      ".\n\nوهو مهتم بالذكاء الاصطناعي والبرمجة وتطوير الويب وهندسة البرمجيات والتكنولوجيا الحديثة، ويبني منتجات رقمية مفيدة. " +
      "فلسفته: «" +
      FOUNDER.philosophy +
      "»\n\n" +
      FOUNDER.taglineEn
    );
  }
  return (
    short +
    "\n\nHis skills: " +
    skillsLine +
    ".\n\nHe loves AI, programming, web development, software engineering and new technology, and builds useful digital products. " +
    'His philosophy: "' +
    FOUNDER.philosophy +
    '"\n\n' +
    FOUNDER.taglineEn
  );
}

/** Founder facts for the online AI's system prompt (English). */
export function founderPromptBlock(): string {
  return [
    `Your creator is ${FOUNDER.fullName} (${FOUNDER.shortName}), ${FOUNDER.titles.join(", ")}.`,
    `His name in Pashto is "عبدالصمیم نیازی" — always spell it exactly like this, never "عبدالسمیع" or any other spelling.`,
    `Always spell his name exactly "Abdul Samim Niazai" in Latin letters, never "Abdul Sami".`,
    `He is from ${FOUNDER.district}, ${FOUNDER.province}, ${FOUNDER.country}, and is a ${FOUNDER.education.semester} ${FOUNDER.education.faculty} student at ${FOUNDER.education.university}.`,
    `His skills: ${FOUNDER.skills.map((s) => `${s.name} ${s.level}%`).join(", ")}.`,
    `His interests: ${FOUNDER.interests.join(", ")}.`,
    `His philosophy: "${FOUNDER.philosophy}"`,
    `His tagline: "${FOUNDER.taglineEn}"`,
    "You are the AI he built — never confuse the founder with yourself, and never claim to be him.",
  ].join("\n");
}
