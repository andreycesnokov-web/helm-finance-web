// ── Bot reply strings (ru / id / en) ────────────────────────────────────────
function fmtAmount(n, lang) {
  const locale = lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-US';
  return Number(n || 0).toLocaleString(locale);
}

const M = {
  connectOk: {
    ru: '✅ Telegram подключён к CFO AI.\n\nТеперь отправьте тестовые сообщения из туториала, чтобы завершить обучение.',
    id: '✅ Telegram berhasil terhubung ke CFO AI.\n\nSekarang kirim pesan tes dari tutorial untuk menyelesaikan onboarding.',
    en: '✅ Telegram connected to CFO AI.\n\nNow send the test messages from the tutorial to complete onboarding.',
  },
  connectFail: {
    ru: 'Не удалось подключить Telegram. Откройте ссылку из CFO AI ещё раз или обратитесь к администратору.',
    id: 'Gagal menghubungkan Telegram. Buka kembali tautan dari CFO AI atau hubungi administrator.',
    en: 'Could not connect Telegram. Open the link from CFO AI again or contact your administrator.',
  },
  notConnected: {
    ru: 'Ваш Telegram ещё не подключён к CFO AI.\nОткройте ссылку из Web App и нажмите Start.',
    id: 'Telegram Anda belum terhubung ke CFO AI.\nBuka tautan dari Web App dan tekan Start.',
    en: 'Your Telegram is not connected to CFO AI yet.\nOpen the link from the Web App and press Start.',
  },
  uncertainTest: {
    ru: 'Я не уверен, что это за тип заявки. Напишите проще:\n1) Нужно оплатить поставщику 100,000 IDR завтра\n2) Клиент ABC должен оплатить 250,000 IDR до пятницы\n3) Я оплатил бензин 50,000 IDR своими деньгами',
    id: 'Saya tidak yakin jenis permintaan ini. Tulis lebih sederhana:\n1) Bayar supplier 100,000 IDR besok\n2) PT ABC harus bayar 250,000 IDR sebelum Jumat\n3) Saya bayar bensin 50,000 IDR pakai uang pribadi',
    en: "I'm not sure what type of request this is. Write it simpler:\n1) Need to pay supplier 100,000 IDR tomorrow\n2) Client ABC should pay 250,000 IDR by Friday\n3) I paid fuel 50,000 IDR with my own money",
  },
  uncertainReal: {
    ru: 'Я не уверен. Напишите одним из форматов:\n\nНужно оплатить поставщику 5 млн завтра\nКлиент ABC должен оплатить 10 млн до пятницы\nЯ оплатил бензин 300k своими деньгами',
    id: 'Saya tidak yakin. Tulis dengan salah satu format:\n\nBayar supplier 5 juta besok\nPT ABC harus bayar 10 juta sebelum Jumat\nSaya bayar bensin 300k pakai uang pribadi',
    en: "I'm not sure. Use one of these formats:\n\nNeed to pay supplier 5M tomorrow\nClient ABC should pay 10M by Friday\nI paid fuel 300k with my own money",
  },
  realCreated: {
    ru: 'Я понял. Создал заявку на проверку.\nОна не изменит финансы компании, пока Owner/Admin не подтвердит.',
    id: 'Dimengerti. Saya buat permintaan untuk ditinjau.\nIni tidak mengubah keuangan perusahaan sampai Owner/Admin menyetujui.',
    en: 'Got it. I created a request for review.\nIt will not change company finances until Owner/Admin approves.',
  },
  onboardingDone: {
    ru: '🎉 Обучение завершено.\n\nТеперь вы можете отправлять реальные финансовые заявки в CFO AI через Telegram.\nВладелец или администратор будет подтверждать их перед тем, как они повлияют на финансы компании.',
    id: '🎉 Onboarding selesai.\n\nSekarang Anda bisa mengirim permintaan keuangan nyata ke CFO AI lewat Telegram.\nOwner atau admin akan menyetujuinya sebelum memengaruhi keuangan perusahaan.',
    en: '🎉 Onboarding complete.\n\nYou can now send real financial requests to CFO AI through Telegram.\nThe owner or admin will approve them before they affect company finances.',
  },
  genericError: {
    ru: 'Что-то пошло не так. Попробуйте ещё раз позже.',
    id: 'Terjadi kesalahan. Coba lagi nanti.',
    en: 'Something went wrong. Please try again later.',
  },
};

const TYPE_LABELS = {
  payable:         { ru: 'Обязательство к оплате', id: 'Kewajiban pembayaran', en: 'Payable' },
  receivable:      { ru: 'Ожидаемая оплата от клиента', id: 'Pembayaran dari klien', en: 'Receivable' },
  expense_request: { ru: 'Расход сотрудника / компенсация', id: 'Pengeluaran karyawan / penggantian', en: 'Employee expense / reimbursement' },
};

function trainingReply(type, amount, lang) {
  const L = lang in M.connectOk ? lang : 'en';
  const label = (TYPE_LABELS[type] || TYPE_LABELS.payable)[L];
  const amt = `${fmtAmount(amount, L)} IDR`;
  const head = { ru: '✅ Тестовая заявка создана.', id: '✅ Permintaan tes dibuat.', en: '✅ Test request created.' }[L];
  const typeLine   = { ru: 'Тип', id: 'Jenis', en: 'Type' }[L];
  const amtLine    = { ru: 'Сумма', id: 'Jumlah', en: 'Amount' }[L];
  const statusLine = { ru: 'Статус: training / ожидает подтверждения', id: 'Status: training / menunggu persetujuan', en: 'Status: training / pending approval' }[L];
  const footer     = { ru: 'Это тест. Кэш компании не изменился.', id: 'Ini hanya tes. Kas perusahaan tidak berubah.', en: 'This is only a test. Company cash was not changed.' }[L];
  return `${head}\n\n${typeLine}: ${label}\n${amtLine}: ${amt}\n${statusLine}\n\n${footer}`;
}

function msg(key, lang) {
  const L = (M[key] && lang in M[key]) ? lang : 'en';
  return M[key][L];
}

module.exports = { msg, trainingReply, fmtAmount };
