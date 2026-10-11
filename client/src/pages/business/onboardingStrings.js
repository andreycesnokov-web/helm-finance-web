// Onboarding UI chrome — button labels, headings and notices.
//
// SCOPE: this file localises the FRAME only. Every piece of onboarding CONTENT (flow and
// step titles, descriptions, instructions) comes from the API already resolved for the
// requested locale — the client never receives or renders a raw `*_i18n` map.
//
// WORDING: the AI Accountant notices are deliberately phrased as product guidance. Nothing
// here tells a user what their tax position is or what to file; it points at the fields the
// product needs and reminds them a qualified human reviews the result.
//
// Falls back to English key by key, so a missing string can never render blank.

const en = {
  eyebrow: 'Business workspace',
  title: 'Onboarding',
  subtitle: 'Set up your workspace, learn the product, and prepare your company profile.',
  language: 'Language',
  groups: { overview: 'Overview', finance: 'Finance', connections: 'Connections', operations: 'Operations', workspace: 'Workspace' },
  heroTitle: 'Set up your finance workspace',
  heroBody: 'Guided tracks that explain the product and what to prepare. Nothing here changes your financial data.',
  nextLabel: 'Your next step',
  nextStepIs: 'Next step',
  allDone: 'Your workspace is set up',
  allDoneBody: 'Every guide is complete. You can reopen any of them at any time.',
  startHere: 'Start here',
  recommended: 'Recommended first',
  whatsInside: 'What’s inside',
  moreItems: (n) => `+${n} more`,
  forLabel: 'What this page is for',
  todoLabel: 'What to do next',
  genericNext: 'Open the page to see it with your own data, then mark this module complete.',
  readinessTitle: 'Prepare your company for accountant review',
  readinessBody: 'Work through each item so your accountant receives a complete picture. Every item below is explained by the product, and you decide what applies to your company.',
  prepared: (done, total) => `${done} of ${total} items prepared`,

  summaryLabel: 'Setup progress',
  guidesDone: (done, total) => `${done} of ${total} guides completed`,
  summaryInProgress: 'In progress',
  summaryCompleted: 'Completed',
  summaryNotStarted: 'Not started',

  status: {
    not_started: 'Not started',
    in_progress: 'In progress',
    completed: 'Completed',
    dismissed: 'Dismissed',
    skipped: 'Skipped',
  },
  stepStatus: {
    not_started: 'Pending',
    viewed: 'Opened',
    completed: 'Done',
    skipped: 'Skipped',
  },

  start: 'Start',
  continue: 'Continue',
  review: 'Review again',
  allGuides: 'All guides',
  back: 'Back',
  next: 'Next',
  dismiss: 'Dismiss',
  reset: 'Reset',
  complete: 'Complete step',
  markComplete: 'Mark complete',
  skip: 'Skip step',
  openPage: 'Open page',

  stepOf: (n, total) => `Step ${n} of ${total}`,
  moduleOf: (n, total) => `Module ${n} of ${total}`,
  required: 'Required',
  optional: 'Optional',
  percentDone: (p) => `${p}% complete`,
  stepsResolved: (done, total) => `${done} of ${total} steps resolved`,

  dismissedBanner: 'You dismissed this guide. You can start it again at any time.',
  completedBanner: 'This guide is complete. Reset it if you want to walk through it again.',
  notStartedBanner: 'Nothing is recorded until you start. Starting a guide changes no data in your workspace.',

  needHelp: 'Need help?',
  helpBody: 'Onboarding explains the product — it never changes your data. If a step does not match what you see, these are the fastest ways forward.',
  helpItems: [
    'Re-read the step description and its instructions. Every step is guidance; nothing is applied automatically.',
    'Open the page a step refers to and read the step text beside the real page.',
    'Ask a workspace owner, or your accountant, when a step involves company or tax details.',
  ],
  helpFoot: 'This panel does not open a support conversation.',
  close: 'Close',

  disabledTitle: 'Onboarding is not enabled yet',
  disabledBody: 'This workspace does not have guided onboarding turned on. Nothing is missing from your account — the guides are simply not available in this deployment yet.',
  errorTitle: 'We couldn’t load onboarding',
  retry: 'Try again',
  noFlows: 'No onboarding guides are published for this workspace yet.',
  noSteps: 'This guide has no steps yet.',
  flowMissing: 'This guide is not available in this workspace.',
  notSkippable: 'This step is required and cannot be skipped.',

  guidanceTitle: 'Guidance only',
  guidanceBody: 'These steps explain what to prepare and where it belongs in the product. They are general product guidance — not legal, accounting or tax advice.',
  reviewTitle: 'Have an accountant review the result',
  reviewBody: 'Before you file or submit anything, have a qualified accountant review your company profile, tax details and documents. The AI Accountant drafts; a person decides.',
}

const id = {
  eyebrow: 'Ruang kerja bisnis',
  title: 'Onboarding',
  subtitle: 'Siapkan ruang kerja, pelajari produk, dan lengkapi profil perusahaan Anda.',
  language: 'Bahasa',
  groups: { overview: 'Ringkasan', finance: 'Keuangan', connections: 'Koneksi', operations: 'Operasional', workspace: 'Ruang kerja' },
  heroTitle: 'Siapkan ruang kerja keuangan Anda',
  heroBody: 'Panduan bertahap yang menjelaskan produk dan apa yang perlu disiapkan. Tidak ada yang mengubah data keuangan Anda.',
  nextLabel: 'Langkah Anda berikutnya',
  nextStepIs: 'Langkah berikutnya',
  allDone: 'Ruang kerja Anda sudah siap',
  allDoneBody: 'Semua panduan telah selesai. Anda dapat membukanya kembali kapan saja.',
  startHere: 'Mulai di sini',
  recommended: 'Disarankan lebih dulu',
  whatsInside: 'Isi panduan',
  moreItems: (n) => `+${n} lainnya`,
  forLabel: 'Fungsi halaman ini',
  todoLabel: 'Yang perlu dilakukan',
  genericNext: 'Buka halaman ini untuk melihatnya dengan data Anda sendiri, lalu tandai modul ini selesai.',
  readinessTitle: 'Siapkan perusahaan Anda untuk ditinjau akuntan',
  readinessBody: 'Kerjakan setiap item agar akuntan Anda menerima gambaran yang lengkap. Setiap item dijelaskan oleh produk, dan Anda yang menentukan mana yang berlaku bagi perusahaan Anda.',
  prepared: (done, total) => `${done} dari ${total} item siap`,

  summaryLabel: 'Progres penyiapan',
  guidesDone: (done, total) => `${done} dari ${total} panduan selesai`,
  summaryInProgress: 'Sedang berjalan',
  summaryCompleted: 'Selesai',
  summaryNotStarted: 'Belum dimulai',

  status: {
    not_started: 'Belum dimulai',
    in_progress: 'Sedang berjalan',
    completed: 'Selesai',
    dismissed: 'Ditutup',
    skipped: 'Dilewati',
  },
  stepStatus: {
    not_started: 'Menunggu',
    viewed: 'Dibuka',
    completed: 'Selesai',
    skipped: 'Dilewati',
  },

  start: 'Mulai',
  continue: 'Lanjutkan',
  review: 'Lihat lagi',
  allGuides: 'Semua panduan',
  back: 'Kembali',
  next: 'Berikutnya',
  dismiss: 'Tutup',
  reset: 'Mulai ulang',
  complete: 'Selesaikan langkah',
  markComplete: 'Tandai selesai',
  skip: 'Lewati langkah',
  openPage: 'Buka halaman',

  stepOf: (n, total) => `Langkah ${n} dari ${total}`,
  moduleOf: (n, total) => `Modul ${n} dari ${total}`,
  required: 'Wajib',
  optional: 'Opsional',
  percentDone: (p) => `${p}% selesai`,
  stepsResolved: (done, total) => `${done} dari ${total} langkah terselesaikan`,

  dismissedBanner: 'Anda menutup panduan ini. Anda dapat memulainya kembali kapan saja.',
  completedBanner: 'Panduan ini sudah selesai. Mulai ulang jika Anda ingin menelusurinya lagi.',
  notStartedBanner: 'Tidak ada yang dicatat sampai Anda memulai. Memulai panduan tidak mengubah data di ruang kerja Anda.',

  needHelp: 'Butuh bantuan?',
  helpBody: 'Onboarding menjelaskan produk — tidak pernah mengubah data Anda. Jika sebuah langkah tidak sesuai dengan yang Anda lihat, berikut cara tercepat untuk melanjutkan.',
  helpItems: [
    'Baca kembali deskripsi langkah beserta petunjuknya. Semua bersifat panduan; tidak ada yang diterapkan otomatis.',
    'Buka halaman yang dirujuk langkah tersebut dan baca teksnya di samping halaman aslinya.',
    'Tanyakan kepada pemilik ruang kerja, atau akuntan Anda, bila langkah menyangkut detail perusahaan atau pajak.',
  ],
  helpFoot: 'Panel ini tidak membuka percakapan dukungan.',
  close: 'Tutup',

  disabledTitle: 'Onboarding belum diaktifkan',
  disabledBody: 'Ruang kerja ini belum mengaktifkan panduan onboarding. Tidak ada yang hilang dari akun Anda — panduannya memang belum tersedia pada instalasi ini.',
  errorTitle: 'Kami tidak dapat memuat onboarding',
  retry: 'Coba lagi',
  noFlows: 'Belum ada panduan onboarding yang diterbitkan untuk ruang kerja ini.',
  noSteps: 'Panduan ini belum memiliki langkah.',
  flowMissing: 'Panduan ini tidak tersedia di ruang kerja ini.',
  notSkippable: 'Langkah ini wajib dan tidak dapat dilewati.',

  guidanceTitle: 'Hanya panduan',
  guidanceBody: 'Langkah-langkah ini menjelaskan apa yang perlu disiapkan dan di mana tempatnya dalam produk. Ini panduan produk umum — bukan nasihat hukum, akuntansi, atau pajak.',
  reviewTitle: 'Minta akuntan meninjau hasilnya',
  reviewBody: 'Sebelum Anda melaporkan atau mengirimkan apa pun, mintalah akuntan yang berkualifikasi meninjau profil perusahaan, detail pajak, dan dokumen Anda. AI Accountant menyusun draf; manusia yang memutuskan.',
}

const ru = {
  eyebrow: 'Рабочее пространство компании',
  title: 'Онбординг',
  subtitle: 'Настройте пространство, изучите продукт и подготовьте профиль компании.',
  language: 'Язык',
  groups: { overview: 'Обзор', finance: 'Финансы', connections: 'Подключения', operations: 'Операции', workspace: 'Пространство' },
  heroTitle: 'Настройте финансовое пространство',
  heroBody: 'Пошаговые маршруты, которые объясняют продукт и что подготовить. Ничего из этого не меняет ваши финансовые данные.',
  nextLabel: 'Ваш следующий шаг',
  nextStepIs: 'Следующий шаг',
  allDone: 'Пространство настроено',
  allDoneBody: 'Все руководства пройдены. Любое из них можно открыть снова.',
  startHere: 'Начните отсюда',
  recommended: 'Рекомендуем начать',
  whatsInside: 'Что внутри',
  moreItems: (n) => `+${n} ещё`,
  forLabel: 'Для чего эта страница',
  todoLabel: 'Что сделать дальше',
  genericNext: 'Откройте страницу, посмотрите её на своих данных и отметьте раздел пройденным.',
  readinessTitle: 'Подготовьте компанию к проверке бухгалтером',
  readinessBody: 'Пройдите каждый пункт, чтобы бухгалтер получил полную картину. Каждый пункт объясняет продукт, а вы решаете, что относится к вашей компании.',
  prepared: (done, total) => `${done} из ${total} пунктов готово`,

  summaryLabel: 'Прогресс настройки',
  guidesDone: (done, total) => `${done} из ${total} руководств завершено`,
  summaryInProgress: 'В процессе',
  summaryCompleted: 'Завершено',
  summaryNotStarted: 'Не начато',

  status: {
    not_started: 'Не начато',
    in_progress: 'В процессе',
    completed: 'Завершено',
    dismissed: 'Скрыто',
    skipped: 'Пропущено',
  },
  stepStatus: {
    not_started: 'Ожидает',
    viewed: 'Открыт',
    completed: 'Готово',
    skipped: 'Пропущен',
  },

  start: 'Начать',
  continue: 'Продолжить',
  review: 'Посмотреть снова',
  allGuides: 'Все руководства',
  back: 'Назад',
  next: 'Далее',
  dismiss: 'Скрыть',
  reset: 'Начать заново',
  complete: 'Завершить шаг',
  markComplete: 'Отметить пройденным',
  skip: 'Пропустить шаг',
  openPage: 'Открыть страницу',

  stepOf: (n, total) => `Шаг ${n} из ${total}`,
  moduleOf: (n, total) => `Раздел ${n} из ${total}`,
  required: 'Обязательный',
  optional: 'Необязательный',
  percentDone: (p) => `${p}% пройдено`,
  stepsResolved: (done, total) => `${done} из ${total} шагов пройдено`,

  dismissedBanner: 'Вы скрыли это руководство. Его можно запустить снова в любой момент.',
  completedBanner: 'Руководство завершено. Начните заново, если хотите пройти его ещё раз.',
  notStartedBanner: 'Пока вы не начали, ничего не записывается. Запуск руководства не меняет данные в пространстве.',

  needHelp: 'Нужна помощь?',
  helpBody: 'Онбординг объясняет продукт и никогда не меняет ваши данные. Если шаг не совпадает с тем, что вы видите, вот самые быстрые способы разобраться.',
  helpItems: [
    'Перечитайте описание шага и инструкции. Это подсказки — ничего не применяется автоматически.',
    'Откройте страницу, о которой говорит шаг, и просмотрите её вместе с текстом шага.',
    'Спросите владельца пространства или бухгалтера, если шаг касается данных компании или налогов.',
  ],
  helpFoot: 'Эта панель не создаёт обращение в поддержку.',
  close: 'Закрыть',

  disabledTitle: 'Онбординг ещё не включён',
  disabledBody: 'В этом пространстве пошаговые руководства пока не включены. С вашим аккаунтом всё в порядке — руководства просто недоступны в этой сборке.',
  errorTitle: 'Не удалось загрузить онбординг',
  retry: 'Повторить',
  noFlows: 'Для этого пространства пока не опубликовано ни одного руководства.',
  noSteps: 'В этом руководстве пока нет шагов.',
  flowMissing: 'Это руководство недоступно в текущем пространстве.',
  notSkippable: 'Этот шаг обязательный, его нельзя пропустить.',

  guidanceTitle: 'Только рекомендации',
  guidanceBody: 'Эти шаги объясняют, что подготовить и где это находится в продукте. Это общие продуктовые рекомендации, а не юридическая, бухгалтерская или налоговая консультация.',
  reviewTitle: 'Покажите результат бухгалтеру',
  reviewBody: 'Перед подачей или отправкой любых документов попросите квалифицированного бухгалтера проверить профиль компании, налоговые данные и документы. AI-бухгалтер готовит черновик — решение принимает человек.',
}

const DICTS = { en, id, ru }

/** UI strings for a locale, with per-key English fallback. Never throws. */
export function uiStrings(locale) {
  const dict = DICTS[locale]
  if (!dict || dict === en) return en
  return {
    ...en, ...dict,
    status: { ...en.status, ...dict.status },
    stepStatus: { ...en.stepStatus, ...dict.stepStatus },
    groups: { ...en.groups, ...dict.groups },
  }
}

export default uiStrings
