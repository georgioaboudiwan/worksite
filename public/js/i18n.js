const STR = {
  en: {
    app: 'Worksite', tagline: 'Crew, days and pay — in one place',
    dashboard: 'Dashboard', planner: 'Planner', workers: 'Workers', payments: 'Payments', settings: 'Settings',
    day: 'Day', week: 'Week', month: 'Month', today: 'Today',
    earned: 'Earned', paid: 'Paid', left: 'Left to pay', owed: 'Total owed', owedHint: 'All time, all workers',
    periodHint: 'This period', onSite: 'On site today', planned: 'Planned', worked: 'Worked', absent: 'Absent',
    laborCost: 'Labor cost', bySite: 'Cost by site', byWorker: 'By worker', noSite: 'No site',
    days: 'Days', balance: 'Balance', rate: 'Daily rate', perDay: '/day',
    addWorker: 'Add worker', editWorker: 'Edit worker', name: 'Name', phone: 'Phone', trade: 'Trade',
    tradeHint: 'Mason, electrician, helper…', notes: 'Notes', active: 'Active', inactive: 'Inactive',
    edit: 'Edit', save: 'Save', cancel: 'Cancel', delete: 'Delete', confirmDelete: 'Delete this? This cannot be undone.',
    addPayment: 'Add payment', editPayment: 'Edit payment', amount: 'Amount', currency: 'Currency', date: 'Date',
    method: 'Method', cash: 'Cash', transfer: 'Bank transfer', whish: 'Whish', omt: 'OMT', other: 'Other',
    note: 'Note', worker: 'Worker', site: 'Site', status: 'Status', full: 'Full day', half: 'Half day',
    hours: 'Hours', hoursShort: 'h', custom: 'Custom', fraction: 'Day fraction',
    payBalance: 'Pay balance', pay: 'Pay', history: 'History', noData: 'Nothing here yet',
    noWorkers: 'Add your first worker to start planning.', copyLastWeek: 'Copy last week',
    markWorked: 'Mark planned as worked', clearDay: 'Clear',
    business: 'Business name', language: 'Language', defaultPeriod: 'Default period', weekStart: 'Week starts on',
    hoursPerDay: 'Hours in a full day', lbpRate: 'LBP rate (1 USD =)', sites: 'Sites', addSite: 'Add site',
    location: 'Location', signOut: 'Sign out', exportCsv: 'Export CSV', demo: 'Demo mode — data stays on this device',
    email: 'Email', password: 'Password', signIn: 'Sign in', signUp: 'Create account', forgot: 'Forgot password?',
    haveAccount: 'Have an account? Sign in', noAccount: 'New here? Create account', tryDemo: 'Try the demo',
    checkEmail: 'Check your email to confirm, then sign in.', resetSent: 'Reset link sent to your email.',
    pwRule: 'At least 10 characters', saved: 'Saved', deleted: 'Deleted', error: 'Something went wrong',
    all: 'All', search: 'Search', total: 'Total', entries: 'Work days', lastPaid: 'Last paid',
    advance: 'Paid ahead', credit: 'credit', weekdays: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
    months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    sessionExpired: 'Session expired. Please sign in again.', offline: 'You are offline',
    copied: 'Copied {n} plans', marked: 'Marked {n} as worked', install: 'Install app', textSize: 'Text size', tsNormal: 'Normal', tsLarge: 'Large', tsXLarge: 'Extra large', weekView: 'Week', appUpdated: 'The app was updated', sitesTab: 'Projects', siteDetail: 'Project', client: 'Client', income: 'Client paid', expenses: 'Expenses', profit: 'Profit', labor: 'Labour',
    addExpense: 'Add expense', addIncome: 'Client payment', editTxn: 'Edit entry', category: 'Category', materials: 'Materials', equipment: 'Equipment', transport: 'Transport', food: 'Food',
    onSiteToday: 'On site today', workedHere: 'Worked here', allTime: 'All time', noSites: 'Add your first project.',
    assignSite: 'Assign to', assignHint: 'Pick a project, then tap days to place workers there', none: 'None',
    wage: 'Wage', advanceKind: 'Advance', advances: 'Advances', giveAdvance: 'Advance', adjust: 'Bonus / deduction', bonus: 'Bonus', deduction: 'Deduction', overtime: 'Overtime',
    otMultiplier: 'Overtime rate (× hourly)', whatsapp: 'WhatsApp', stmtHi: 'Hi {name},', stmtFor: 'Your account for {period}:', stmtDays: 'Days worked', stmtEarned: 'Earned', stmtPaid: 'Paid', stmtLeft: 'Left', stmtTotal: 'Total still owed to you',
    payday: 'Payday', paydayToday: "Today is payday", paydayOwe: 'You owe {amount} to {n} workers', weeklyEmail: 'Email me a payday summary with a backup every payday',
    team: 'Team', inviteForeman: 'Invite a foreman', inviteCode: 'Invite code', inviteNote: 'Send this code to the foreman. It works once and expires in 7 days.', share: 'Share', copy: 'Copy', copiedOk: 'Copied',
    removeMember: 'Remove', docs: 'Documents', newDoc: 'New document', noDocs: 'No documents yet. Create price sheets, terms or quotes and export them to PDF.', docTitle: 'Document name', docHeader: 'Header', company: 'Company', subtitle: 'Subtitle', website: 'Website',
    sectionTitle: 'Section title', kindNumbered: 'Numbered', kindNotes: 'Notes', kindText: 'Text', itemHint: 'Write a line. Prices like $5 are highlighted.', addItem: 'Add line', addSection: 'Add section',
    preview: 'Preview', exportPdf: 'Export PDF', duplicate: 'Duplicate', saving: 'Saving…', savedAuto: 'Saved', reportPdf: 'PDF report', siteReport: 'Project report', summary: 'Summary',
    notifications: 'Notifications', pushHint: 'Get a notification on payday and when a foreman marks attendance.', pushEnable: 'Turn on notifications', pushOn: 'Notifications are on for this phone.', pushOff: 'Turn off', pushTest: 'Send a test', pushSent: 'Test sent',
    pushDenied: 'Notifications are blocked. Allow them in the phone settings for this app.', pushInstallFirst: 'On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then open it from there.', pushUnsupported: 'This browser does not support notifications.',
    offlineShort: 'Offline', pendingSync: '{n} to sync', synced: 'Synced', syncFailed: '{n} changes were rejected', savedOffline: 'Saved on the phone, will sync', refreshed: 'Up to date', foreman: 'Foreman', noMembers: 'No foremen yet', haveInvite: 'Invite code (foremen only)', notAllowed: 'Not allowed', whatsNew: "What's new", version: 'Version', changePassword: 'Change password', currentPassword: 'Current password', newPassword: 'New password'
  },
  ar: {
    app: 'ورشتي', tagline: 'العمّال، الأيام والدفعات — بمكان واحد',
    dashboard: 'الرئيسية', planner: 'التخطيط', workers: 'العمّال', payments: 'الدفعات', settings: 'الإعدادات',
    day: 'يوم', week: 'أسبوع', month: 'شهر', today: 'اليوم',
    earned: 'المستحق', paid: 'المدفوع', left: 'الباقي عليك', owed: 'كل الباقي عليك', owedHint: 'لكل العمّال من الأول',
    periodHint: 'هذه الفترة', onSite: 'بالورشة اليوم', planned: 'مخطط', worked: 'اشتغل', absent: 'غايب',
    laborCost: 'كلفة العمّال', bySite: 'الكلفة حسب الورشة', byWorker: 'حسب العامل', noSite: 'بلا ورشة',
    days: 'أيام', balance: 'الرصيد', rate: 'اليومية', perDay: '/يوم',
    addWorker: 'إضافة عامل', editWorker: 'تعديل عامل', name: 'الاسم', phone: 'الهاتف', trade: 'المهنة',
    tradeHint: 'معلّم، كهربجي، مساعد…', notes: 'ملاحظات', active: 'فعّال', inactive: 'متوقف',
    edit: 'تعديل', save: 'حفظ', cancel: 'إلغاء', delete: 'حذف', confirmDelete: 'حذف؟ لا يمكن التراجع.',
    addPayment: 'إضافة دفعة', editPayment: 'تعديل دفعة', amount: 'المبلغ', currency: 'العملة', date: 'التاريخ',
    method: 'الطريقة', cash: 'كاش', transfer: 'تحويل مصرفي', whish: 'Whish', omt: 'OMT', other: 'غير ذلك',
    note: 'ملاحظة', worker: 'العامل', site: 'الورشة', status: 'الحالة', full: 'يوم كامل', half: 'نص نهار',
    hours: 'ساعات', hoursShort: 'س', custom: 'مخصص', fraction: 'جزء من اليوم',
    payBalance: 'ادفع الباقي', pay: 'ادفع', history: 'السجل', noData: 'لا شيء بعد',
    noWorkers: 'أضف أول عامل لتبدأ التخطيط.', copyLastWeek: 'انسخ الأسبوع الماضي',
    markWorked: 'كلّهم اشتغلوا', clearDay: 'مسح',
    business: 'اسم الشركة', language: 'اللغة', defaultPeriod: 'الفترة الافتراضية', weekStart: 'بداية الأسبوع',
    hoursPerDay: 'ساعات اليوم الكامل', lbpRate: 'سعر الليرة (1 دولار =)', sites: 'الورش', addSite: 'إضافة ورشة',
    location: 'الموقع', signOut: 'تسجيل الخروج', exportCsv: 'تصدير CSV', demo: 'وضع تجريبي — البيانات على هذا الجهاز فقط',
    email: 'البريد الإلكتروني', password: 'كلمة السر', signIn: 'دخول', signUp: 'إنشاء حساب', forgot: 'نسيت كلمة السر؟',
    haveAccount: 'عندك حساب؟ ادخل', noAccount: 'جديد؟ أنشئ حساب', tryDemo: 'جرّب النسخة التجريبية',
    checkEmail: 'تحقق من بريدك للتأكيد، ثم ادخل.', resetSent: 'أرسلنا رابط التغيير لبريدك.',
    pwRule: '10 أحرف على الأقل', saved: 'تم الحفظ', deleted: 'تم الحذف', error: 'صار خطأ',
    all: 'الكل', search: 'بحث', total: 'المجموع', entries: 'أيام العمل', lastPaid: 'آخر دفعة',
    advance: 'مدفوع سلفاً', credit: 'سلفة', weekdays: ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'],
    months: ['كانون٢','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين١','تشرين٢','كانون١'],
    sessionExpired: 'انتهت الجلسة. ادخل من جديد.', offline: 'لا يوجد اتصال',
    copied: 'تم نسخ {n}', marked: 'تم تسجيل {n}', install: 'ثبّت التطبيق', textSize: 'حجم الخط', tsNormal: 'عادي', tsLarge: 'كبير', tsXLarge: 'كبير جداً', weekView: 'الأسبوع', appUpdated: 'التطبيق تحدّث', sitesTab: 'المشاريع', siteDetail: 'المشروع', client: 'الزبون', income: 'دفع الزبون', expenses: 'المصاريف', profit: 'الربح', labor: 'العمّال',
    addExpense: 'إضافة مصروف', addIncome: 'دفعة من الزبون', editTxn: 'تعديل', category: 'النوع', materials: 'مواد', equipment: 'معدّات', transport: 'نقل', food: 'أكل',
    onSiteToday: 'بالورشة اليوم', workedHere: 'اشتغلوا هون', allTime: 'من الأول', noSites: 'أضف أول مشروع.',
    assignSite: 'حطّ على', assignHint: 'اختار مشروع وكبّس على الأيام لتحطّ العمّال فيه', none: 'لا شي',
    wage: 'أجرة', advanceKind: 'سلفة', advances: 'السلف', giveAdvance: 'سلفة', adjust: 'مكافأة / خصم', bonus: 'مكافأة', deduction: 'خصم', overtime: 'ساعات إضافية',
    otMultiplier: 'سعر الساعة الإضافية (× سعر الساعة)', whatsapp: 'واتساب', stmtHi: 'مرحبا {name}،', stmtFor: 'حسابك عن {period}:', stmtDays: 'أيام الشغل', stmtEarned: 'المستحق', stmtPaid: 'المدفوع', stmtLeft: 'الباقي', stmtTotal: 'كل الباقي إلك',
    payday: 'يوم القبض', paydayToday: 'اليوم يوم القبض', paydayOwe: 'عليك {amount} لـ {n} عمّال', weeklyEmail: 'ابعتلي إيميل بالحساب ونسخة احتياطية كل يوم قبض',
    team: 'الفريق', inviteForeman: 'دعوة رئيس ورشة', inviteCode: 'رمز الدعوة', inviteNote: 'ابعت الرمز لرئيس الورشة. بيشتغل مرة وحدة وبينتهي بعد ٧ أيام.', share: 'مشاركة', copy: 'نسخ', copiedOk: 'انّسخ',
    removeMember: 'شيل', docs: 'المستندات', newDoc: 'مستند جديد', noDocs: 'ما في مستندات بعد. اعمل لوائح أسعار، شروط أو عروض وصدّرها PDF.', docTitle: 'اسم المستند', docHeader: 'الترويسة', company: 'الشركة', subtitle: 'العنوان الفرعي', website: 'الموقع',
    sectionTitle: 'عنوان القسم', kindNumbered: 'مرقّم', kindNotes: 'ملاحظات', kindText: 'نص', itemHint: 'اكتب سطر. الأسعار متل $5 بتطلع مميّزة.', addItem: 'إضافة سطر', addSection: 'إضافة قسم',
    preview: 'معاينة', exportPdf: 'تصدير PDF', duplicate: 'نسخة', saving: 'عم يحفظ…', savedAuto: 'محفوظ', reportPdf: 'تقرير PDF', siteReport: 'تقرير المشروع', summary: 'الملخّص',
    notifications: 'الإشعارات', pushHint: 'وصلك إشعار يوم القبض ولمّا رئيس الورشة يسجّل الحضور.', pushEnable: 'شغّل الإشعارات', pushOn: 'الإشعارات شغّالة على هالتلفون.', pushOff: 'طفّي', pushTest: 'ابعت تجربة', pushSent: 'انبعتت التجربة',
    pushDenied: 'الإشعارات ممنوعة. اسمح فيها من إعدادات التلفون لهالتطبيق.', pushInstallFirst: 'عالآيفون، زيد التطبيق عالشاشة الرئيسية أول (مشاركة ← إضافة إلى الشاشة الرئيسية) وافتحو من هونيك.', pushUnsupported: 'هالمتصفح ما بيدعم الإشعارات.',
    offlineShort: 'بلا إنترنت', pendingSync: '{n} بانتظار المزامنة', synced: 'تمت المزامنة', syncFailed: 'انرفض {n} تعديل', savedOffline: 'انحفظ عالتلفون، رح يتزامن', refreshed: 'محدّث', foreman: 'رئيس ورشة', noMembers: 'ما في رؤساء ورش بعد', haveInvite: 'رمز الدعوة (لرؤساء الورش)', notAllowed: 'ممنوع', whatsNew: 'شو الجديد', version: 'نسخة', changePassword: 'تغيير كلمة السر', currentPassword: 'كلمة السر الحالية', newPassword: 'كلمة السر الجديدة'
  }
};

let lang = 'ar';
export const setLang = l => {
  lang = STR[l] ? l : 'ar';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
};
export const getLang = () => lang;
export const t = (k, vars) => {
  let s = STR[lang][k] ?? STR.en[k] ?? k;
  if (vars && typeof s === 'string') for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
  return s;
};
