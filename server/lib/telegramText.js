'use strict';
// Telegram messages are sent with parse_mode HTML. Any value that came from a person or a document
// (counterparty, submitter name, OCR line, free text) is escaped, so it can neither inject markup
// (a fake <a href> inside an approval notice) nor break the message (Telegram rejects bad HTML and
// the notice would be lost). Only the template's own <b>…</b> stays markup.
const tgEsc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = { tgEsc };
