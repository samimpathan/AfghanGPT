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
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2457FF] active:scale-95 disabled:opacity-50 disabled:pointer-events-none";
  const sizes = size === "sm" ? "min-h-11 px-3 py-2 text-sm" : "px-4 py-2.5 text-sm";
  const variants: Record<string, string> = {
    // Solid brand colour — no gradients in the core design system.
    primary: "text-white bg-[#2457FF] hover:bg-[#1a46d6] dark:bg-[#3b82f6] dark:hover:bg-[#2563eb]",
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
      className={`w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-[#2457FF] focus:ring-2 focus:ring-[#2457FF]/25 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-[#2457FF] focus:ring-2 focus:ring-[#2457FF]/25 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-[#2457FF] focus:ring-2 focus:ring-[#2457FF]/25 ${props.className ?? ""}`}
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

export function IconButton({
  label,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`btn-icon ${className}`} {...rest} />
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent" />
      {label}
    </div>
  );
}

export function Badge({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "red" | "amber" | "cyan" }) {
  const tones: Record<string, string> = {
    // "blue" is the brand tone (single brand colour #2457FF); the other
    // tones are semantic status colours, not brand usage.
    blue: "bg-[var(--brand)]/15 text-[var(--brand)]",
    green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    red: "bg-red-500/15 text-red-600 dark:text-red-300",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    cyan: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
