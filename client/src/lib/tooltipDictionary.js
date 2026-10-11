// client/src/lib/tooltipDictionary.js
// Universal dictionary for financial and operational tooltips across CFO Finance OS
// Each term answers three concise questions:
// 1. what: What is it?
// 2. how: How is it calculated or how does it work?
// 3. interpret: How to interpret the result?

export const TOOLTIP_DICTIONARY = {
  daily_spend: {
    ru: {
      title: 'Расходы в день',
      what: 'Средние ежедневные оплаченные операционные расходы бизнеса за скользящий период (до 30 дней).',
      how: 'Сумма прямых затрат (direct costs) и операционных расходов (OPEX) за период, разделённая на количество дней данных (до 30). Внутренние переводы, кредиты, налоги и CAPEX исключены.',
      interpret: 'Показывает базовую стоимость поддержания жизнедеятельности компании в день, независимо от поступлений выручки.',
    },
    en: {
      title: 'Daily spend',
      what: 'Average daily paid operating expenses of the business over a rolling window (up to 30 days).',
      how: 'Sum of direct costs and operating expenses (OPEX) in the window divided by days of data (up to 30). Internal transfers, financing, taxes and CAPEX are strictly excluded.',
      interpret: 'Reflects the baseline cost of running company operations per day, regardless of incoming revenue.',
    },
    id: {
      title: 'Pengeluaran per hari',
      what: 'Rata-rata pengeluaran operasional harian yang telah dibayar selama periode bergulir (hingga 30 hari).',
      how: 'Jumlah biaya langsung dan beban operasional (OPEX) dibagi jumlah hari data (hingga 30). Transfer internal, pendanaan, pajak, dan CAPEX dikecualikan.',
      interpret: 'Menunjukkan biaya dasar untuk menjalankan operasional bisnis per hari, terlepas dari pendapatan masuk.',
    },
  },

  gross_net_burn: {
    ru: {
      title: 'Чистое сжигание (Net burn)',
      what: 'Превышение операционных денежных выплат над операционными поступлениями за период.',
      how: 'max(0, (Операционные расходы − Операционные поступления) / дни периода). Если поступления покрывают расходы, чистый burn равен 0.',
      interpret: '0 означает, что бизнес прибылен или безубыточен по операционному потоку. Положительное число показывает темп сокращения доступной кассы.',
    },
    en: {
      title: 'Net cash burn',
      what: 'Excess of operating cash outflows over operating cash inflows during the measurement window.',
      how: 'max(0, (Operating cash out − Operating revenue received) / window days). If receipts cover spend, net burn is 0.',
      interpret: '0 means operations are cash-flow positive or break-even. A positive amount shows the rate at which available cash is depleting.',
    },
    id: {
      title: 'Net burn (Bakar kas bersih)',
      what: 'Kelebihan arus kas keluar operasional atas arus kas masuk operasional selama periode.',
      how: 'max(0, (Kas keluar operasional − Pendapatan operasional diterima) / hari jendela). Jika penerimaan menutup biaya, net burn bernilai 0.',
      interpret: '0 berarti operasional menghasilkan arus kas positif. Nilai positif menunjukkan laju penyusutan kas tersedia.',
    },
  },

  runway: {
    ru: {
      title: 'Запас хода (Runway)',
      what: 'Прогнозируемое количество дней, на которое хватит текущего остатка денег при сохранении темпа чистого сжигания.',
      how: 'Текущий подтверждённый остаток кассы / Ежедневный чистый burn. Если чистый burn равен 0 (поток положителен), runway не исчерпывается и отображается как «—».',
      interpret: 'Менее 30 дней — зона риска, требуются срочные поступления или сокращение затрат. Прочерк при положительном потоке означает самоокупаемость.',
    },
    en: {
      title: 'Runway',
      what: 'Estimated days until available cash is exhausted at the current net burn rate.',
      how: 'Total confirmed cash / Daily net burn. If net burn is 0 (positive cash flow), runway does not deplete and displays as "—".',
      interpret: 'Under 30 days requires urgent attention. A dash with positive cash flow indicates self-sustaining operations.',
    },
    id: {
      title: 'Runway (Daya tahan kas)',
      what: 'Perkiraan jumlah hari saldo kas bertahan dengan laju pembakaran kas bersih saat ini.',
      how: 'Total kas terkonfirmasi / Net burn harian. Jika net burn 0 (arus kas positif), runway tidak habis dan ditampilkan sebagai "—".',
      interpret: 'Di bawah 30 hari adalah zona waspada. Tanda strip dengan arus kas positif menunjukkan bisnis mandiri secara operasional.',
    },
  },

  forecast_balance: {
    ru: {
      title: 'Прогноз кассы на 30 дней',
      what: 'Ожидаемый баланс кассы через 30 дней на основе подтверждённых обязательств и расходов.',
      how: 'Текущий баланс + Дебиторка со сроком в пределах 30 дней − Кредиторка со сроком в пределах 30 дней − (Ежедневный расход × 30). Обязательства без точной даты исключаются.',
      interpret: 'Позволяет заранее увидеть кассовый разрыв. Назначение даты недатированным счетам сразу уточняет прогноз.',
    },
    en: {
      title: 'Cash in 30 days forecast',
      what: 'Projected cash balance in 30 days based on confirmed dated obligations and daily expenses.',
      how: 'Current cash + Receivables due within 30 days − Payables due within 30 days − (Daily spend × 30). Undated obligations are excluded.',
      interpret: 'Helps identify potential cash shortfalls early. Adding due dates to open obligations updates the projection instantly.',
    },
    id: {
      title: 'Proyeksi kas 30 hari',
      what: 'Proyeksi saldo kas dalam 30 hari berdasarkan kewajiban bertanggal dan pengeluaran harian.',
      how: 'Kas saat ini + Piutang jatuh tempo 30 hari − Utang jatuh tempo 30 hari − (Pengeluaran harian × 30). Kewajiban tanpa tanggal tidak dihitung.',
      interpret: 'Mendeteksi potensi defisit kas lebih awal. Menentukan tanggal jatuh tempo langsung memperbarui proyeksi.',
    },
  },

  overdue_obligation: {
    ru: {
      title: 'Просроченное обязательство',
      what: 'Задолженность перед поставщиком или клиентом, срок оплаты которой уже наступил.',
      how: 'Фиксируется, когда due_date < текущей даты и remaining_amount > 0 в подтверждённых записях.',
      interpret: 'Требует первоочередной оплаты или напоминания контрагенту для сохранения репутации и денежного потока.',
    },
    en: {
      title: 'Overdue obligation',
      what: 'Payable or receivable whose due date has passed with an unpaid balance remaining.',
      how: 'Flagged when due_date < current date and remaining_amount > 0 on confirmed records.',
      interpret: 'Requires priority settlement or collection to protect business standing and cash flow.',
    },
    id: {
      title: 'Kewajiban jatuh tempo',
      what: 'Utang atau piutang yang telah melewati tanggal jatuh tempo dengan sisa tagihan belum lunas.',
      how: 'Ditandai jika due_date < tanggal hari ini dan remaining_amount > 0 pada catatan terkonfirmasi.',
      interpret: 'Memerlukan pelunasan atau penagihan prioritas untuk menjaga arus kas dan reputasi.',
    },
  },

  fx_revaluation: {
    ru: {
      title: 'Валютная переоценка',
      what: 'Пересчёт валютных остатков (USD, EUR, SGD и др.) в базовую валюту учёта (IDR).',
      how: 'Остаток в валюте умножается на курс JISDOR/рыночный курс на дату расчёта. Разница курсов отражается справочно.',
      interpret: 'Показывает эквивалентную стоимость мультивалютных резервов без фиксации прибыли/убытка до реальной конвертации.',
    },
    en: {
      title: 'Currency valuation',
      what: 'Valuation of foreign currency balances (USD, EUR, SGD, etc.) in base accounting currency (IDR).',
      how: 'Foreign balance multiplied by JISDOR or market reference rate as of the calculation date.',
      interpret: 'Displays the equivalent purchasing power of multi-currency holdings without realizing FX gain/loss until converted.',
    },
    id: {
      title: 'Valuasi mata uang asing',
      what: 'Penilaian saldo mata uang asing (USD, EUR, SGD, dll.) ke mata uang dasar pembukuan (IDR).',
      how: 'Saldo valas dikalikan kurs JISDOR atau pasar pada tanggal perhitungan.',
      interpret: 'Menampilkan nilai setara cadangan multivaluta tanpa merealisasikan laba/rugi kurs sebelum konversi nyata.',
    },
  },

  internal_transfer: {
    ru: {
      title: 'Внутренний перевод',
      what: 'Перемещение ликвидности между счетами и кошельками одной компании.',
      how: 'Создаёт две связанные проводки (списание и зачисление) с общим transfer_id. Строго исключается из выручки, OPEX и burn rate.',
      interpret: 'Общая сумма денег компании не меняется. Перевод не является доходом или расходом бизнеса.',
    },
    en: {
      title: 'Internal wallet transfer',
      what: 'Movement of liquidity between accounts belonging to the same company.',
      how: 'Creates paired debit and credit ledger rows sharing a transfer_id. Excluded from revenue, OPEX and burn rate.',
      interpret: 'Total company cash remains conserved. The movement is neutral and never represents business profit or loss.',
    },
    id: {
      title: 'Transfer antar rekening internal',
      what: 'Perpindahan likuiditas antar rekening milik perusahaan yang sama.',
      how: 'Membuat sepasang catatan debit dan kredit dengan transfer_id bersama. Dikecualikan dari pendapatan, OPEX, dan burn rate.',
      interpret: 'Total saldo kas perusahaan tetap utuh. Perpindahan ini netral dan bukan pendapatan maupun beban.',
    },
  },

  total_current_balance: {
    ru: {
      title: 'Текущий баланс',
      what: 'Фактический подтверждённый остаток денежных средств на счетах компании на текущий момент.',
      how: 'Рассчитывается как начальный баланс плюс все подтверждённые поступления минус подтверждённые списания. Включает остатки на всех активных счетах бизнеса.',
      interpret: 'Отражает реальную доступную ликвидность компании для операционной деятельности и покрытия обязательств.',
    },
    en: {
      title: 'Current total balance',
      what: 'Actual confirmed cash balance across company accounts at the present moment.',
      how: 'Calculated as opening balance plus all confirmed cash inflows minus confirmed cash outflows across active business accounts.',
      interpret: 'Represents real available liquidity for immediate business operations and obligations.',
    },
    id: {
      title: 'Total saldo saat ini',
      what: 'Saldo kas nyata yang terkonfirmasi di seluruh rekening perusahaan saat ini.',
      how: 'Dihitung dari saldo awal ditambah seluruh penerimaan kas terkonfirmasi dikurangi pengeluaran kas terkonfirmasi pada rekening aktif.',
      interpret: 'Menunjukkan likuiditas riil yang dapat digunakan untuk operasional dan pemenuhan kewajiban.',
    },
  },

  opening_balance: {
    ru: {
      title: 'Начальный баланс',
      what: 'Исходный остаток средств на счёте при его подключении к системе.',
      how: 'Записывается со специальным маркером категории Opening balance. Не учитывается в операционной выручке текущего периода.',
      interpret: 'Отражает уже имевшийся капитал компании, защищая отчётность от ложного завышения доходов.',
    },
    en: {
      title: 'Opening balance',
      what: 'Initial balance seeded into a wallet when it is first registered.',
      how: 'Recorded with a distinct category marker. Excluded from operating revenue for any period.',
      interpret: 'Represents capital already possessed by the business, preventing artificial inflation of earned income.',
    },
    id: {
      title: 'Saldo awal',
      what: 'Saldo awal rekening saat pertama kali didaftarkan ke sistem.',
      how: 'Dicatat dengan penanda kategori khusus. Dikecualikan dari pendapatan operasional periode berjalan.',
      interpret: 'Mencerminkan modal yang sudah ada sebelumnya, mencegah penggelembungan angka pendapatan usaha.',
    },
  },

  tax_data_status: {
    ru: {
      title: 'Статус налоговых данных',
      what: 'Уровень юридической и документальной подтверждённости налоговых атрибутов компании.',
      how: 'Делится на: Заявлено пользователем (User declared), Загружен документ (Document uploaded), Подтверждено бухгалтером (Accountant verified).',
      interpret: 'Пока статус не подтверждён бухгалтером или первичным документом, налоговые расчёты носят ознакомительный характер.',
    },
    en: {
      title: 'Tax data verification status',
      what: 'Level of legal and evidentiary confirmation of company tax attributes.',
      how: 'Distinguishes between: User declared, Document uploaded, and Accountant verified.',
      interpret: 'Until verified by an accountant or primary documents, compliance rules remain advisory rather than certified.',
    },
    id: {
      title: 'Status verifikasi data pajak',
      what: 'Tingkat kepastian bukti hukum atribut pajak perusahaan.',
      how: 'Membedakan antara: Dinyatakan pengguna, Dokumen diunggah, dan Diverifikasi akuntan.',
      interpret: 'Sebelum diverifikasi oleh akuntan atau dokumen primer, aturan kepatuhan bersifat rekomendasi.',
    },
  },
};
