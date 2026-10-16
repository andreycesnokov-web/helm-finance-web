/* CFO AI — public pricing loader (no dependencies). Fills the marketing pricing page from the PUBLISHED catalog
 * (GET /api/public/plans), so the website and the app always show the same plans.
 *
 *   <script src="https://<app-origin>/embed/cfo-pricing.js" data-api="https://<app-origin>/api/public/plans" defer></script>
 *
 * Markup contract (static text stays when the API is unreachable):
 *   [data-cfo-plan-card="starter"]                     hidden when the plan is not published
 *   [data-cfo-plan="starter"][data-cfo-field="price|name|description|trial-days|interval"]
 *   [data-cfo-plan="starter"][data-cfo-limit="transactions"]   1,000 · Unlimited · Not included
 *   [data-cfo-plan="starter"][data-cfo-feature="payroll"]      ✓ / —  (+ " (Beta)" for beta modules)
 *   [data-cfo-glossary]                                what each limit counts, at-limit behaviour, trial
 * Language: data-lang on the script, else <html lang>, else en (en / ru / id).
 */
(function () {
  var script = document.currentScript;
  var api = (script && script.getAttribute('data-api')) || '/api/public/plans';
  var lang = ((script && script.getAttribute('data-lang')) || document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  if (['en', 'ru', 'id'].indexOf(lang) < 0) lang = 'en';
  var T = {
    en: { unlimited: 'Unlimited', none: 'Not included', yes: '✓', no: '—', beta: ' (Beta)', day: function (n) { return n + (n === 1 ? ' day' : ' days'); },
      block: 'At the limit new requests of this kind are refused until the next period or an upgrade; your data stays available.',
      warn: 'At the limit you get a warning; requests continue.', trial: function (n) { return 'Free trial: ' + n + ', no card required. One trial per company.'; },
      month: '/month' },
    ru: { unlimited: 'Без ограничений', none: 'Не входит', yes: '✓', no: '—', beta: ' (бета)', day: function (n) { return n + ' дн.'; },
      block: 'При достижении лимита новые запросы этого типа не принимаются до следующего периода или смены тарифа; данные остаются доступны.',
      warn: 'При достижении лимита показывается предупреждение; работа продолжается.', trial: function (n) { return 'Бесплатный trial: ' + n + ', без карты. Один trial на компанию.'; },
      month: '/мес' },
    id: { unlimited: 'Tanpa batas', none: 'Tidak termasuk', yes: '✓', no: '—', beta: ' (Beta)', day: function (n) { return n + ' hari'; },
      block: 'Saat batas tercapai, permintaan baru jenis ini ditolak sampai periode berikutnya atau upgrade; data Anda tetap tersedia.',
      warn: 'Saat batas tercapai Anda mendapat peringatan; permintaan tetap berjalan.', trial: function (n) { return 'Uji coba gratis: ' + n + ', tanpa kartu. Satu uji coba per perusahaan.'; },
      month: '/bulan' },
  }[lang];
  function tr(o) { return (o && (o[lang] || o.en)) || ''; }
  function num(n) { try { return Number(n).toLocaleString(lang === 'id' ? 'id-ID' : lang === 'ru' ? 'ru-RU' : 'en-US'); } catch (e) { return String(n); } }
  function money(minor, cur) {
    var v = Number(minor) / 100, whole = v === Math.floor(v);
    try { return v.toLocaleString(lang === 'id' ? 'id-ID' : lang === 'ru' ? 'ru-RU' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 }); }
    catch (e) { return cur + ' ' + v; }
  }
  function limitText(l) { return l.state === 'unlimited' ? T.unlimited : l.state === 'disabled' ? T.none : l.state === 'limited' ? num(l.value) : null; }
  function each(sel, fn) { var n = document.querySelectorAll(sel); for (var i = 0; i < n.length; i++) fn(n[i]); }
  function apply(cat) {
    var plans = {}; (cat.plans || []).forEach(function (p) { plans[p.plan] = p; });
    each('[data-cfo-plan-card]', function (el) { if (!plans[el.getAttribute('data-cfo-plan-card')]) el.style.display = 'none'; });
    each('[data-cfo-plan]', function (el) {
      var p = plans[el.getAttribute('data-cfo-plan')]; if (!p) return;
      var f = el.getAttribute('data-cfo-field'), lk = el.getAttribute('data-cfo-limit'), fk = el.getAttribute('data-cfo-feature');
      if (f === 'price') el.textContent = money(p.price_minor, p.currency);
      else if (f === 'name') el.textContent = tr(p.name);
      else if (f === 'description') el.textContent = tr(p.description);
      else if (f === 'trial-days') el.textContent = T.day(Math.round(p.trial_hours / 24));
      else if (f === 'interval') el.textContent = T.month;
      else if (lk) { var l = (p.limits || []).filter(function (x) { return x.key === lk; })[0]; var t = l && limitText(l); if (t != null) el.textContent = t; }
      else if (fk) { var x = (p.features || []).filter(function (y) { return y.key === fk; })[0]; if (x) el.textContent = (x.included ? T.yes : T.no) + (x.included && x.status === 'beta' ? T.beta : ''); }
    });
    each('[data-cfo-glossary]', function (el) {
      var p = cat.plans && cat.plans[0]; if (!p) return;
      var dl = document.createElement('dl');
      (p.limits || []).filter(function (l) { return tr(l.definition); }).forEach(function (l) {
        var dt = document.createElement('dt'); dt.textContent = tr(l.label);
        var dd = document.createElement('dd'); dd.textContent = tr(l.definition) + (l.enforced ? ' ' + (l.at_limit === 'warn' ? T.warn : T.block) : '');
        dl.appendChild(dt); dl.appendChild(dd);
      });
      var trial = document.createElement('p'); trial.textContent = T.trial(T.day(Math.round(p.trial_hours / 24)));
      el.textContent = ''; el.appendChild(dl); el.appendChild(trial);
    });
    document.documentElement.setAttribute('data-cfo-pricing', 'live');
  }
  fetch(api, { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(apply).catch(function (e) { document.documentElement.setAttribute('data-cfo-pricing', 'static'); if (window.console) console.warn('[cfo-pricing] catalog unavailable, static prices kept:', e.message); });
})();
