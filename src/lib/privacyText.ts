/**
 * lib/privacyText.ts — the full text of the /privacy page.
 *
 * AUDITED FROM THE CODE (2026-11-25, Round 3 item N) — every claim
 * below is backed by a file:line in the audit note at the bottom.
 * Nothing is invented: no data-protection officer, no company
 * address, no retention period the code does not enforce, no third
 * party the code does not send data to, and no automated account
 * deletion (none exists in the app — deletion is by email request).
 *
 * Languages: ps / fa / en. The page follows the current UI language;
 * Arabic UI shows the English version (no Arabic policy text exists).
 */

export type PrivacyLang = "ps" | "fa" | "en";

export type PrivacySection = {
  heading: string;
  paragraphs: string[];
};

export type PrivacyText = {
  title: string;
  updated: string;
  intro: string;
  sections: PrivacySection[];
};

export const PRIVACY_TEXT: Record<PrivacyLang, PrivacyText> = {
  ps: {
    title: "د محرمیت تګلاره",
    updated: "وروستی تازه کول: ۲۵ نومبر ۲۰۲۶",
    intro:
      "AfghanGPT د افغانانو وړیا مرستیال دی، چې د عبدالصمیم نیازی (Samim Pathan) لخوا جوړ شوی دی. دا پاڼه په ساده ژبه تشریح کوي چې موږ کوم معلومات راټولوو، ولې یې راټولوو، چېرې یې ساتو، څوک یې ترلاسه کوي، څومره وخت یې ساتو، او څنګه یې ړنګولای شې. هره خبره دلته د اپلیکیشن له اصلي کوډ څخه اخیستل شوې ده — هېڅ شی مو نه دی زیات کړی.",
    sections: [
      {
        heading: "لنډیز",
        paragraphs: [
          "که ته پرته له اکاونټ څخه خبرې کوې (مېلمه)، ستا چټونه یوازې په دې وسیله کې په حافظه کې وي او هېڅ چېرې نه خوندی کېږي — کله چې پاڼه بنده، تازه یا ووځې، له منځه ځي.",
          "که ته ننوتلې یې، ستا چټونه ستا په خپل اکاونټ کې په Supabase ډیټابیس کې خوندی کېږي، او یوازې ته یې لیدلای شې. ستا پوښتنې د ځواب لپاره Google Gemini ته استول کېږي. ستا معلومات هېڅکله نه پلورل کېږي، او په اپلیکیشن کې هېڅ اعلانونه او د تعقیبولو وسیلې نشته.",
        ],
      },
      {
        heading: "کوم معلومات راټولوو",
        paragraphs: [
          "د اکاونټ معلومات: کله چې اکاونټ جوړوې، موږ ستا ایمیل یا د ټېلېفون شمېره، بشپړ نوم او عمر اخلو. دا معلومات ستا د اکاونټ په پروفایل کې ساتل کېږي.",
          "چټونه: ستا پوښتنې او د AI ځوابونه — یوازې هغه وخت چې ننوتلې یې. د مېلمه چټونه نه خوندی کېږي.",
          "ترتیبات: ژبه، رنګ (روښانه/تور)، غوره شوی ماډل، ستا د پروفایل عکس او رنګ، او هغه حقایق چې ته په خپله په «حافظه» کې لیکې (یوازې هغه وخت چې ته یې فعال کړې).",
          "غږ او عکسونه: که غږ واستوې، ستا غږ د لیکلو لپاره استول کېږي؛ که عکس ضمیمه کړې، هغه عکس د پوښتنې سره یوځای استول کېږي.",
          "راپورونه: که د کوم ځواب په اړه راپور واستوې، هغه راپور یوازې ستا په خپل وسیله کې ساتل کېږي.",
        ],
      },
      {
        heading: "مېلمه چټونه — پرته له اکاونټ څخه",
        paragraphs: [
          "که ته پرته له ننوتلو څخه خبرې کوې، ستا چټونه یوازې په حافظه (memory) کې دي. دوی نه په دې وسیله کې خوندی کېږي، نه په سرور کې، او نه په ډیټابیس کې. کله چې پاڼه تازه کړې، بنده یې کړې یا ترې ووځې، ستا چټونه له منځه ځي.",
          "یوازې ستا ترتیبات (لکه ژبه او رنګ) په دې وسیله کې ساتل کېږي، ځکه چې دوی چټ نه دي. د ننوتلو وروسته، ستا چټونه خوندی کېږي تر څو وروسته یې بیا ولولې.",
        ],
      },
      {
        heading: "ستا معلومات چېرې ساتل کېږي",
        paragraphs: [
          "ننوتلې چټونه: په Supabase Postgres ډیټابیس کې، په ai_chats او ai_messages جدولونو کې. د ډیټابیس قواعد (Row Level Security) داسې دي چې هر کارن یوازې خپل چټونه لیدلای، بدلولی او ړنګولای شي — بل هېڅ کارن ستا چټونه نشي لیدلی.",
          "پروفایل: ستا نوم او عمر د Supabase Auth د user_metadata په برخه کې ساتل کېږي. ستا ایمیل یا ټېلېفون شمېره ستا د ننوتلو پېژندنه ده.",
          "ستا په وسیله کې: ستا ترتیبات، د پروفایل عکس او رنګ، او ستا خپلې API کیلي (که دې نورو چمتوکوونکو ته خپله کیلي ورکړې وي) یوازې ستا په براوزر کې په localStorage کې ساتل کېږي. دوی زموږ سرور ته هېڅکله نه استول کېږي.",
        ],
      },
      {
        heading: "ایمیل سره ننوتل (Gmail)",
        paragraphs: [
          "کله چې د ایمیل سره ننوځې، Supabase Auth ستا ایمیل ته یو ۶-عددي کوډ استوي. دا کوډ یوازې ستا د پېژندنې لپاره دی. ستا ایمیل ستا د اکاونټ پېژندنه ده او د ننوتلو، د پاسورډ د بیا جوړولو لینک، او د اکاونټ د بیا رغولو لپاره کارېږي.",
          "ستا پاسورډ (که دې جوړ کړی وي) یوازې د ننوتلو لپاره کارېږي — موږ یې په ساده ډول نه ساتو او هېڅکله یې چاته نه ورکوو. که پاسورډ دې هېر شي، د بیا جوړولو لینک ستا ایمیل ته استول کېږي.",
        ],
      },
      {
        heading: "د Google سره ننوتل",
        paragraphs: [
          "کله چې «د Google سره دوام» غوره کړې، ته د Google خپلې پاڼې ته ځې او هلته خپل Google اکاونټ غوره کوې. ستا د Google پاسورډ هېڅکله موږ ته نه راځي.",
          "Google بیا ستا نوم او ایمیل آدرس Supabase ته ورکوي، تر څو ستا اکاونټ جوړ شي. له دې پرته، Google ته هېڅ نور معلومات نه استول کېږي. په Google کې ننوتل اختیاري دي — ته کولای شې د ایمیل یا ټېلېفون سره هم ننوځې.",
        ],
      },
      {
        heading: "Supabase — زموږ ډیټابیس",
        paragraphs: [
          "Supabase هغه خدمت دی چې زموږ ډیټابیس او د ننوتلو سیستم چلوي. ستا چټونه او د اکاونټ معلومات د Supabase په سرورونو کې ساتل کېږي. Supabase ستا چټونه د بل چا سره نه شریکوي.",
          "د ډیټابیس قواعد داسې ټاکل شوي چې هر کارن یوازې خپل معلومات لیدلای شي. حتی بنسټګر هم د بل کارن چټونه د ډیټابیس له لارې نشي لوستلی — د اډمین پاڼه یوازې د ده خپل چټونه شمېري.",
        ],
      },
      {
        heading: "Gemini — هغه AI چې ځواب درکوي",
        paragraphs: [
          "کله چې پوښتنه کوې، ستا پیغام او د خبرو تاریخ د ځواب لپاره د Google Gemini API ته استول کېږي. دا د سرور له خوا کیلي سره کېږي — کیلي ستا په براوزر کې هېڅکله نه ښکاري.",
          "که عکس ضمیمه کړې، هغه عکس هم Gemini ته استول کېږي، تر څو یې وګوري. که غږ واستوې، ستا غږ د لیکلو لپاره Gemini ته استول کېږي؛ که دې «په لوړ غږ واورول» غوره کړ، متن د غږ جوړولو لپاره استول کېږي. که د خبرونو یا واقعي پوښتنو ځواب وغواړې، ستا پوښتنه عامه سرچینو (DuckDuckGo، ویکیپیډیا، Google Books) ته هم استول کېدای شي.",
          "که دې په ترتیباتو کې بل چمتوکوونکی (لکه OpenAI یا DeepSeek) غوره کړی وي او خپله کیلي دې ورکړې وي، ستا پیغامونه یوازې هغه چمتوکوونکي ته استول کېږي، او ستا کیلي یوازې ستا په براوزر کې ساتل کېږي — زموږ په سرور کې نه خوندی کېږي او نه ثبتېږي.",
        ],
      },
      {
        heading: "غږ، عکسونه او فایلونه",
        paragraphs: [
          "غږ: ستا غږ یوازې د لیکلو (transcription) لپاره استول کېږي او وروسته نه ساتل کېږي.",
          "عکسونه: هغه عکس چې ضمیمه کوې یا جوړېږي، یوازې په دې ناسته (session) کې وي. په ډیټابیس کې د عکس لپاره هېڅ ځای نشته، نو عکسونه د چټونو سره نه خوندی کېږي.",
          "فایلونه: که د فایل (لکه PDF، Word یا Excel) جوړولو غوښتنه وکړې، فایل په سرور کې جوړېږي او ستا وسیلې ته ډاونلوډ کېږي. فایل په سرور کې نه ساتل کېږي.",
        ],
      },
      {
        heading: "بنسټګر او اډمین څه لیدلای شي",
        paragraphs: [
          "اډمین یوازې بنسټګر دی (samimpatan8@gmail.com). د اډمین پاڼه یوازې دا ښيي: د ده خپل د چټونو شمېر، آیا Supabase او Gemini وصل دي که نه، او د ده په خپل وسیله کې د سټوډیو شمېرې.",
          "اډمین ستا چټونه، ستا پیغامونه، ستا ایمیل، ستا پاسورډ او ستا راپورونه نشي لیدلی. ستا راپورونه یوازې ستا په وسیله کې دي او اډمین ته هېڅکله نه رسېږي.",
        ],
      },
      {
        heading: "څومره وخت معلومات ساتو",
        paragraphs: [
          "ستا چټونه تر هغه وخت ساتل کېږي تر څو چې ته یې په خپله ړنګ نه کړې — په اپلیکیشن کې هر چټ جلا ړنګولای شې، یا په ترتیباتو کې «تاریخ پاک کړه» سره ټول چټونه ړنګولای شې.",
          "ستا پروفایل (نوم، عمر، ایمیل) تر هغه وخت ساتل کېږي تر څو چې ستا اکاونټ شتون لري. د مېلمه چټونه د ناستې په پای کې له منځه ځي. ستا په وسیله کې ساتل شوي ترتیبات تر هغه وخت پاتې کېږي تر څو چې ته یې په خپله پاک نه کړې.",
          "موږ د معلوماتو د ساتلو لپاره کومه ځانګړې موده نه ده ټاکلې چې کوډ یې نه پلي کوي — پورته لیکل شوي قواعد همدا دي چې اپلیکیشن یې په رښتیا کوي.",
        ],
      },
      {
        heading: "ستا معلومات ړنګول",
        paragraphs: [
          "چټونه: هر چټ په اپلیکیشن کې ړنګولای شې، یا په ترتیباتو کې د «تاریخ پاک کړه» تڼۍ سره ټول چټونه یو ځای ړنګولای شې.",
          "اکاونټ او ټول معلومات: په اپلیکیشن کې د اکاونټ د ړنګولو اتومات تڼۍ نشته. که غواړې چې ستا اکاونټ او ټول معلومات دې په بشپړ ډول ړنګ شي، بنسټګر ته په samimpatan8@gmail.com ایمیل واستوه او د ړنګولو غوښتنه وکړه. په ایمیل کې هغه ایمیل آدرس ولیکه چې اکاونټ دې پرې جوړ دی، تر څو سم اکاونټ وپېژندل شي.",
        ],
      },
      {
        heading: "هغه څه چې موږ یې هېڅکله نه کوو",
        paragraphs: [
          "موږ ستا معلومات هېڅکله نه پلورو. موږ ستا معلومات د اعلانونو لپاره نه کاروو، او په اپلیکیشن کې د اعلانونو یا د تعقیبولو هېڅ وسیله نشته. موږ ستا معلومات له هغو کسانو پرته چې پورته یاد شول (Supabase، Google Gemini، او د ننوتلو پر وخت Google) له بل چا سره نه شریکوو.",
          "موږ ستا د اکاونټ پاسورډ یا API کیلي هېڅکله نه غواړو چې په چټ کې یې ولیکې — دا معلومات هېڅکله په چټ کې مه لیکئ.",
        ],
      },
      {
        heading: "د دې تګلارې بدلونونه",
        paragraphs: [
          "که دا تګلاره بدله شي، موږ به دلته نوې نېټه ولیکو. که بدلون مهم وي، موږ به یې په اپلیکیشن کې خبر کړو.",
        ],
      },
      {
        heading: "اړیکه",
        paragraphs: [
          "که د محرمیت په اړه پوښتنه لرې، یا غواړې چې ستا معلومات ړنګ شي، بنسټګر ته ایمیل واستوه: samimpatan8@gmail.com — عبدالصمیم نیازی (Samim Pathan)، د AfghanGPT بنسټګر.",
        ],
      },
    ],
  },
  fa: {
    title: "سیاست حریم خصوصی",
    updated: "آخرین به‌روزرسانی: ۲۵ نوامبر ۲۰۲۶",
    intro:
      "AfghanGPT دستیار رایگان افغان‌ها است که توسط عبدالصمیم نیازی (Samim Pathan) ساخته شده است. این صفحه به زبان ساده توضیح می‌دهد که ما چه اطلاعاتی را جمع‌آوری می‌کنیم، چرا، کجا نگه می‌داریم، چه کسی آن را دریافت می‌کند، چه مدت نگه می‌داریم، و چگونه می‌توانید آن را حذف کنید. همهٔ موارد این‌جا از کد واقعی برنامه گرفته شده است — چیزی اضافه نکرده‌ایم.",
    sections: [
      {
        heading: "خلاصه",
        paragraphs: [
          "اگر بدون حساب کاربری گفتگو می‌کنید (مهمان)، چت‌های شما فقط در حافظهٔ همین دستگاه هستند و هیچ‌جا ذخیره نمی‌شوند — وقتی صفحه را ببندید، تازه کنید یا خارج شوید، از بین می‌روند.",
          "اگر وارد شده‌اید، چت‌های شما در حساب خودتان در پایگاه‌دادهٔ Supabase ذخیره می‌شوند و فقط شما می‌توانید آن‌ها را ببینید. سؤال‌های شما برای پاسخ به Google Gemini فرستاده می‌شوند. اطلاعات شما هرگز فروخته نمی‌شود و در برنامه هیچ تبلیغات و ابزار ردیابی وجود ندارد.",
        ],
      },
      {
        heading: "چه اطلاعاتی را جمع‌آوری می‌کنیم",
        paragraphs: [
          "اطلاعات حساب: هنگام ساخت حساب، ایمیل یا شمارهٔ تلفن، نام کامل و سن شما را می‌گیریم. این اطلاعات در پروفایل حساب شما نگه داشته می‌شود.",
          "چت‌ها: سؤال‌های شما و پاسخ‌های هوش مصنوعی — فقط وقتی وارد شده‌اید. چت‌های مهمان ذخیره نمی‌شوند.",
          "تنظیمات: زبان، رنگ (روشن/تیره)، مدل انتخاب‌شده، عکس و رنگ پروفایل شما، و حقایقی که خودتان در «حافظه» می‌نویسید (فقط وقتی خودتان آن را فعال کرده باشید).",
          "صدا و عکس‌ها: اگر صدا بفرستید، صدای شما برای نوشتن متن فرستاده می‌شود؛ اگر عکس ضمیمه کنید، آن عکس همراه با سؤال فرستاده می‌شود.",
          "گزارش‌ها: اگر دربارهٔ پاسخی گزارش بفرستید، آن گزارش فقط در دستگاه خودتان نگه داشته می‌شود.",
        ],
      },
      {
        heading: "چت‌های مهمان — بدون حساب کاربری",
        paragraphs: [
          "اگر بدون ورود گفتگو می‌کنید، چت‌های شما فقط در حافظه (memory) هستند. آن‌ها نه در این دستگاه ذخیره می‌شوند، نه در سرور، و نه در پایگاه‌داده. وقتی صفحه را تازه کنید، ببندید یا خارج شوید، چت‌های شما از بین می‌روند.",
          "فقط تنظیمات شما (مانند زبان و رنگ) در این دستگاه نگه داشته می‌شوند، چون چت نیستند. پس از ورود، چت‌های شما ذخیره می‌شوند تا بعداً دوباره آن‌ها را بخوانید.",
        ],
      },
      {
        heading: "اطلاعات شما کجا نگه داشته می‌شود",
        paragraphs: [
          "چت‌های واردشده: در پایگاه‌دادهٔ Supabase Postgres، در جدول‌های ai_chats و ai_messages. قوانین پایگاه‌داده (Row Level Security) طوری است که هر کاربر فقط چت‌های خودش را می‌تواند ببیند، تغییر دهد و حذف کند — هیچ کاربر دیگری نمی‌تواند چت‌های شما را ببیند.",
          "پروفایل: نام و سن شما در بخش user_metadata سیستم Supabase Auth نگه داشته می‌شود. ایمیل یا شمارهٔ تلفن شما شناسهٔ ورود شماست.",
          "در دستگاه شما: تنظیمات، عکس و رنگ پروفایل، و کلیدهای API خودتان (اگر به ارائه‌دهندهٔ دیگری کلید خودتان را داده باشید) فقط در مرورگر شما در localStorage نگه داشته می‌شوند. آن‌ها هرگز به سرور ما فرستاده نمی‌شوند.",
        ],
      },
      {
        heading: "ورود با ایمیل (Gmail)",
        paragraphs: [
          "وقتی با ایمیل وارد می‌شوید، Supabase Auth یک کد ۶ رقمی به ایمیل شما می‌فرستد. این کد فقط برای شناسایی شماست. ایمیل شما شناسهٔ حساب شماست و برای ورود، لینک بازیابی رمز عبور و بازیابی حساب استفاده می‌شود.",
          "رمز عبور شما (اگر ساخته باشید) فقط برای ورود استفاده می‌شود — ما آن را به‌صورت ساده نگه نمی‌داریم و هرگز به کسی نمی‌دهیم. اگر رمز عبور را فراموش کنید، لینک بازیابی به ایمیل شما فرستاده می‌شود.",
        ],
      },
      {
        heading: "ورود با Google",
        paragraphs: [
          "وقتی «ادامه با Google» را انتخاب می‌کنید، به صفحهٔ خود Google می‌روید و حساب Google خود را آن‌جا انتخاب می‌کنید. رمز عبور Google شما هرگز به ما نمی‌رسد.",
          "سپس Google نام و آدرس ایمیل شما را به Supabase می‌دهد تا حساب شما ساخته شود. به‌جز این، هیچ اطلاعات دیگری به Google فرستاده نمی‌شود. ورود با Google اختیاری است — می‌توانید با ایمیل یا تلفن هم وارد شوید.",
        ],
      },
      {
        heading: "Supabase — پایگاه‌دادهٔ ما",
        paragraphs: [
          "Supabase خدمتی است که پایگاه‌داده و سیستم ورود ما را اجرا می‌کند. چت‌ها و اطلاعات حساب شما در سرورهای Supabase نگه داشته می‌شوند. Supabase چت‌های شما را با هیچ‌کس دیگری به اشتراک نمی‌گذارد.",
          "قوانین پایگاه‌داده طوری تنظیم شده‌اند که هر کاربر فقط اطلاعات خودش را می‌تواند ببیند. حتی بنیان‌گذار هم نمی‌تواند چت‌های کاربر دیگری را از طریق پایگاه‌داده بخواند — صفحهٔ ادمین فقط چت‌های خودش را می‌شمارد.",
        ],
      },
      {
        heading: "Gemini — هوش مصنوعی که پاسخ می‌دهد",
        paragraphs: [
          "وقتی سؤال می‌پرسید، پیام شما و تاریخچهٔ گفتگو برای پاسخ به Google Gemini API فرستاده می‌شود. این کار با کلیدی از طرف سرور انجام می‌شود — کلید هرگز در مرورگر شما دیده نمی‌شود.",
          "اگر عکس ضمیمه کنید، آن عکس هم به Gemini فرستاده می‌شود تا آن را ببیند. اگر صدا بفرستید، صدای شما برای نوشتن متن به Gemini فرستاده می‌شود؛ اگر «با صدای بلند بخوان» را انتخاب کنید، متن برای ساخت صدا فرستاده می‌شود. اگر پاسخ خبر یا سؤال واقعی بخواهید، سؤال شما ممکن است به منابع عمومی (DuckDuckGo، ویکی‌پدیا، Google Books) هم فرستاده شود.",
          "اگر در تنظیمات ارائه‌دهندهٔ دیگری (مانند OpenAI یا DeepSeek) را انتخاب کرده باشید و کلید خودتان را داده باشید، پیام‌های شما فقط به همان ارائه‌دهنده فرستاده می‌شود و کلید شما فقط در مرورگر شما نگه داشته می‌شود — در سرور ما ذخیره و ثبت نمی‌شود.",
        ],
      },
      {
        heading: "صدا، عکس‌ها و فایل‌ها",
        paragraphs: [
          "صدا: صدای شما فقط برای نوشتن متن (transcription) فرستاده می‌شود و پس از آن نگه داشته نمی‌شود.",
          "عکس‌ها: عکسی که ضمیمه می‌کنید یا ساخته می‌شود، فقط در همین نشست (session) است. در پایگاه‌داده جایی برای عکس وجود ندارد، پس عکس‌ها همراه با چت‌ها ذخیره نمی‌شوند.",
          "فایل‌ها: اگر درخواست ساخت فایل (مانند PDF، Word یا Excel) کنید، فایل در سرور ساخته می‌شود و به دستگاه شما دانلود می‌شود. فایل در سرور نگه داشته نمی‌شود.",
        ],
      },
      {
        heading: "بنیان‌گذار و ادمین چه چیزی را می‌تواند ببیند",
        paragraphs: [
          "ادمین فقط بنیان‌گذار است (samimpatan8@gmail.com). صفحهٔ ادمین فقط این‌ها را نشان می‌دهد: تعداد چت‌های خودش، این‌که آیا Supabase و Gemini وصل هستند یا نه، و تعداد استودیو در دستگاه خودش.",
          "ادمین نمی‌تواند چت‌ها، پیام‌ها، ایمیل، رمز عبور و گزارش‌های شما را ببیند. گزارش‌های شما فقط در دستگاه شماست و هرگز به ادمین نمی‌رسد.",
        ],
      },
      {
        heading: "اطلاعات را چه مدت نگه می‌داریم",
        paragraphs: [
          "چت‌های شما تا وقتی نگه داشته می‌شوند که خودتان آن‌ها را حذف کنید — هر چت را جداگانه در برنامه حذف می‌کنید، یا با دکمهٔ «پاک کردن تاریخچه» در تنظیمات همهٔ چت‌ها را یک‌جا حذف می‌کنید.",
          "پروفایل شما (نام، سن، ایمیل) تا وقتی نگه داشته می‌شود که حساب شما وجود دارد. چت‌های مهمان با پایان نشست از بین می‌روند. تنظیمات ذخیره‌شده در دستگاه شما تا وقتی می‌مانند که خودتان آن‌ها را پاک کنید.",
          "ما برای نگه‌داشتن اطلاعات مدت مشخصی تعیین نکرده‌ایم که کد آن را اجرا نکند — قوانین بالا همان چیزی است که برنامه واقعاً انجام می‌دهد.",
        ],
      },
      {
        heading: "حذف اطلاعات شما",
        paragraphs: [
          "چت‌ها: هر چت را در برنامه حذف می‌کنید، یا با دکمهٔ «پاک کردن تاریخچه» در تنظیمات همهٔ چت‌ها را یک‌جا حذف می‌کنید.",
          "حساب و همهٔ اطلاعات: در برنامه دکمهٔ خودکار برای حذف حساب وجود ندارد. اگر می‌خواهید حساب و همهٔ اطلاعات شما کاملاً حذف شود، به بنیان‌گذار به آدرس samimpatan8@gmail.com ایمیل بفرستید و درخواست حذف کنید. در ایمیل آدرس ایمیلی را بنویسید که حساب شما با آن ساخته شده است، تا حساب درست شناسایی شود.",
        ],
      },
      {
        heading: "کارهایی که هرگز انجام نمی‌دهیم",
        paragraphs: [
          "ما اطلاعات شما را هرگز نمی‌فروشیم. ما اطلاعات شما را برای تبلیغات استفاده نمی‌کنیم و در برنامه هیچ ابزار تبلیغات یا ردیابی وجود ندارد. ما اطلاعات شما را به‌جز کسانی که بالا نام برده شدند (Supabase، Google Gemini، و Google هنگام ورود) با هیچ‌کس دیگری به اشتراک نمی‌گذاریم.",
          "ما هرگز از شما نمی‌خواهیم که رمز عبور حساب یا کلید API خود را در چت بنویسید — این اطلاعات را هرگز در چت ننویسید.",
        ],
      },
      {
        heading: "تغییرات این سیاست",
        paragraphs: [
          "اگر این سیاست تغییر کند، تاریخ جدید را این‌جا می‌نویسیم. اگر تغییر مهم باشد، در برنامه به شما خبر می‌دهیم.",
        ],
      },
      {
        heading: "تماس",
        paragraphs: [
          "اگر دربارهٔ حریم خصوصی سؤالی دارید، یا می‌خواهید اطلاعات شما حذف شود، به بنیان‌گذار ایمیل بفرستید: samimpatan8@gmail.com — عبدالصمیم نیازی (Samim Pathan)، بنیان‌گذار AfghanGPT.",
        ],
      },
    ],
  },
  en: {
    title: "Privacy Policy",
    updated: "Last updated: 25 November 2026",
    intro:
      "AfghanGPT is the free assistant for Afghans, built by Abdul Samim Niazai (Samim Pathan). This page explains in plain language what information we collect, why, where it is stored, who receives it, how long we keep it, and how you can delete it. Everything here is taken from the app's real code — nothing has been added.",
    sections: [
      {
        heading: "Summary",
        paragraphs: [
          "If you chat without an account (as a guest), your chats live only in this device's memory and are never saved anywhere — when you close, refresh, or leave the page, they are gone.",
          "If you are signed in, your chats are saved under your own account in the Supabase database, and only you can see them. Your questions are sent to Google Gemini to get an answer. Your information is never sold, and there are no ads and no tracking tools in the app.",
        ],
      },
      {
        heading: "What we collect",
        paragraphs: [
          "Account information: when you create an account, we take your email or phone number, your full name, and your age. This is kept in your account profile.",
          "Chats: your questions and the AI's replies — only when you are signed in. Guest chats are not saved.",
          "Settings: language, theme (light/dark), your chosen model, your profile photo and colour, and any facts you write yourself in \"Memory\" (only if you turn it on).",
          "Voice and photos: if you send voice, your audio is sent to be written out as text; if you attach a photo, that photo is sent together with your question.",
          "Reports: if you report a reply, that report is kept only on your own device.",
        ],
      },
      {
        heading: "Guest chats — without an account",
        paragraphs: [
          "If you chat without signing in, your chats are only in memory. They are not saved on this device, not on the server, and not in the database. When you refresh, close, or leave the page, your chats are gone.",
          "Only your settings (such as language and theme) are kept on this device, because they are not chats. After you sign in, your chats are saved so you can read them again later.",
        ],
      },
      {
        heading: "Where your information is stored",
        paragraphs: [
          "Signed-in chats: in the Supabase Postgres database, in the ai_chats and ai_messages tables. The database rules (Row Level Security) are set so that each user can only see, change, and delete their own chats — no other user can see your chats.",
          "Profile: your name and age are kept in the user_metadata section of Supabase Auth. Your email or phone number is your sign-in identity.",
          "On your device: your settings, profile photo and colour, and your own API keys (if you gave your own key for another provider) are kept only in your browser's localStorage. They are never sent to our server.",
        ],
      },
      {
        heading: "Signing in with email (Gmail)",
        paragraphs: [
          "When you sign in with email, Supabase Auth sends a 6-digit code to your email. That code is only to identify you. Your email is your account identity and is used for signing in, for the password-reset link, and for account recovery.",
          "Your password (if you created one) is only used for signing in — we do not keep it in plain form and never give it to anyone. If you forget your password, a reset link is sent to your email.",
        ],
      },
      {
        heading: "Signing in with Google",
        paragraphs: [
          "When you choose \"Continue with Google\", you go to Google's own page and choose your Google account there. Your Google password never reaches us.",
          "Google then gives your name and email address to Supabase so your account can be created. Apart from that, no other information is sent to Google. Signing in with Google is optional — you can also sign in with email or phone.",
        ],
      },
      {
        heading: "Supabase — our database",
        paragraphs: [
          "Supabase is the service that runs our database and sign-in system. Your chats and account information are kept on Supabase's servers. Supabase does not share your chats with anyone else.",
          "The database rules are set so that each user can only see their own information. Even the founder cannot read another user's chats through the database — the admin page only counts his own chats.",
        ],
      },
      {
        heading: "Gemini — the AI that answers you",
        paragraphs: [
          "When you ask a question, your message and the conversation history are sent to the Google Gemini API for an answer. This is done with a server-side key — the key never appears in your browser.",
          "If you attach a photo, that photo is also sent to Gemini so it can see it. If you send voice, your audio is sent to Gemini to be written out as text; if you choose \"read aloud\", the text is sent to make audio. If you ask for news or a factual answer, your question may also be sent to public sources (DuckDuckGo, Wikipedia, Google Books).",
          "If you chose another provider in Settings (such as OpenAI or DeepSeek) and gave your own key, your messages are sent only to that provider, and your key is kept only in your browser — it is not stored or logged on our server.",
        ],
      },
      {
        heading: "Voice, photos, and files",
        paragraphs: [
          "Voice: your audio is only sent to be transcribed into text, and is not kept afterwards.",
          "Photos: a photo you attach or generate exists only in this session. There is no place for photos in the database, so photos are not saved with your chats.",
          "Files: if you ask for a file to be created (such as a PDF, Word, or Excel file), the file is made on the server and downloaded to your device. The file is not kept on the server.",
        ],
      },
      {
        heading: "What the founder and admin can see",
        paragraphs: [
          "The admin is only the founder (samimpatan8@gmail.com). The admin page only shows: his own number of chats, whether Supabase and Gemini are connected or not, and the studio counts on his own device.",
          "The admin cannot see your chats, your messages, your email, your password, or your reports. Your reports stay on your device only and never reach the admin.",
        ],
      },
      {
        heading: "How long we keep your information",
        paragraphs: [
          "Your chats are kept until you delete them yourself — you can delete any chat in the app, or delete all chats at once with \"Clear history\" in Settings.",
          "Your profile (name, age, email) is kept while your account exists. Guest chats end with the session. Settings kept on your device stay until you clear them yourself.",
          "We have not set any fixed retention period that the code does not enforce — the rules above are exactly what the app really does.",
        ],
      },
      {
        heading: "Deleting your information",
        paragraphs: [
          "Chats: delete any chat in the app, or use the \"Clear history\" button in Settings to delete all chats at once.",
          "Account and all information: there is no automatic button in the app to delete your account. If you want your account and all of your information fully deleted, email the founder at samimpatan8@gmail.com and ask for deletion. In the email, write the email address your account was created with, so the right account can be found.",
        ],
      },
      {
        heading: "What we never do",
        paragraphs: [
          "We never sell your information. We never use your information for advertising, and there are no advertising or tracking tools in the app. We never share your information with anyone besides the parties named above (Supabase, Google Gemini, and Google when you sign in).",
          "We will never ask you to write your account password or API key in a chat — never write that information in a chat.",
        ],
      },
      {
        heading: "Changes to this policy",
        paragraphs: [
          "If this policy changes, we will write the new date here. If a change is important, we will tell you in the app.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [
          "If you have a question about privacy, or you want your information deleted, email the founder: samimpatan8@gmail.com — Abdul Samim Niazai (Samim Pathan), founder of AfghanGPT.",
        ],
      },
    ],
  },
};

/**
 * AUDIT EVIDENCE (2026-11-25 — every claim above traces to code):
 * - Guest memory-only: src/lib/store.ts header + memoryOnly default
 *   true, refreshAuthMode(); page.tsx saveMessage gated on userId.
 * - Logged-in chats in Supabase: src/lib/chats.ts (ai_chats /
 *   ai_messages), src/app/page.tsx:701-710, 867 (createChat/saveMessage
 *   only when userId && dbId); RLS own-rows-only: supabase/ai-001.sql.
 * - Profile name/age in Auth user_metadata:
 *   src/components/AuthWizard.tsx:124-131, 349-350 (updateUser data
 *   { full_name, age }); read back at :182-188, :374-380.
 * - Avatar photo + gradient in localStorage: src/lib/store.ts
 *   Settings.avatarDataUrl/avatarGradient; src/app/settings/page.tsx:76.
 * - Own provider keys browser-only: src/lib/store.ts header +
 *   src/app/api/providers/route.ts header ("NEVER persisted, NEVER
 *   logged, NEVER sent anywhere except that provider's own API").
 * - Gemini receives messages (+photo inlineData, +memory facts when
 *   enabled — page.tsx:740): src/lib/gemini.ts toGeminiContents,
 *   streamGemini; server key only: gemini.ts header, api/chat,
 *   api/transcribe, api/speech, api/live-token (ephemeral token).
 * - Public sources for factual questions: src/lib/freeweb.ts
 *   (DuckDuckGo api.duckduckgo.com, Wikipedia, Google Books).
 * - Attached/generated images session-only, no image column:
 *   supabase/ai-001.sql ai_messages has only role/content; chats.ts
 *   saveMessage stores content only.
 * - Reports local-only: src/components/ChatMessage.tsx:34, 458-472
 *   (localStorage "samim-ai-reports", max 50, never fetched/sent).
 * - Admin sees only own counts + status booleans:
 *   src/app/admin/page.tsx listChats(user.id) + /api/status
 *   (booleans only, key value never returned).
 * - No account deletion in the app: grep for delete account across
 *   src/ returns nothing; chat delete + Settings clearHistory
 *   (settings/page.tsx:128-149, deleteChat per chat) do exist.
 * - No ads/analytics trackers: grep of src/app/layout.tsx +
 *   src/components/Providers.tsx finds no analytics script.
 * - Email OTP / password / reset: AuthWizard.tsx signInWithOtp,
 *   verifyOtp, signInWithPassword, resetPasswordForEmail.
 * - Google OAuth on Google's own page: AuthWizard.tsx:384-402
 *   signInWithOAuth({ provider: "google" }).
 * - Files generated server-side, returned as download, not stored:
 *   src/app/api/files/route.ts.
 */
