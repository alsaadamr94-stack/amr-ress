/* Shared calculations + printable document builders (used by the browser app, the public approval page and the server). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RASS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var n0 = function (v) { var x = parseFloat(v); return isFinite(x) ? x : 0; };
  var r2 = function (n) { return Math.round((n0(n) + Number.EPSILON) * 100) / 100; };
  var fmt = function (n) { return n0(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var qtyF = function (n) { return Number.isInteger(n0(n)) ? String(n0(n)) : String(r2(n)); };
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي'); };
  var fmtDate = function (iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  var today = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var ORD = ['أولاً', 'ثانياً', 'ثالثاً', 'رابعاً', 'خامساً', 'سادساً', 'سابعاً', 'ثامناً', 'تاسعاً', 'عاشراً'];

  /* ---------- Arabic amount in words ---------- */
  var O = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  var T = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  var H = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  function b1000(n) { var h = Math.floor(n / 100), r = n % 100, p = []; if (h) p.push(H[h]); if (r) { if (r < 20) p.push(O[r]); else { var u = r % 10; if (u) p.push(O[u]); p.push(T[Math.floor(r / 10)]); } } return p.join(' و'); }
  function words(n) {
    n = Math.floor(n); if (n === 0) return 'صفر'; var parts = [];
    var m = Math.floor(n / 1e6), k = Math.floor((n % 1e6) / 1000), r = n % 1000;
    if (m) parts.push(m === 1 ? 'مليون' : m === 2 ? 'مليونان' : m <= 10 ? b1000(m) + ' ملايين' : b1000(m) + ' مليون');
    if (k) parts.push(k === 1 ? 'ألف' : k === 2 ? 'ألفان' : k <= 10 ? b1000(k) + ' آلاف' : b1000(k) + ' ألف');
    if (r) parts.push(b1000(r)); return parts.join(' و');
  }
  function sarWords(v) { v = r2(v); var i = Math.floor(v), h = Math.round((v - i) * 100); return 'فقط ' + words(i) + ' ريال سعودي' + (h ? ' و' + words(h) + ' هللة' : '') + ' لا غير'; }

  /* ---------- calculations ---------- */
  function groupLines(lines) { var g = [], m = {}; (lines || []).forEach(function (l) { var k = l.group || 'بنود أخرى'; if (!m[k]) { m[k] = { name: k, lines: [] }; g.push(m[k]); } m[k].lines.push(l); }); return g; }
  var lineTot = function (l) { return r2(n0(l.qty) * n0(l.price)); };
  function calc(q) {
    var groups = groupLines(q.lines).map(function (g) { return { name: g.name, lines: g.lines, sub: r2(g.lines.reduce(function (a, l) { return a + lineTot(l); }, 0)) }; });
    var sub = r2(groups.reduce(function (a, g) { return a + g.sub; }, 0));
    var vat = r2(sub * n0(q.vatRate) / 100), gross = r2(sub + vat);
    var disc = q.discMode === 'amt' ? r2(Math.min(n0(q.discAmt), gross)) : r2(gross * n0(q.discPct) / 100);
    var pct = q.discMode === 'amt' ? (gross ? disc / gross * 100 : 0) : n0(q.discPct);
    var total = r2(gross - disc);
    return { groups: groups, sub: sub, vat: vat, gross: gross, disc: disc, pct: pct, total: total };
  }
  var pctSum = function (c) { return r2((c.payments || []).reduce(function (a, p) { return a + n0(p.pct); }, 0)); };
  function payRows(c, total) { var acc = 0, full = pctSum(c) === 100; return (c.payments || []).map(function (p, i) { var last = i === c.payments.length - 1; var amt = last && full ? r2(total - acc) : r2(total * n0(p.pct) / 100); acc = r2(acc + amt); return Object.assign({}, p, { amt: amt }); }); }
  function cTotal(q) { var k = q.contract, c = calc(q); return k && k.override !== '' && k.override != null && n0(k.override) > 0 ? r2(k.override) : c.total; }

  /* ---------- document pieces ---------- */
  function repl(s, t) { return String(t || '').replace(/\{BANK\}/g, s.bankName || '').replace(/\{IBAN\}/g, s.iban || ''); }
  var LOGO = '/logo.png';
  function head(s) {
    var logo = '<img src="' + esc(s.logo || LOGO) + '" alt="">';
    return '<div class="dh"><div class="dh-r">' + esc(s.nameAr) + '<br>س.ت: ' + esc(s.cr) + '<br>الرقم الضريبي: ' + esc(s.vat) + '</div><div class="dh-c">' + logo + '</div><div class="dh-l">' + esc(s.nameEn) + '<br>C.R. No.: ' + esc(s.cr) + '<br>VAT No.: ' + esc(s.vat) + '</div></div>';
  }
  function foot(s) {
    return '<div class="d-foot"><span>' + esc(s.phone1) + '</span> | <span>' + esc(s.phone2) + ' VAT No- ' + esc(s.vat) + '</span> | <span>' + esc(s.email) + '</span> | <span>' + esc(s.web) + '</span><img class="d-flogo" src="' + esc(s.logo || LOGO) + '" alt=""></div>';
  }
  function wrap(s, inner) { return '<div class="doc"><table class="pg"><thead><tr><td>' + head(s) + '</td></tr></thead><tbody><tr><td>' + inner + '</td></tr></tbody><tfoot><tr><td>' + foot(s) + '</td></tr></tfoot></table></div>'; }
  function bars(s, sub) { return '<div class="d-bar">' + esc(s.brandEn) + '</div><div class="d-sub">' + sub + '</div>'; }
  function stampImg(s, cls) { return s.stamp ? '<img class="' + cls + '" src="' + esc(s.stamp) + '" alt="">' : ''; }
  function pair(label, value) { return '<div class="mp"><i>' + label + '</i><span>' + value + '</span></div>'; }

  function itemsTable(q) {
    var h = '<table class="it"><colgroup><col style="width:4.5%"><col><col style="width:10%"><col style="width:8%"><col style="width:8%"><col style="width:12%"><col style="width:13%"></colgroup><thead><tr><th>الرقم</th><th>الوصف</th><th>النوع</th><th>الوحدة</th><th>العدد</th><th>السعر الفردي</th><th>الإجمالي</th></tr></thead><tbody>';
    groupLines(q.lines).forEach(function (g, gi) {
      h += '<tr class="gh"><td colspan="7">' + (ORD[gi] || '') + ': ' + esc(g.name) + '</td></tr>';
      g.lines.forEach(function (l, i) { h += '<tr class="' + (i % 2 ? 'b' : '') + '"><td class="c">' + (i + 1) + '</td><td class="ds">' + esc(l.desc) + '</td><td class="c">' + esc(l.brand) + '</td><td class="c">' + esc(l.unit) + '</td><td class="c">' + qtyF(l.qty) + '</td><td class="e">' + fmt(l.price) + '</td><td class="e">' + fmt(lineTot(l)) + '</td></tr>'; });
    });
    return h + '</tbody></table>';
  }
  function summaryTable(q, c, agreed) {
    var n = 0, row = function (label, amt, cls) { n++; return '<tr class="' + (cls || '') + (n % 2 ? ' b' : '') + '"><td class="c">' + n + '</td><td class="c">' + label + '</td><td class="e">' + amt + '</td></tr>'; };
    var h = '<table class="sm"><colgroup><col style="width:4.5%"><col><col style="width:26%"></colgroup><thead><tr><th colspan="3">إجمالي عرض السعر</th></tr></thead><tbody>';
    c.groups.forEach(function (g) { h += row(esc(g.name.replace(/^توريد وتركيب /, '')), fmt(g.sub)); });
    h += row('الإجمالي قبل الضريبة', fmt(c.sub), 'k') + row('القيمة المضافة ' + r2(q.vatRate) + '%', fmt(c.vat));
    if (c.disc > 0) h += row('الإجمالي شامل الضريبة', fmt(c.gross), 'k') + row('خصم خاص للعميل (' + r2(c.pct) + '%)', '- ' + fmt(c.disc)) + row('الصافي النهائي بعد الخصم', fmt(c.total), 'k gt');
    else h += row('الإجمالي شامل الضريبة', fmt(c.total), 'k gt');
    if (agreed != null) h += row('المبلغ المتفق عليه للعقد', fmt(agreed), 'k agreed');
    return h + '</tbody></table>';
  }

  /* ---------- quote ---------- */
  function approvalBlock(q) {
    var d = q._decision, ok = d && d.action === 'approve';
    var name = ok ? esc(d.name) : esc(q.client);
    var sig = ok && d.signature ? '<img class="sigimg" src="' + esc(d.signature) + '" alt="">' : '';
    var date = ok ? fmtDate(String(d.at || '').slice(0, 10)) : '____ / ____ / ________';
    return '<div class="approve"><div class="dbar">اعتماد العميل / Client Approval</div><div class="sigspace"><div>الاسم: <b>' + name + '</b></div><div>التوقيع: ' + (sig || '______________________') + '</div><div>التاريخ: ' + date + '</div><div>الختم:</div></div>' + (ok ? '<div class="onl">اعتُمد إلكترونياً عبر رابط العرض بتاريخ ' + fmtDate(String(d.at || '').slice(0, 10)) + '</div>' : '') + '</div>';
  }
  function quoteDoc(s, q) {
    var c = calc(q);
    var notes = repl(s, q.notes).split('\n').filter(function (x) { return x.trim(); }).map(function (x) { return /^(IBAN|يتم الدفع)/i.test(x.trim()) ? '<li class="hl">' + esc(x) + '</li>' : '<li>' + esc(x) + '</li>'; }).join('');
    var inner = bars(s, '<bdi dir="ltr">QUOTATION</bdi> &nbsp;|&nbsp; عرض سعر') +
      '<div class="d-meta q">' + pair('رقم العرض / Quote No.', '<bdi dir="ltr">' + esc(q.no) + '</bdi>') + pair('التاريخ / Date', fmtDate(q.date)) +
      pair('العميل / Client', esc(q.client)) + pair('المشروع / Project', esc(q.project)) +
      pair('الموقع / Location', esc(q.location)) + pair('مدة العرض / Validity', esc(q.validity)) + '</div>' +
      '<div class="d-thanks">' + esc(s.thanks) + '</div>' + itemsTable(q) + summaryTable(q, c) +
      '<div class="ft2"><div class="terms"><div class="dbar">الشروط والملاحظات / Terms &amp; Notes</div><ul>' + notes + '</ul>' + approvalBlock(q) + '</div><div></div>' +
      '<div class="prep"><div class="dbar">إعداد العرض / Prepared by</div><p>م / ' + esc(q.preparedBy) + '</p><p>التوقيع /</p>' + stampImg(s, 'stamp') + '</div></div>';
    return wrap(s, inner);
  }

  /* ---------- contract ---------- */
  function contractDoc(s, q) {
    var k = q.contract, c = calc(q);
    var agreed = k.override !== '' && k.override != null && n0(k.override) > 0 ? r2(k.override) : null;
    var total = agreed != null ? agreed : c.total, rows = payRows(k, total), hasDue = rows.some(function (p) { return p.due; });
    var pay = '<div class="pay-cap">طريقة الدفعات</div><table class="pay"><thead><tr><th style="width:5%">م</th><th>موعد الدفعة</th><th style="width:13%">النسبة</th>' + (hasDue ? '<th style="width:14%">الاستحقاق</th>' : '') + '<th style="width:20%">المبلغ</th></tr></thead><tbody>' +
      rows.map(function (p, i) { return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + esc(p.label) + '</td><td class="c">' + r2(p.pct) + '%</td>' + (hasDue ? '<td class="c">' + fmtDate(p.due) + '</td>' : '') + '<td class="e">' + fmt(p.amt) + '</td></tr>'; }).join('') +
      '<tr class="k"><td></td><td class="c">الإجمالي</td><td class="c">' + r2(pctSum(k)) + '%</td>' + (hasDue ? '<td></td>' : '') + '<td class="e">' + fmt(rows.reduce(function (a, p) { return a + p.amt; }, 0)) + '</td></tr></tbody></table><div class="words">' + esc(sarWords(total)) + '</div>';
    var terms = String(k.terms || '').split('\n').filter(function (x) { return x.trim(); }).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    var inner = bars(s, 'عقد تنفيذ أعمال أنظمة الأمن والسلامة') +
      '<div class="d-meta c">' + pair('رقم العرض', '<bdi dir="ltr">' + esc(q.no) + '</bdi>') + pair('التاريخ', fmtDate(k.date)) + pair('الطرف الأول', esc(s.nameAr)) + pair('الطرف الثاني', esc(k.party2)) +
      pair('المشروع', esc(q.project)) + pair('الموقع', esc(q.location)) + pair('مدة التنفيذ', esc(k.duration) + ' يوم') + pair('مرجع العقد', 'عرض السعر وجدول الكميات') + '</div>' +
      '<div class="p-intro">' + esc(k.intro) + '</div>' + (k.items ? itemsTable(q) : '') + summaryTable(q, c, agreed) + pay +
      '<div class="p-note">' + esc(k.paynote) + '</div><div class="terms-h">الشروط العامة</div><ol class="cterms">' + terms + '</ol><div class="closing">' + esc(k.close) + '</div>' +
      '<div class="sigs"><div class="sg"><b>الطرف الثاني</b><b>' + esc(k.party2) + '</b><div class="ln2">الاسم: ____________________</div><div class="ln2">التوقيع: __________________</div><div class="ln2">الختم:</div></div>' +
      '<div class="sg"><b>الطرف الأول</b><b>' + esc(s.nameAr) + '</b><div class="ln2">الاسم: ____________________</div><div class="ln2">التوقيع: __________________</div><div class="ln2">الختم:</div>' + (k.stamp ? stampImg(s, 'stamp') : '') + '</div></div>';
    return wrap(s, inner);
  }

  return { esc: esc, n0: n0, r2: r2, fmt: fmt, qtyF: qtyF, norm: norm, fmtDate: fmtDate, today: today, ORD: ORD, words: words, sarWords: sarWords,
    groupLines: groupLines, lineTot: lineTot, calc: calc, pctSum: pctSum, payRows: payRows, cTotal: cTotal, repl: repl,
    head: head, foot: foot, wrap: wrap, bars: bars, stampImg: stampImg, pair: pair, itemsTable: itemsTable, summaryTable: summaryTable,
    quoteDoc: quoteDoc, contractDoc: contractDoc };
});
