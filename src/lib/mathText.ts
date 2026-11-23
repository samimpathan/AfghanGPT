/**
 * lib/mathText.ts — render LaTeX math as readable plain text.
 *
 * Gemini often answers science questions with LaTeX, e.g.
 *   $$\text{6CO}_2 + \text{6H}_2\text{O} + \text{Light Energy}
 *    \rightarrow \text{C}_6\text{H}_{12}\text{O}_6 + \text{6O}_2$$
 * KaTeX is NOT installed (and adding a math renderer + fonts is
 * heavy for one display case), so the markdown renderers run every
 * message through stripMathDelimiters() first: code blocks and
 * inline code are protected, math delimiters are removed, and the
 * math itself is converted to readable Unicode text, e.g.
 *   6CO₂ + 6H₂O + Light Energy → C₆H₁₂O₆ + 6O₂
 * A plain-text equation is always better than raw "$$...$$" in a
 * chat bubble. Unknown commands degrade gracefully (the command
 * name is dropped, its braced content kept).
 */

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", i: "ᵢ", j: "ⱼ",
  k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", r: "ᵣ", s: "ₛ",
  t: "ₜ", u: "ᵤ", v: "ᵥ", "β": "ᵦ", "γ": "ᵧ", "χ": "ᵪ",
};

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ",
  h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ",
  o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ",
  w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ", "β": "ᵝ", "γ": "ᵞ",
  "θ": "ᶿ", "φ": "ᵠ", "χ": "ᵡ",
};

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ",
  epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", Theta: "Θ",
  iota: "ι", kappa: "κ", lambda: "λ", Lambda: "Λ", mu: "μ",
  nu: "ν", xi: "ξ", pi: "π", Pi: "Π", rho: "ρ", sigma: "σ",
  Sigma: "Σ", tau: "τ", phi: "φ", Phi: "Φ", chi: "χ",
  psi: "ψ", Psi: "Ψ", omega: "ω", Omega: "Ω", infty: "∞",
};

const OPS: Record<string, string> = {
  rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐",
  leftrightarrow: "↔", Leftrightarrow: "⇔", to: "→",
  longrightarrow: "→", longleftarrow: "←", Longrightarrow: "⇒",
  longleftrightarrow: "↔",
  times: "×", div: "÷", pm: "±", mp: "∓", cdot: "·",
  approx: "≈", leq: "≤", geq: "≥", neq: "≠", equiv: "≡",
  sim: "~", propto: "∝", in: "∈", cup: "∪", cap: "∩",
  sum: "∑", prod: "∏", sqrt: "√",
};

/** Commands whose braced argument is plain text — keep the text. */
const TEXT_CMDS = new Set([
  "text", "mathrm", "mathbf", "mathit", "mathbb", "mathcal",
  "textrm", "textit", "textsf", "textnormal", "operatorname",
]);

/** Read a {...} group starting at s[i] === "{"; returns the inner
 * text (braces matched, nesting allowed) and the index after "}". */
function readBraced(s: string, i: number): { content: string; next: number } | null {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return { content: s.slice(i + 1, j), next: j + 1 };
    }
  }
  return null;
}

function mapChars(s: string, map: Record<string, string>): string {
  // split("") not [...s]: the project tsconfig targets below
  // ES2015, where spreading a string needs downlevelIteration.
  // All mapped characters are BMP, so code-unit split is exact.
  return s.split("").map((c) => map[c] ?? c).join("");
}

/** Convert one LaTeX math fragment (no $ delimiters) to plain text. */
export function mathToPlainText(latex: string): string {
  let out = "";
  let i = 0;
  while (i < latex.length) {
    const ch = latex[i];
    if (ch === "\\") {
      const next = latex[i + 1] ?? "";
      // Command name: letters, or one non-letter character.
      const m = /^[a-zA-Z]+/.exec(latex.slice(i + 1));
      if (m) {
        const cmd = m[0];
        i += 1 + cmd.length;
        if (TEXT_CMDS.has(cmd)) {
          const g = latex[i] === "{" ? readBraced(latex, i) : null;
          if (g) {
            out += mathToPlainText(g.content);
            i = g.next;
          }
        } else if (cmd === "frac") {
          const a = latex[i] === "{" ? readBraced(latex, i) : null;
          const b = a && latex[a.next] === "{" ? readBraced(latex, a.next) : null;
          if (a && b) {
            out += `${mathToPlainText(a.content)}/${mathToPlainText(b.content)}`;
            i = b.next;
          } else if (a) {
            out += mathToPlainText(a.content);
            i = a.next;
          }
        } else if (cmd === "sqrt") {
          // Optional [n] root index, then the radicand.
          if (latex[i] === "[") {
            const close = latex.indexOf("]", i);
            if (close !== -1) i = close + 1;
          }
          const g = latex[i] === "{" ? readBraced(latex, i) : null;
          if (g) {
            out += `√(${mathToPlainText(g.content)})`;
            i = g.next;
          } else {
            out += "√";
          }
        } else if (cmd === "xrightarrow" || cmd === "xleftarrow" ||
          cmd === "xleftrightarrow" || cmd === "xRightarrow" ||
          cmd === "xLeftarrow" || cmd === "xLeftrightarrow") {
          // Extensible arrow: \xrightarrow[below]{above} — the label
          // sits ABOVE the arrow in LaTeX. In plain text the label
          // goes before the arrow: "above →" (below-label, if any,
          // follows in parentheses). Without this branch the command
          // fell into "unknown command" and the arrow vanished while
          // the label survived — the photosynthesis equation lost
          // its → (2026-11-23 browser test).
          const arrow: Record<string, string> = {
            xrightarrow: "→", xleftarrow: "←", xleftrightarrow: "↔",
            xRightarrow: "⇒", xLeftarrow: "⇐", xLeftrightarrow: "⇔",
          };
          let below = "";
          if (latex[i] === "[") {
            const close = latex.indexOf("]", i);
            if (close !== -1) {
              below = latex.slice(i + 1, close);
              i = close + 1;
            }
          }
          const g = latex[i] === "{" ? readBraced(latex, i) : null;
          if (g) {
            const label = mathToPlainText(g.content);
            out += label ? `${label} ${arrow[cmd]}` : arrow[cmd];
            if (below) out += ` (${mathToPlainText(below)})`;
            i = g.next;
          } else {
            out += arrow[cmd];
          }
        } else if (GREEK[cmd]) {
          out += GREEK[cmd];
        } else if (OPS[cmd]) {
          out += OPS[cmd];
        } else {
          // Unknown command: drop the name, keep a braced argument.
          const g = latex[i] === "{" ? readBraced(latex, i) : null;
          if (g) {
            out += mathToPlainText(g.content);
            i = g.next;
          }
        }
      } else if (next) {
        // Single-character escape: \{ \} \$ \% \& \, \; \: \space.
        if (next === " " || next === "," || next === ";" || next === ":") out += " ";
        else if (next === "\\") out += " ";
        else out += next;
        i += 2;
      } else {
        i += 1;
      }
    } else if (ch === "_" || ch === "^") {
      const map = ch === "_" ? SUB : SUP;
      if (latex[i + 1] === "{") {
        const g = readBraced(latex, i + 1);
        if (g) {
          out += mapChars(mathToPlainText(g.content), map);
          i = g.next;
        } else {
          i += 1;
        }
      } else if (latex[i + 1]) {
        out += map[latex[i + 1]] ?? latex[i + 1];
        i += 2;
      } else {
        i += 1;
      }
    } else if (ch === "{" || ch === "}") {
      i += 1; // grouping braces only
    } else if (ch === "~") {
      out += " ";
      i += 1;
    } else if (ch === "&") {
      out += " "; // alignment separator in matrices / aligned blocks
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%)\]}])/g, "$1")
    .replace(/([(\\[{])\s+/g, "$1")
    .trim();
}

/** Does "$...$" content look like math (not money)? A math
 * fragment has a backslash command, a sub/superscript, braces, or
 * a letter next to an operator — "$5.99" and "$10" do not. */
function looksLikeMath(inner: string): boolean {
  if (/[\\_^]/.test(inner)) return true;
  if (inner.includes("{") || inner.includes("}")) return true;
  return /[a-zA-Zα-ωΑ-Ω]/.test(inner) && /[=<>+\-*/]/.test(inner);
}

function convertMathInText(part: string): string {
  let s = part;
  // Block math first (longest delimiters), then \[...\], \(...\),
  // then inline $...$ guarded by looksLikeMath. The replacement
  // adds a space only when the neighbouring character is not
  // already whitespace, so "a $$x$$ b" never becomes "a  x  b".
  const pad = (t: string, matchLen: number, offset: number, whole: string): string => {
    if (!t) return "";
    const before = offset > 0 ? whole[offset - 1] : " ";
    const after = whole[offset + matchLen] ?? "";
    return `${/\s/.test(before) ? "" : " "}${t}${/\s/.test(after) ? "" : " "}`;
  };
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, inner: string, offset: number, whole: string) =>
    pad(mathToPlainText(inner), m.length, offset, whole)
  );
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, inner: string, offset: number, whole: string) =>
    pad(mathToPlainText(inner), m.length, offset, whole)
  );
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, inner: string, offset: number, whole: string) =>
    pad(mathToPlainText(inner), m.length, offset, whole)
  );
  s = s.replace(/\$([^$\n]+?)\$/g, (m, inner: string) =>
    looksLikeMath(inner) ? mathToPlainText(inner) : m
  );
  return s;
}

/**
 * Remove LaTeX math delimiters from markdown text and convert the
 * math to readable plain text. Fenced code blocks (```...```) and
 * inline code spans (`...`) are left completely untouched, so a
 * code sample that mentions "$" or "$$" is never rewritten.
 */
export function stripMathDelimiters(text: string): string {
  // Odd indices are fenced code blocks (the capture group).
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      // Odd indices are inline code spans.
      return part
        .split(/(`[^`\n]+`)/g)
        .map((p, j) => (j % 2 === 1 ? p : convertMathInText(p)))
        .join("");
    })
    .join("");
}
