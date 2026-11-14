export const CHANGELOG = [
  {
    version: '1.1.0',
    date: '2026-11-14',
    items: [
      { en: 'Arabic is now the default language. English is still available in Settings.', ar: 'التطبيق صار بالعربي من الأساس. الإنكليزي بعدو موجود بالإعدادات.' },
      { en: 'Bigger text and buttons with a high-contrast light theme, easier for older users.', ar: 'الخط والأزرار صاروا أكبر وأوضح.' },
      { en: 'New text size setting: Normal, Large, Extra large.', ar: 'فيك تكبّر الخط من الإعدادات: عادي، كبير، كبير جداً.' },
      { en: 'The app opens on "Today": each worker has 4 big buttons (full day, half day, hours, absent). One tap saves.', ar: 'أول شاشة هي "اليوم": لكل عامل ٤ أزرار كبيرة. كبسة وحدة وبينحفظ.' },
      { en: 'Bottom menu in daily-use order: Today, Workers, Payments, Summary, Settings.', ar: 'ترتيب القائمة تحت: اليوم، العمّال، الدفعات، الملخّص، الإعدادات.' },
      { en: 'The app now emails the admin a summary of every new update.', ar: 'التطبيق بيبعت إيميل للمسؤول بكل تحديث جديد.' }
    ]
  },
  {
    version: '1.0.0',
    date: '2026-11-14',
    items: [
      { en: 'Moved to Cloudflare: one Worker serves the app and the API, data in a D1 database. Every push to main deploys automatically.', ar: 'نقلنا التطبيق على Cloudflare مع قاعدة بيانات خاصة فيه.' },
      { en: 'Own login system: hashed passwords, secure session cookies, brute-force limits, cross-site requests blocked.', ar: 'نظام دخول خاص وآمن.' },
      { en: 'Each account only sees its own workers, days and payments.', ar: 'كل حساب بيشوف بس العمّال والدفعات تبعو.' },
      { en: 'Weekly planner, days worked (full, half, hours), payments in USD or LBP, balances per day, week or month, and a summary dashboard.', ar: 'تخطيط أسبوعي، أيام الشغل، الدفعات بالدولار أو بالليرة، والباقي لكل عامل.' }
    ]
  }
];
