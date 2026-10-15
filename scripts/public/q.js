(function () {
  'use strict';
  var R = window.RASS, root = document.querySelector('.pq'), token = root.dataset.token, body = document.getElementById('pq-body');
  function api(method, path, data) {
    return fetch('/api' + path, { method: method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'rass' }, body: data ? JSON.stringify(data) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'تعذر تنفيذ الطلب'); e.code = j.code; throw e; } return j; }); });
  }
  function msg(cls, t) { return '<div class="' + cls + '" style="margin:12px 0">' + R.esc(t) + '</div>'; }
  var state;
  function render() {
    var d = state, q = d.quote, dec = q._decision;
    var h = '<div class="pv-wrap"><div class="sheet" id="sheet">' + R.quoteDoc(d.settings, q) + '</div></div><div class="pq-act">';
    if (dec) h += '<div class="decision ' + (dec.action === 'reject' ? 'rej' : '') + '"><b>' + (dec.action === 'approve' ? 'تم اعتماد العرض' : 'تم رفض العرض') + '</b> بواسطة ' + R.esc(dec.name) + ' بتاريخ ' + R.fmtDate(String(dec.at).slice(0, 10)) + '. شكراً لك.</div>';
    else if (d.expired) h += msg('note bad', 'انتهت صلاحية رابط الاعتماد. يرجى التواصل مع الشركة للحصول على رابط جديد.');
    else if (d.superseded) h += msg('note bad', 'تم استبدال هذا العرض بإصدار أحدث. يرجى التواصل مع الشركة.');
    else h += '<div class="card"><h3>قرار العميل</h3><p class="muted" style="margin-top:0">بعد مراجعة العرض أعلاه، اكتب اسمك ووقّع في المربع ثم اضغط «اعتماد العرض». سيصل إشعار فوري للشركة.</p>' +
      '<label class="fld"><span>الاسم الكامل</span><input id="pq-name" autocomplete="name"></label>' +
      '<div class="fld" style="margin-top:10px"><span>التوقيع (بالإصبع أو الفأرة)</span><canvas id="pq-sig" class="sigpad" width="800" height="300"></canvas><div class="row"><button class="btn sm" type="button" id="pq-clear">مسح التوقيع</button></div></div>' +
      '<label class="fld" style="margin-top:10px"><span>ملاحظات (اختياري)</span><textarea id="pq-note" rows="2"></textarea></label>' +
      '<div class="auth-err" id="pq-err" hidden style="margin-top:10px"></div><div class="row" style="margin-top:12px"><button class="btn pri" type="button" id="pq-ok">اعتماد العرض</button><button class="btn danger" type="button" id="pq-no">رفض العرض</button><button class="btn" type="button" id="pq-print">طباعة / PDF</button></div></div>';
    h += '</div>';
    body.innerHTML = h;
    var sh = document.getElementById('sheet'), w = sh.parentNode.clientWidth;
    sh.style.zoom = Math.min(1, (w - 24) / 816) || 1; sh.style.width = '816px';
    if (!dec && !d.expired && !d.superseded) pad();
  }
  function pad() {
    var c = document.getElementById('pq-sig'), ctx = c.getContext('2d'), drawing = false, dirty = false;
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#17365D';
    function pos(e) { var r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) * c.width / r.width, y: (t.clientY - r.top) * c.height / r.height }; }
    function down(e) { e.preventDefault(); drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); dirty = true; }
    function up() { drawing = false; }
    c.addEventListener('mousedown', down); c.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    c.addEventListener('touchstart', down, { passive: false }); c.addEventListener('touchmove', move, { passive: false }); c.addEventListener('touchend', up);
    document.getElementById('pq-clear').onclick = function () { ctx.clearRect(0, 0, c.width, c.height); dirty = false; };
    document.getElementById('pq-print').onclick = function () { var pa = document.createElement('div'); pa.id = 'printArea'; pa.innerHTML = R.quoteDoc(state.settings, state.quote); document.body.appendChild(pa); window.print(); setTimeout(function () { pa.remove(); }, 500); };
    function send(action) {
      var err = document.getElementById('pq-err'); err.hidden = true;
      var name = document.getElementById('pq-name').value.trim();
      if (name.length < 3) { err.textContent = 'اكتب اسمك الكامل'; err.hidden = false; return; }
      if (action === 'approve' && !dirty) { err.textContent = 'وقّع في المربع المخصص للتوقيع'; err.hidden = false; return; }
      if (action === 'reject' && !confirm('هل تريد رفض العرض؟')) return;
      var sig = action === 'approve' ? c.toDataURL('image/png') : '';
      api('POST', '/public/quote/' + encodeURIComponent(token), { action: action, name: name, note: document.getElementById('pq-note').value, signature: sig, v: state.v })
        .then(load).catch(function (e) { err.textContent = e.message; err.hidden = false; if (e.code === 'stale') setTimeout(load, 1500); });
    }
    document.getElementById('pq-ok').onclick = function () { send('approve'); };
    document.getElementById('pq-no').onclick = function () { send('reject'); };
  }
  function load() {
    return api('GET', '/public/quote/' + encodeURIComponent(token)).then(function (d) { state = d; document.title = 'عرض سعر ' + d.quote.no + ' - ' + d.settings.nameAr; document.getElementById('pq-title').textContent = 'عرض سعر ' + d.quote.no; render(); })
      .catch(function (e) { body.innerHTML = msg('note bad', e.message || 'الرابط غير صالح'); });
  }
  load();
})();
