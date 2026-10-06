'use strict';
// Shared vocabulary, not fixture/question IDs. Both topic routing and concept ranking are multilingual.
const topics={
 business_regimes:/umkm|0[.,]5\s*%|business regime|tax regime|режим|оборот|turnover|omzet|peredaran bruto|pp\s*(55|20|23)\b|rezim/iu,
 ppn_pkp:/\bppn\b|\bpkp\b|\bvat\b|ндс|добавленн|faktur|11\s*%|12\s*%/iu,
 pph21:/pph\s*(pasal\s*)?21|payroll|зарплат|сотрудник|employee|pegawai|\bter\b|individual lawyer|юрист.*физлицо|pengacara orang pribadi|gaji|salary/iu,
 pph26:/pph\s*(pasal\s*)?26|foreign|нерезидент|иностранн|treaty|p3b|luar negeri|non.?resident/iu,
 pph23:/pph\s*(pasal\s*)?23|consult|konsultan|консульт|service|услуг|jasa|biaya layanan|equipment|оборудован|peralatan|reimbursement|возмещен/iu,
 pph_final_rent:/pph\s*(final|4)|rent|аренд|sewa|land|building|tanah|bangunan|hotel|отел|penginapan|pp\s*(34|29)\b/iu,
 pph25_29:/pph\s*(pasal\s*)?(25|29)|instalment|installment|аванс|годов|annual|tahunan|kurang bayar|angsuran/iu,
 deadlines:/deadline|due|срок|когда|платить до|подавать|сдать|deposit|filing|filed|batas waktu|jatuh tempo|lapor|setor|dibayar|disampaikan|kapan|payment date|pay by|tanggal.*(bayar|setor)/iu,
};
const concepts={
 history:/histor|past|стар|прошл|2017|2024|January\s*2025|январ.*2025|Januari\s*2025|sebelum|lama/iu,
 amendment:/amend|chang|поправ|измен|меняет|perubahan|ubah|pp\s*20/iu,
 lodging:/hotel|отел|penginapan|lodging|accommodation/iu,
 luxury:/luxury|mewah|роскош|конечного|final consumer|konsumen akhir/iu,
 payer:/withhold|pemotong|удерж|tenant|penyewa|плательщик/iu,
 base:/base|баз|gross|bruto|dpp|11\/12/iu,
 service_charge:/service charge|biaya layanan|обслужив|охран/iu,
 reimbursement:/reimburs|возмещ|penggantian.*biaya/iu,
 individual:/individual|физлицо|orang pribadi|lawyer|юрист|pengacara/iu,
 exception:/except|исключ|без|tanpa|pengecualian/iu,
 npwp:/npwp|nik/iu,
 credit:/credit|зачесть|вычет|kredit/iu,
 pkp:/pkp/iu,
 last_period:/last|послед|terakhir|reconcil|сверк|rekonsil/iu,
 salary:/salary|зарплат|gaji|payroll/iu,
 rate:/rate|ставк|tarif|%|сколько|how much|berapa/iu,
 residency:/residen|резидент|domisili/iu,
 treaty:/treaty|договор.*налог|p3b/iu,
 installment:/pph\s*25|instal|аванс|angsuran/iu,
 annual:/pph\s*29|annual|годов|tahunan/iu,
 payment:/pay|плат|bayar|setor|deposit/iu,
 filing:/fil|отч|под|lapor|spt|disampaikan/iu,
 holiday:/holiday|выходн|нерабоч|libur/iu,
 repeal:/repeal|отмен|pp\s*29|dicabut/iu,
};
module.exports={topics,concepts};
