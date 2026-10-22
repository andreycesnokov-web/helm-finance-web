# CFO AI — Accountant Pilot Onboarding Guide & Feedback Form
## Panduan Pilot Akuntan & Formulir Evaluasi

Target Company: **PT Helm Care Indonesia**  
Target Application: **https://app.cfo-ai.site**

---

# Part 1: English Guide

## 1. Welcome to the CFO AI Pilot
Thank you for participating in the CFO AI pilot. The goal of this pilot is to evaluate how effectively CFO AI assists accountants in processing real Indonesian invoices, receipts (*kwitansi*), tax forms (*faktur pajak*), and corporate documents without compromising financial data integrity.

## 2. Getting Started & Accepting Your Invitation
1. **Receive Invite:** The company owner will generate an invite link (e.g. `https://app.cfo-ai.site/invite/ABC123XYZ`) or send you an email invitation.
2. **Access the Link:** Open the invite URL in your browser (Google Chrome or Microsoft Edge recommended).
3. **Sign In / Create Account:**
   - Enter your professional email address.
   - You will receive a 6-digit verification code (*magic link OTP*) sent by `auth.cfo-ai.site`.
   - Enter the code to confirm your email.
4. **Company Scope:** You will immediately be connected to **PT Helm Care Indonesia** with the dedicated **Accountant** role.
   > [!NOTE]
   > You have full access to view, review, edit, and link documents for PT Helm Care Indonesia, but you will not have platform admin rights or access to any other company.

## 3. How to Upload Documents
1. In the sidebar, navigate to **Documents** (`/business/documents`).
2. Click the **Upload Document** button in the top right.
3. Drag & drop or select your file:
   - Supported formats: **PDF**, **JPG**, **PNG**, **WEBP**, **TIFF** (Max size: 8 MB).
4. Select the optional intent or document category if known (e.g. Invoice, Receipt, Corporate Document), or leave it on Auto-detect.
5. Click **Upload**. The document is securely stored and checksum-verified via SHA-256.

## 4. Reviewing OCR & Extraction Results
1. By default, newly uploaded documents appear in the **Evidence Inbox** tab.
2. If the document is a scanned image or image-only PDF, CFO AI automatically processes it with **Nanonets OCR**.
3. In the review panel, observe:
   - **Source Badge:** `"Read by Nanonets OCR"` (or `"Read from PDF text"` for digital invoices).
   - **Status Badge:** `"Accountant review"` (highlighted with a warning badge).
   - **Extracted Fields:**
     - Document Type (e.g. *Invoice*, *Receipt*)
     - Supplier / Counterparty Name
     - Invoice Date & Due Date
     - Gross Amount & Currency (e.g. *IDR 4,500,000*)
     - Line items table
     - Tax amounts (*DPP, PPN*) — Note: unprinted tax figures will remain blank (`null`) rather than guessed.
4. **Original Document Preview:** Click the document thumbnail or **View Original** to open the side-by-side PDF/image viewer.

## 5. Correcting & Confirming Extracted Fields
1. If any field was misread or requires adjustment:
   - Click **Edit Fields** in the review drawer.
   - Adjust the Supplier Name, Invoice Number, Gross Amount, or Date.
   - If the document is a corporate identity record (NPWP, NIB, Akta), click **Move to Company Vault**.
2. Click **Confirm Figures**.
   - Your name and the updated values are permanently recorded in the immutable `document_audit` log.

## 6. Linking to a Bank Transaction
1. In the document detail view, click **Link to Transaction**.
2. Search and select the corresponding bank outflow from the transaction list.
3. Confirm the link.
   > [!IMPORTANT]
   > Zero Auto-Posting Guarantee: Linking a document confirms supporting evidence for an existing bank record. CFO AI will **never** create automatic journal entries, mutate your cash balances, or file tax declarations without your explicit approval.

## 7. Reporting Issues
If you encounter an unreadable document, an error banner, or a system failure:
- Take a screenshot of the review drawer and document preview.
- Email your feedback directly to the pilot administrator or submit the evaluation form below.

---

# Bagian 2: Panduan Bahasa Indonesia

## 1. Selamat Datang di Program Pilot CFO AI
Terima kasih telah berpartisipasi dalam program pilot CFO AI. Program ini bertujuan menguji efektivitas CFO AI dalam membantu akuntan memproses faktur, kwitansi, bukti potong pajak, dan dokumen perusahaan Indonesia secara akurat dan aman.

## 2. Cara Registrasi & Menerima Undangan
1. **Menerima Undangan:** Pemilik perusahaan akan memberikan tautan undangan (contoh: `https://app.cfo-ai.site/invite/ABC123XYZ`) atau mengirimkan undangan ke email Anda.
2. **Buka Tautan:** Buka tautan tersebut di peramban (disarankan Google Chrome atau Microsoft Edge).
3. **Masuk / Buat Akun:**
   - Masukkan alamat email profesional Anda.
   - Anda akan menerima kode verifikasi 6 digit (*OTP*) dari `auth.cfo-ai.site`.
   - Masukkan kode 6 digit tersebut.
4. **Akses Perusahaan:** Anda akan langsung terhubung ke **PT Helm Care Indonesia** dengan peran resmi **Accountant**.
   > [!NOTE]
   > Anda memiliki akses penuh untuk memeriksa, mengedit nilai keuangan, dan menautkan dokumen PT Helm Care Indonesia, namun terisolasi total dari perusahaan lain dan pengaturan platform admin.

## 3. Cara Mengunggah Dokumen
1. Pada menu navigasi sebelah kiri, klik **Documents** (`/business/documents`).
2. Klik tombol **Upload Document** di pojok kanan atas.
3. Unggah file dokumen Anda:
   - Format yang didukung: **PDF**, **JPG**, **PNG**, **WEBP**, **TIFF** (Maksimal 8 MB).
4. Klik **Upload**. File disimpan dan diverifikasi keasliannya dengan SHA-256.

## 4. Memeriksa Hasil Pembacaan OCR
1. Dokumen yang baru diunggah akan masuk ke tab **Evidence Inbox**.
2. Untuk dokumen hasil pindai (scan) atau gambar, CFO AI akan memprosesnya secara otomatis menggunakan **Nanonets OCR**.
3. Periksa informasi pada panel tinjauan:
   - **Label Sumber:** `"Read by Nanonets OCR"` (atau `"Read from PDF text"` untuk PDF digital).
   - **Status:** `"Accountant review"` (memerlukan verifikasi akuntan).
   - **Data yang Diekstrak:**
     - Tipe Dokumen (Invoice, Kwitansi, dll.)
     - Nama Penjual / Supplier
     - Tanggal Dokumen & Jatuh Tempo
     - Total Tagihan & Mata Uang (contoh: *IDR 4.500.000*)
     - Rincian item barang/jasa
     - Pajak (*DPP, PPN*) — Nilai yang tidak tercetak pada dokumen fisik tidak akan ditebak secara sembarangan.
4. **Melihat Dokumen Asli:** Klik thumbnail dokumen atau tombol **View Original** untuk melihat tampilan dokumen asli.

## 5. Mengoreksi dan Mengonfirmasi Data
1. Jika terdapat angka atau teks yang kurang tepat:
   - Klik **Edit Fields**.
   - Perbaiki Nama Supplier, Nomor Dokumen, atau Jumlah Tagihan.
   - Jika dokumen merupakan dokumen legalitas perusahaan (NPWP, NIB, Akta), pilih **Move to Company Vault**.
2. Klik **Confirm Figures**. Perubahan Anda akan tercatat dalam audit trail permanen.

## 6. Menautkan ke Transaksi Bank
1. Klik **Link to Transaction**.
2. Pilih transaksi mutasi rekening yang sesuai dari daftar transaksi.
3. Klik **Confirm Link**.
   > [!IMPORTANT]
   > Perlindungan Pembukuan: Menautkan dokumen hanya berfungsi sebagai bukti pendukung (*evidence voucher*). CFO AI **tidak akan pernah** membuat jurnal akuntansi liar atau mengubah saldo kas Anda secara otomatis.

---

# Part 3 / Bagian 3: Feedback & Evaluation Form / Formulir Evaluasi

Please complete this feedback form after testing 5–10 documents:

| Criteria / Kriteria | Rating (1 - 5) | Comments & Specific Examples / Catatan & Contoh |
| :--- | :---: | :--- |
| **1. OCR Accuracy**<br>*(Ketepatan pembacaan angka, nama vendor, tanggal, & mata uang)* | ⭐⭐⭐⭐⭐ | |
| **2. Table / Line Items Parsing**<br>*(Ketepatan membaca rincian tabel barang & jasa)* | ⭐⭐⭐⭐⭐ | |
| **3. Interface Usability**<br>*(Kemudahan penggunaan antarmuka web, drawer, & pratinjau)* | ⭐⭐⭐⭐⭐ | |
| **4. Processing Speed**<br>*(Kecepatan unggah dan pembacaan dokumen)* | ⭐⭐⭐⭐⭐ | |
| **5. Classification Quality**<br>*(Ketepatan membedakan invoice, kwitansi, mutasi bank, & akta)* | ⭐⭐⭐⭐⭐ | |
| **6. Overall Utility for Accounting**<br>*(Manfaat nyata untuk efisiensi pekerjaan pembukuan bulanan)* | ⭐⭐⭐⭐⭐ | |

### Open-Ended Questions / Pertanyaan Terbuka:
1. What was the most challenging document you uploaded, and how did CFO AI handle it?  
   *(Dokumen apa yang paling sulit dibaca, dan bagaimana sistem menanganinya?)*  
   `...`

2. Did you encounter any missing features or confusing buttons in the Document Center?  
   *(Apakah ada tombol yang membingungkan atau fitur penting yang belum tersedia?)*  
   `...`

3. Would you feel confident using CFO AI for monthly tax preparation and audit defense?  
   *(Apakah Anda merasa terbantu menggunakan CFO AI untuk penutupan buku dan pemeriksaan pajak?)*  
   `...`
