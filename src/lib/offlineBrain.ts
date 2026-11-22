/**
 * lib/offlineBrain.ts — Offline fallback brain for Samim AI.
 * Expanded from ~/workspace/samim-ai-app/lib/assistant.ts.
 * NO internet, NO key needed. Answers in simple Pashto (or English
 * when the question is in English). This is NOT Gemini — the UI labels
 * it clearly as offline mode.
 */

export function normalize(input: string): string {
  return input
    .trim()
    .replace(/[؟?!.,،؛:()«»"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (text: string, ...words: string[]): boolean =>
  words.some((w) => text.includes(w));

export function isPashto(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(text);
}

const OFFLINE_NOTE_PS =
  "\n\n—\nدا ځواب په آف‌لاین حالت کې ورکړل شو. د بشپړ او دقیق ځواب لپاره، د Samim AI مالک باید وړیا Gemini کېلي اضافه کړي.";

const OFFLINE_NOTE_EN =
  "\n\n—\nThis answer was given in offline mode. For full answers, the owner of Samim AI needs to add a free Gemini key.";

/** Single-string answer (multi-bubble video replies joined with blank lines). */
export function getOfflineAnswer(rawInput: string): string {
  const text = normalize(rawInput);
  const lower = text.toLowerCase();
  const english = !isPashto(rawInput) && /[a-zA-Z]/.test(rawInput);
  const note = english ? OFFLINE_NOTE_EN : OFFLINE_NOTE_PS;

  // --- Who are you? ---
  if (
    has(
      text,
      "ته څوک یی",
      "ته څوک یې",
      "ستا نوم څه دی",
      "ستا نوم څه دي",
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
  if (
    has(
      text,
      "سلام",
      "سلامونه",
      "سهار مو پخیر",
      "سهار مو بخیر",
      "ښه شپه",
      "مازدیګر مو پخیر",
      "hello",
      "hi",
      "salam"
    )
  ) {
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
      "صمیم څوک دي",
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
      : "DevConnect د صمیم یو اپ دی — د ډیولپرانو لپاره ټولنیز اپ، لکه فیسبوک + ګیټ‌هب + VS Code په یوه ځای کې.\n\nپه کې پروژې شریکېږي، کوډ لیکل کېږي، ملګري، ګروپونه، پاڼې او کیسې شته.";
  }

  // --- Samim AI itself ---
  if (has(lower, "samim ai") || has(text, "صمیم ای ای", "دا اپ څه دی", "what is samim ai")) {
    return english
      ? "Samim AI is a free AI assistant made by Abdul Samim Niazai. Anyone can create an account and ask questions — any kind of technology: programming, websites, mobile apps, AI, databases, networking, and general knowledge.\n\nThis is not Muse or Google — it is Samim's own app."
      : "Samim AI د عبدالصمیم نیازی وړیا AI مرستیال دی. هر څوک کولای شي اکاونټ جوړ کړي او پوښتنې وکړي — هر ډول ټکنالوژي: پروګرامینګ، ویبسایټ، موبایل اپ، AI، ډیټابیس، شبکې او عمومي معلومات.\n\nدا Muse یا Google نه دی؛ دا د صمیم خپل اپ دی.";
  }

  // --- HTML: build a web page ---
  if (has(lower, "html") && (has(lower, "web", "page", "website", "build", "create") || has(text, "ویب", "پاڼه", "جوړ"))) {
    return (
      (english
        ? "Here is a simple HTML web page:\n\n```html\n<!DOCTYPE html>\n<html>\n<head>\n  <title>My Page</title>\n</head>\n<body>\n  <h1>Hello World!</h1>\n  <p>This is my first web page.</p>\n</body>\n</html>\n```\n\nSave it as `index.html` and open it in your browser."
        : "دلته یو ساده HTML ویب پاڼه ده:\n\n```html\n<!DOCTYPE html>\n<html>\n<head>\n  <title>زما پاڼه</title>\n</head>\n<body>\n  <h1>سلام نړۍ!</h1>\n  <p>دا زما لومړۍ ویب پاڼه ده.</p>\n</body>\n</html>\n```\n\nدا د `index.html` په نوم خوندي کړه او په براوزر کې یې خلاص کړه.") + note
    );
  }

  // --- CSS ---
  if (has(lower, "css") && !has(lower, "html")) {
    return (
      (english
        ? "CSS is used to style a web page — colours, sizes and layout.\n\n```css\nh1 {\n  color: blue;\n  text-align: center;\n}\n```\n\nThis makes every `h1` heading blue and centred."
        : "CSS د ویب پاڼې د ښکلا لپاره کارېږي — رنګونه، اندازې او ترتیب.\n\n```css\nh1 {\n  color: blue;\n  text-align: center;\n}\n```\n\nدا هر `h1` سرلیک نیلي او په منځ کې کوي.") + note
    );
  }

  // --- JavaScript ---
  if (has(lower, "javascript", " js ")) {
    return (
      (english
        ? "JavaScript makes a web page interactive.\n\n```js\nlet name = \"Samim\";\nconsole.log(\"Hello, \" + name);\n```\n\n`let` creates a variable, and `console.log` prints the text."
        : "JavaScript ویب پاڼه ژوندۍ کوي.\n\n```js\nlet name = \"Samim\";\nconsole.log(\"Hello, \" + name);\n```\n\n`let` یو متغیر جوړوي، او `console.log` متن ښکاره کوي.") + note
    );
  }

  // --- Python loop ---
  if (has(lower, "python")) {
    return (
      (english
        ? "A loop in Python repeats work.\n\n```python\nfor i in range(5):\n    print(i)\n```\n\nThis prints 0, 1, 2, 3, 4. `range(5)` gives the numbers 0 to 4."
        : "په Python کې لوپ کار تکراروي.\n\n```python\nfor i in range(5):\n    print(i)\n```\n\nدا 0، 1، 2، 3، 4 چاپوي. `range(5)` له 0 څخه تر 4 پورې شمېرې ورکوي.") + note
    );
  }

  // --- C++ ---
  if (has(lower, "c++", "c plus plus")) {
    return (
      (english
        ? "Here is a first C++ program:\n\n```cpp\n#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << \"Hello World!\";\n  return 0;\n}\n```\n\n`cout` prints text, and `main()` is where the program starts."
        : "دلته لومړی C++ پروګرام دی:\n\n```cpp\n#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << \"Hello World!\";\n  return 0;\n}\n```\n\n`cout` متن چاپوي، او `main()` هغه ځای دی چې پروګرام ترې پیلېږي.") + note
    );
  }

  // --- Java ---
  if (has(lower, "java") && !has(lower, "javascript")) {
    return (
      (english
        ? "Here is a first Java program:\n\n```java\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello World!\");\n  }\n}\n```\n\n`System.out.println` prints a line of text."
        : "دلته لومړی Java پروګرام دی:\n\n```java\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello World!\");\n  }\n}\n```\n\n`System.out.println` د متن یوه کرښه چاپوي.") + note
    );
  }

  // --- Website building ---
  if (has(lower, "website", "web site") || has(text, "ویبسایټ", "ویب پاڼه جوړ", "ویبپاڼه جوړ")) {
    return (
      (english
        ? "To build a website, follow these steps:\n\n1. Learn HTML — the structure of the page\n2. Learn CSS — the design and colours\n3. Learn JavaScript — the interaction\n4. Publish it free on Vercel or Netlify\n\nTell me which step you want to start with, and I will explain it simply."
        : "د ویبسایټ جوړولو لپاره دا ګامونه واخله:\n\n1. HTML زده کړه — د پاڼې جوړښت\n2. CSS زده کړه — ډیزاین او رنګونه\n3. JavaScript زده کړه — اړیکه او حرکت\n4. په وړیا توګه یې په Vercel یا Netlify خپور کړه\n\nووایه چې له کوم ګام څخه پیل وکړې، زه به یې په ساده ډول درته تشریح کړم.") + note
    );
  }

  // --- English lessons ---
  if (has(lower, "english") || has(text, "انګلیسي", "انګلیسی")) {
    return (
      (english
        ? "Here is a small English lesson — greetings:\n\n- Hello = سلام\n- Good morning = سهار مو پخیر\n- Thank you = مننه\n- Goodbye = خدای پامان\n\nTry a sentence and I will correct it for you."
        : "دلته یو کوچنی انګلیسي درس دی — سلامونه:\n\n- Hello = سلام\n- Good morning = سهار مو پخیر\n- Thank you = مننه\n- Goodbye = خدای پامان\n\nیوه جمله ولیکه، زه به یې سم کړم.") + note
    );
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
  if (has(text, "څه کولای شې", "څه کولی شې", "مرسته", "مرستې ته اړتیا لرم", "help") || has(lower, "what can you do")) {
    return english
      ? "I am your assistant! I can:\n\n- Chat in Pashto, English and Dari\n- Help with any kind of technology: programming (HTML, CSS, JavaScript, Python, C++, Java), mobile apps, AI, databases, networking, cybersecurity, hardware and cloud\n- Explain how to build a website or an app\n- Teach English\n- Tell the time and date, and jokes 😊"
      : "زه ستا مرستیال یم! زه دا کولی شم:\n\n- په پښتو، انګلیسي او دري خبرې وکړم\n- په هر ډول ټکنالوژۍ کې مرسته وکړم: پروګرامینګ (HTML، CSS، JavaScript، Python، C++، Java)، موبایل اپ، AI، ډیټابیس، شبکې، سایبر امنیت، هارډویر او کلاوډ\n- د ویبسایټ یا اپ جوړول تشریح کړم\n- انګلیسي وښیم\n- وخت او نېټه ووایم، او ټوکې وکړم 😊";
  }

  // --- Fallback ---
  return english
    ? "Sorry, I could not answer that well in offline mode. Please ask it in another way — for example about any kind of technology: programming, mobile apps, AI, databases, networking, or DevConnect. 😊" + OFFLINE_NOTE_EN
    : "بښنه غواړم، دا مې په آف‌لاین حالت کې سم ونه شو کړای... بیا یې په بل ډول ووایه.\n\nکه غواړې، د هر ډول ټکنالوژۍ — پروګرامینګ، موبایل اپ، AI، ډیټابیس، شبکې — یا DevConnect په اړه پوښتنه وکړه. 😊" + OFFLINE_NOTE_PS;
}
