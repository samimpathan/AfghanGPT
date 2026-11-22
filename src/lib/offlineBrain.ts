/**
 * lib/offlineBrain.ts — Offline fallback brain for Samim AI.
 * Expanded from ~/workspace/samim-ai-app/lib/assistant.ts.
 * NO internet needed for its built-in topic replies. Answers in
 * simple Pashto (or English when the question is in English).
 * Its fallback never mentions a key — it just says honestly that
 * the answer was not found and suggests asking differently.
 */

export function normalize(input: string): string {
  return input
    .trim()
    // Keyboard-proof: Pashto typed with an Arabic keyboard uses ي/ك
    // (U+064A/U+0643) where Pashto uses ی/ک — fold them so matching
    // works whichever keyboard the user typed with.
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[؟?!.,،؛:()«»"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (text: string, ...words: string[]): boolean =>
  words.some((w) => text.includes(w));

export function isPashto(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(text);
}

/** ROUND 5 — safe mental maths, no eval(): a tiny recursive-descent
 * parser for + - * / % ^ ( ) and decimals. Returns null unless the
 * whole cleaned question is just an arithmetic expression, so
 * "What is 15 + 27?" is answered offline instead of web-searched. */
function evalArithmetic(expr: string): number | null {
  let i = 0;
  const s = expr.replace(/\s+/g, "");
  const peek = () => s[i];
  function parsePrimary(): number | null {
    if (peek() === "(") {
      i++;
      const v = parseAddSub();
      if (v === null || peek() !== ")") return null;
      i++;
      return v;
    }
    if (peek() === "-") {
      i++;
      const v = parsePrimary();
      return v === null ? null : -v;
    }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function parsePow(): number | null {
    let v = parsePrimary();
    if (v === null) return null;
    while (peek() === "^") {
      i++;
      const rhs = parsePrimary();
      if (rhs === null) return null;
      v = Math.pow(v, rhs);
    }
    return v;
  }
  function parseMulDiv(): number | null {
    let v = parsePow();
    if (v === null) return null;
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = s[i++];
      const rhs = parsePow();
      if (rhs === null) return null;
      if (op === "*") v = v * rhs;
      else if (op === "/") {
        if (rhs === 0) return null;
        v = v / rhs;
      } else v = v % rhs;
    }
    return v;
  }
  function parseAddSub(): number | null {
    let v = parseMulDiv();
    if (v === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const rhs = parseMulDiv();
      if (rhs === null) return null;
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  const v = parseAddSub();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  return v;
}

/** Maths question? "What is 15 + 27?", "12 * 8", "2^10", "100 / 4". */
function tryMathAnswer(rawInput: string): string | null {
  let q = rawInput.trim();
  // Strip question words (both languages) and a trailing "?"/"=".
  q = q
    .replace(/^(what is|what's|calculate|compute|solve|find|حساب|محاسبه|څومره کېږي|څومره|حاصل|مساوي)\s+/i, "")
    .replace(/[؟?=\s]+$/g, "")
    .replace(/x/gi, "*")
    .replace(/÷/g, "/")
    .trim();
  if (!/^[\d\s+\-*/%^().]+$/.test(q)) return null;
  if (!/\d/.test(q) || !/[+\-*/%^]/.test(q)) return null;
  const value = evalArithmetic(q);
  if (value === null) return null;
  const shown = q.replace(/\s+/g, " ").trim();
  const answer = Number.isInteger(value) ? String(value) : String(Math.round(value * 1000000) / 1000000);
  const english = !isPashto(rawInput) && /[a-zA-Z]/.test(rawInput);
  return english
    ? `${shown} = ${answer}`
    : `${shown} = ${answer}`;
}

/** Topic answer only: returns the offline brain's reply when the
 * message matches one of its built-in topics (greetings, who-are-you,
 * small talk, founder, coding topics, time/date, jokes, …), or null
 * when it has nothing specific — the caller then decides whether a
 * web search is appropriate. Never returns the honest fallback. */
export function getOfflineTopicAnswer(rawInput: string): string | null {
  const math = tryMathAnswer(rawInput);
  if (math !== null) return math;
  const text = normalize(rawInput);
  const lower = text.toLowerCase();
  const english = !isPashto(rawInput) && /[a-zA-Z]/.test(rawInput);

  // --- Who are you? ---
  if (
    has(
      text,
      "ته څوک یی",
      "ته څوک یې",
      "ستا نوم څه دی",
      "ستا نوم څه دی",
      "نوم دې څه دی",
      "څوک یې ته",
      "who are you"
    )
  ) {
    return english
      ? "My name is Abdul Samim's Assistant — Samim AI. I am Samim Pathan's AI assistant, and I help with any kind of technology — programming, websites, mobile apps, AI, databases, networking, and more."
      : "زما نوم د عبدالصمیم مرستیال دی — Samim AI. زه د صمیم پټان AI مرستیال یم، او په هر ډول ټکنالوژۍ، پروګرامینګ، ویبسایټ، موبایل اپ، AI، ډیټابیس، شبکو او نورو پوښتنو کې مرسته کوم.";
  }

  // --- How are you? ---
  if (
    has(
      text,
      "څه یم ته څه یی",
      "څه یم ته څه یې",
      "ته څنګه یې",
      "ته څنګه یی",
      "څنګه یې",
      "څنګه یی",
      "حال دې څنګه دی",
      "how are you"
    )
  ) {
    return english
      ? "I am fine, thank you for asking! 😊\n\nWhat can I do for you today?"
      : "زه هم ښه یم، مننه چې پوښتنې! 😊\n\nنن څه درته وکړم؟";
  }

  // --- Greetings ---
  // ROUND 5 fix: "hi" was matched as a SUBSTRING, so any English
  // question containing "hi" ("which", "this", "think"…) got a
  // greeting instead of a real answer. English greetings now need a
  // whole word at the start, and a greeting PLUS a real question
  // ("Hi, what is the capital of France?") is answered as a question,
  // not as small talk — the web search must still run for it.
  const greetWord = /^(hello|hi|salam)\b/.test(lower) || /^(سلام|سلامونه)/.test(text);
  const wordCount = text.split(" ").filter(Boolean).length;
  const hasQuestionWord = /\b(what|who|where|when|why|how|which)\b/.test(lower) || has(text, "څه", "څوک", "چیرته", "چېرته", "کله", "ولې", "څنګه", "کوم", "څومره");
  const greetingOnly = greetWord && (wordCount <= 5 || !hasQuestionWord);
  const pashtoGreeting = has(
    text,
    "سلام",
    "سلامونه",
    "سهار مو پخیر",
    "سهار مو بخیر",
    "ښه شپه",
    "مازدیګر مو پخیر"
  );
  if (greetingOnly || (pashtoGreeting && wordCount <= 5)) {
    return english
      ? "Hello! How are you?\n\nWhat can I do for you today?"
      : "سلام! څنګه یې؟\n\nنن څه درته وکړم؟";
  }

  // --- Thanks ---
  if (has(text, "مننه", "ډېره مننه", "تشکر", "thank")) {
    return english ? "You are welcome! 😊\n\nWhat else can I do for you?" : "هیڅ خبره نه ده! 😊\n\nبل څه درته وکړم؟";
  }

  // --- Goodbye ---
  if (has(text, "خدای پامان", "خداحافظ", "په مخه دې ښه", "bye", "goodbye")) {
    return english ? "Goodbye! See you again. 👋" : "خدای پامان! بیا به سره ووینو. 👋";
  }

  // --- Founder / Samim ---
  if (
    has(
      text,
      "صمیم څوک دی",
      "صمیم څوک دی",
      "عبدالصمیم څوک دی",
      "بنسټګر څوک دی",
      "founder څوک دی",
      "ستا جوړوونکی څوک دی",
      "who is samim",
      "who is abdul samim"
    )
  ) {
    return english
      ? "Abdul Samim Niazai (Samim Pathan) is the founder of DevConnect and Samim AI.\n\nHe is from Alingar, Laghman, Afghanistan, and is a 3rd-semester Computer Science student at Arzgan University."
      : "عبدالصمیم نیازی (صمیم پټان) د DevConnect او Samim AI بنسټګر دی.\n\nله علینګار، لغمان څخه دی، د ارزګان پوهنتون د کمپیوټر ساینس درېیم سمستر زده‌کوونکی دی.";
  }

  // --- DevConnect ---
  if (has(lower, "devconnect") || has(text, "ډیوکنیکټ", "دیوکنیکټ", "ډیوکانیکټ")) {
    return english
      ? "DevConnect is Samim's app for developers — a social app like Facebook + GitHub + VS Code in one place.\n\nProjects are shared there, code is written, and there are friends, groups, pages and stories."
      : "DevConnect د صمیم یو اپ دی — د ډیولپرانو لپاره ټولنیز اپ، لکه فیسبوک + ګیټ‌هب + VS Code په یوه ځای کې.\n\nپه کې پروژې شریکېږی، کوډ لیکل کېږی، ملګری، ګروپونه، پاڼې او کیسې شته.";
  }

  // --- Samim AI itself ---
  if (has(lower, "samim ai") || has(text, "صمیم ای ای", "دا اپ څه دی", "what is samim ai")) {
    return english
      ? "Samim AI is a free AI assistant made by Abdul Samim Niazai. Anyone can create an account and ask questions — any kind of technology: programming, websites, mobile apps, AI, databases, networking, and general knowledge.\n\nThis is not Muse or Google — it is Samim's own app."
      : "Samim AI د عبدالصمیم نیازی وړیا AI مرستیال دی. هر څوک کولای شی اکاونټ جوړ کړی او پوښتنې وکړی — هر ډول ټکنالوژی: پروګرامینګ، ویبسایټ، موبایل اپ، AI، ډیټابیس، شبکې او عمومی معلومات.\n\nدا Muse یا Google نه دی؛ دا د صمیم خپل اپ دی.";
  }

  // --- HTML: build a web page ---
  if (has(lower, "html") && (has(lower, "web", "page", "website", "build", "create") || has(text, "ویب", "پاڼه", "جوړ"))) {
    return (
      (english
        ? "Here is a simple HTML web page:\n\n```html\n<!DOCTYPE html>\n<html>\n<head>\n  <title>My Page</title>\n</head>\n<body>\n  <h1>Hello World!</h1>\n  <p>This is my first web page.</p>\n</body>\n</html>\n```\n\nSave it as `index.html` and open it in your browser."
        : "دلته یو ساده HTML ویب پاڼه ده:\n\n```html\n<!DOCTYPE html>\n<html>\n<head>\n  <title>زما پاڼه</title>\n</head>\n<body>\n  <h1>سلام نړۍ!</h1>\n  <p>دا زما لومړۍ ویب پاڼه ده.</p>\n</body>\n</html>\n```\n\nدا د `index.html` په نوم خوندی کړه او په براوزر کې یې خلاص کړه.")
    );
  }

  // --- CSS ---
  if (has(lower, "css") && !has(lower, "html")) {
    return (
      (english
        ? "CSS is used to style a web page — colours, sizes and layout.\n\n```css\nh1 {\n  color: blue;\n  text-align: center;\n}\n```\n\nThis makes every `h1` heading blue and centred."
        : "CSS د ویب پاڼې د ښکلا لپاره کارېږی — رنګونه، اندازې او ترتیب.\n\n```css\nh1 {\n  color: blue;\n  text-align: center;\n}\n```\n\nدا هر `h1` سرلیک نیلی او په منځ کې کوی.")
    );
  }

  // --- JavaScript ---
  if (has(lower, "javascript", " js ")) {
    return (
      (english
        ? "JavaScript makes a web page interactive.\n\n```js\nlet name = \"Samim\";\nconsole.log(\"Hello, \" + name);\n```\n\n`let` creates a variable, and `console.log` prints the text."
        : "JavaScript ویب پاڼه ژوندۍ کوی.\n\n```js\nlet name = \"Samim\";\nconsole.log(\"Hello, \" + name);\n```\n\n`let` یو متغیر جوړوی، او `console.log` متن ښکاره کوی.")
    );
  }

  // --- Python loop ---
  // ROUND 5: only answer with the loop example when the user asks
  // for Python code/a loop/an example — "What is Python?" or
  // "Python history" must go to the web, not get a loop snippet.
  if (
    has(lower, "python") &&
    (has(lower, "loop", "example", "code", "print", "for ", "function", "list", "dict", "while", "range") ||
      lower.trim() === "python")
  ) {
    return (
      (english
        ? "A loop in Python repeats work.\n\n```python\nfor i in range(5):\n    print(i)\n```\n\nThis prints 0, 1, 2, 3, 4. `range(5)` gives the numbers 0 to 4."
        : "په Python کې لوپ کار تکراروی.\n\n```python\nfor i in range(5):\n    print(i)\n```\n\nدا 0، 1، 2، 3، 4 چاپوی. `range(5)` له 0 څخه تر 4 پورې شمېرې ورکوی.")
    );
  }

  // --- C++ ---
  if (has(lower, "c++", "c plus plus")) {
    return (
      (english
        ? "Here is a first C++ program:\n\n```cpp\n#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << \"Hello World!\";\n  return 0;\n}\n```\n\n`cout` prints text, and `main()` is where the program starts."
        : "دلته لومړی C++ پروګرام دی:\n\n```cpp\n#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << \"Hello World!\";\n  return 0;\n}\n```\n\n`cout` متن چاپوی، او `main()` هغه ځای دی چې پروګرام ترې پیلېږی.")
    );
  }

  // --- Java ---
  if (has(lower, "java") && !has(lower, "javascript")) {
    return (
      (english
        ? "Here is a first Java program:\n\n```java\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello World!\");\n  }\n}\n```\n\n`System.out.println` prints a line of text."
        : "دلته لومړی Java پروګرام دی:\n\n```java\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello World!\");\n  }\n}\n```\n\n`System.out.println` د متن یوه کرښه چاپوی.")
    );
  }

  // --- Website building ---
  if (has(lower, "website", "web site") || has(text, "ویبسایټ", "ویب پاڼه جوړ", "ویبپاڼه جوړ")) {
    return (
      (english
        ? "To build a website, follow these steps:\n\n1. Learn HTML — the structure of the page\n2. Learn CSS — the design and colours\n3. Learn JavaScript — the interaction\n4. Publish it free on Vercel or Netlify\n\nTell me which step you want to start with, and I will explain it simply."
        : "د ویبسایټ جوړولو لپاره دا ګامونه واخله:\n\n1. HTML زده کړه — د پاڼې جوړښت\n2. CSS زده کړه — ډیزاین او رنګونه\n3. JavaScript زده کړه — اړیکه او حرکت\n4. په وړیا توګه یې په Vercel یا Netlify خپور کړه\n\nووایه چې له کوم ګام څخه پیل وکړې، زه به یې په ساده ډول درته تشریح کړم.")
    );
  }

  // --- English lessons ---
  // ROUND 5: only a lesson request ("learn English", "teach me
  // English") gets the lesson. "What is X in English?" is a
  // translation question — it must go to the web/AI, not the lesson.
  const englishLesson =
    (has(lower, "english") &&
      !/in english|to english|english word|english meaning|english for|translate.*english|english translation/.test(
        lower
      )) ||
    (has(text, "انګلیسی") && !has(text, "په انګلیسی", "انګلیسی ته", "انګلیسی کې"));
  if (englishLesson) {
    return (
      (english
        ? "Here is a small English lesson — greetings:\n\n- Hello = سلام\n- Good morning = سهار مو پخیر\n- Thank you = مننه\n- Goodbye = خدای پامان\n\nTry a sentence and I will correct it for you."
        : "دلته یو کوچنی انګلیسی درس دی — سلامونه:\n\n- Hello = سلام\n- Good morning = سهار مو پخیر\n- Thank you = مننه\n- Goodbye = خدای پامان\n\nیوه جمله ولیکه، زه به یې سم کړم.")
    );
  }

  // --- What is AI / a computer / the internet / SQL / React ---
  // ROUND 5: short honest explainers for the most-asked general
  // questions, so they are answered even with no web result.
  if (
    /\bwhat is ai\b/.test(lower) ||
    has(lower, "artificial intelligence") ||
    has(text, "مصنوعي ځیرکتیا", "مصنوعي ذکاوت")
  ) {
    return english
      ? "AI (Artificial Intelligence) means teaching a computer to learn and decide like a person — for example understanding language, recognising pictures, or answering questions.\n\nSamim AI is one example: you ask a question, and it answers from what it learned."
      : "AI (مصنوعي ځیرکتیا) یعنې کمپیوټر ته زده کول چې د انسان په څېر زده کړي او پرېکړه وکړي — لکه د ژبې پوهېدل، د انځور پېژندل، یا پوښتنو ته ځواب ورکول.\n\nSamim AI یو بېلګه ده: ته پوښتنه کوې، او دا له خپلو زده‌کړو څخه ځواب درکوي.";
  }
  if (/\bwhat is (a )?computer\b/.test(lower) || has(text, "کمپیوټر څه دی", "کمپیوټر څه شی دی")) {
    return english
      ? "A computer is an electronic machine that takes information (input), processes it, and gives a result (output).\n\nIts main parts are: the processor (CPU — the brain), memory (RAM), storage (hard disk / SSD), and the screen and keyboard."
      : "کمپیوټر یو برېښنايي ماشین دی چې معلومات اخلي (input)، پروسس کوي یې، او پایله ورکوي (output).\n\nاصلي برخې یې دا دي: پروسسر (CPU — مغز)، حافظه (RAM)، ذخیره (هارډ ډیسک / SSD)، سکرین او کیبورډ.";
  }
  if (/\bwhat is (the )?internet\b/.test(lower) || has(text, "انټرنیټ څه دی", "انټرنیټ څه شی دی")) {
    return english
      ? "The internet is a worldwide network of connected computers. It lets people send messages, open websites, watch videos and use apps like Samim AI from anywhere in the world."
      : "انټرنیټ د نړۍ د تړلو کمپیوټرونو شبکه ده. خلک کولای شي پیغامونه ولېږي، ویبسایټونه پرانیزي، ویډیوګانې وګوري او له هر ځای څخه Samim AI په څېر اپونه وکاروي.";
  }
  if (has(lower, "sql") && (has(lower, "what", "learn", "example", "query", "database") || lower.trim() === "sql")) {
    return english
      ? "SQL is the language for working with databases.\n\n```sql\nSELECT name, age FROM users WHERE age > 18;\n```\n\nThis takes the name and age of every user older than 18 from the `users` table."
      : "SQL د ډیټابیس سره د کار کولو ژبه ده.\n\n```sql\nSELECT name, age FROM users WHERE age > 18;\n```\n\nدا د `users` جدول څخه د هر هغه کارونکي نوم او عمر اخلي چې عمر یې له 18 څخه زیات وي.";
  }
  if (has(lower, "react") || has(lower, "next.js", "nextjs")) {
    return english
      ? "React is a JavaScript library for building user interfaces — a page is made of small reusable pieces called components.\n\n```jsx\nfunction Hello() {\n  return <h1>Hello World!</h1>;\n}\n```\n\nNext.js is a React framework that adds routing, server rendering and easy deployment (for example on Vercel)."
      : "React د کارونکي انټرفیس جوړولو لپاره د JavaScript یو کتابتون دی — پاڼه له کوچنیو برخو څخه جوړېږي چې components ورته وایي.\n\n```jsx\nfunction Hello() {\n  return <h1>Hello World!</h1>;\n}\n```\n\nNext.js د React یو چوکاټ دی چې روټینګ، سرور رینډرینګ او اسانه خپرول (لکه په Vercel) زیاتوي.";
  }

  // --- Time / date ---
  if (has(text, "وخت څو دی", "ساعت څو دی", "وخت څه دی", "نېټه څه ده", "نن څو تاریخ دی", "نن کومه ورځ ده") || has(lower, "what time", "what is the date", "today date")) {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return english ? `Now the time is ${time}, and the date is ${date}.` : `اوس وخت ${time} دی، او نېټه ${date} ده.`;
  }

  // --- Joke ---
  if (has(text, "ټوکه", "لطیفه", "ټوکې", "خندا") || has(lower, "joke", "make me laugh")) {
    return english
      ? "A computer said to the doctor: \"Doctor, my memory is weak!\" The doctor said: \"Don't worry, I also forgot who you are!\" 😄"
      : "یو کمپیوټر ډاکټر ته وویل: «ډاکټر صاحب، زما حافظه کمزورې ده!» ډاکټر وویل: «اندېښنه مه کوه، ما هم هېر شول چې ته څوک یې!» 😄";
  }

  // --- What can you do / help ---
  // ROUND 5: "help" must be the point of the message ("help", "help
  // me"), not a word inside a real question ("help me solve 12*8"
  // is a maths question, not a capabilities question).
  if (
    has(text, "څه کولای شې", "څه کولی شې", "مرسته", "مرستې ته اړتیا لرم") ||
    has(lower, "what can you do") ||
    (/\bhelp\b/.test(lower) && wordCount <= 4)
  ) {
    return english
      ? "I am your assistant! I can:\n\n- Chat in Pashto, English and Dari\n- Help with any kind of technology: programming (HTML, CSS, JavaScript, Python, C++, Java), mobile apps, AI, databases, networking, cybersecurity, hardware and cloud\n- Explain how to build a website or an app\n- Teach English\n- Tell the time and date, and jokes 😊"
      : "زه ستا مرستیال یم! زه دا کولی شم:\n\n- په پښتو، انګلیسی او دری خبرې وکړم\n- په هر ډول ټکنالوژۍ کې مرسته وکړم: پروګرامینګ (HTML، CSS، JavaScript، Python، C++، Java)، موبایل اپ، AI، ډیټابیس، شبکې، سایبر امنیت، هارډویر او کلاوډ\n- د ویبسایټ یا اپ جوړول تشریح کړم\n- انګلیسی وښیم\n- وخت او نېټه ووایم، او ټوکې وکړم 😊";
  }

  // No built-in topic matched — the caller decides what to do next
  // (web search for a factual question, else the honest fallback).
  return null;
}

/** Single-string answer (multi-bubble video replies joined with blank lines). */
export function getOfflineAnswer(rawInput: string): string {
  const topic = getOfflineTopicAnswer(rawInput);
  if (topic !== null) return topic;
  const english = !isPashto(rawInput) && /[a-zA-Z]/.test(rawInput);
  // --- Fallback (honest, never mentions a key) ---
  return english
    ? "I couldn't find that on the web — try asking it differently. I can help with programming, websites, English, and other technology questions."
    : "ما دا په انټرنیټ کې ونه موندل — هڅه وکړه چې په بل ډول یې وپوښتې. زه په پروګرامینګ، ویبسایټ، انګلیسی او نورو ټکنالوژۍ پوښتنو کې مرسته کولی شم.";
}
