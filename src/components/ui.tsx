/**
 * components/ui.tsx — shared studio primitives (dark/light aware).
 */
"use client";

import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`studio-card p-4 sm:p-5 ${className}`}>{children}</div>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md";
};

export function Btn({ variant = "primary", size = "md", className = "", ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-95 disabled:opacity-50 disabled:pointer-events-none";
  const sizes = size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-sm";
  const variants: Record<string, string> = {
    primary: "text-white bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-500 hover:opacity-90",
    ghost: "bg-transparent hover:bg-black/5 dark:hover:bg-white/10",
    danger: "bg-red-600 text-white hover:bg-red-700",
    outline: "border border-[var(--card-border)] hover:bg-black/5 dark:hover:bg-white/5",
  };
  return <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...rest} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-violet-500 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-violet-500 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2.5 text-sm outline-none focus:border-violet-500 ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function Badge({ children, tone = "violet" }: { children: ReactNode; tone?: "violet" | "green" | "red" | "amber" | "cyan" }) {
  const tones: Record<string, string> = {
    violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    red: "bg-red-500/15 text-red-600 dark:text-red-300",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    cyan: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
