/**
 * lib/studios.ts — the 8 merged studios (from the AfghanGPT studios).
 * The single home of this list: the /explore page renders it, and
 * the chat sidebar used to render it too (before the Explore move,
 * 2026-11-25). Each entry carries its i18n label key, its i18n
 * subtitle key, its icon and the settings feature flag that hides it.
 */
import type { IconName } from "@/components/icons";

export type Studio = {
  href: string;
  key: string;
  subtitle: string;
  icon: IconName;
  feature: string;
};

export const STUDIOS: Studio[] = [
  { href: "/studio/write", key: "writing", subtitle: "writeSubtitle", icon: "pencil", feature: "writing" },
  { href: "/studio/code", key: "coding", subtitle: "codeSubtitle", icon: "code", feature: "coding" },
  { href: "/studio/builder", key: "builder", subtitle: "builderSubtitle", icon: "layers", feature: "builder" },
  { href: "/studio/image", key: "image", subtitle: "imageSubtitle", icon: "image", feature: "image" },
  { href: "/studio/slides", key: "slides", subtitle: "slidesSubtitle", icon: "presentation", feature: "slides" },
  { href: "/studio/docs", key: "docs", subtitle: "docsSubtitle", icon: "fileText", feature: "docs" },
  { href: "/research", key: "research", subtitle: "researchSubtitle", icon: "search", feature: "research" },
  { href: "/studio/workflows", key: "workflows", subtitle: "workflowsSubtitle", icon: "workflow", feature: "workflows" },
];
