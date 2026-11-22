"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { dirOf, type Lang, type Theme } from "@/lib/i18n";

type UiCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const Ctx = createContext<UiCtx>({
  lang: "ps",
  setLang: () => {},
  theme: "light",
  setTheme: () => {},
});

export function useUi() {
  return useContext(Ctx);
}

export default function Providers({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("ps");
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem("samim-ai-lang") as Lang | null;
      const savedTheme = localStorage.getItem("samim-ai-theme") as Theme | null;
      if (savedLang && ["ps", "en", "fa", "ar"].includes(savedLang)) setLang(savedLang);
      if (savedTheme && ["light", "dark"].includes(savedTheme)) setTheme(savedTheme);
    } catch {
      // ignore
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("samim-ai-lang", lang);
      localStorage.setItem("samim-ai-theme", theme);
    } catch {
      // ignore
    }
  }, [lang, theme, ready]);

  return (
    <Ctx.Provider value={{ lang, setLang, theme, setTheme }}>
      {children}
    </Ctx.Provider>
  );
}
