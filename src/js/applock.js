/* ===== 功能：应用锁（隐私防护·防偷看） =====
   归属：系统/全局（AI-B 域）。build.mjs jsFiles 插在 contacts.js 之后加载。
   入口：设置页「应用锁」组（template.html #applock-en / #applock-sub）。
   数据：全局根键 xy-home-v2:applock-en / applock-pin / applock-qa（已进 contacts.js EXCLUDE，
   绝不被 migrateLegacy 当旧顶层键迁进 default 并删根键）。
   解锁态：sessionStorage 'mochi-applock-ok'——本会话解过一次即可，刷新同一标签不重锁；
   冷启动/新开标签页/新窗口需重新输密码（对应「仅打开时锁」，切后台不锁）。
   忘记密码：靠设密码时绑定的安全问答重设；无问答时只能清除本站数据（锁屏内已说明）。
   安全边界：纯前端本地锁，挡日常偷看；懂技术者可直读本机 localStorage/IndexedDB，
   无服务端不可能绝对防御。密码/答案仅存 cyrb53 摘要（防一眼读出，非加密）。
   UI：#applock-mask 全屏遮罩（已注册进 mobile-adapt FLOAT_SELECTORS，背景滚动锁归它统一管）。
   全部交互自绘（数字键盘/文本输入/说明屏），不依赖 openModal——openModal 取消不回调，
   流程会卡死；且其层级(99999)低于本遮罩(999999)。
   ====================================================== */
(function () {
  'use strict';
  const G = 'xy-home-v2';
  const K_EN = 'applock-en';
  const K_PIN = 'applock-pin';
  const K_QA = 'applock-qa';
  const SESS = 'mochi-applock-ok';
  // v3.31.x 开屏问答门（可不设数字密码单独用；本机输暗号 QA_SKIP_CODE 永久跳过问答层）
  const K_QA_EN = 'applock-qa-en';
  const K_QA_LIST = 'applock-qalist';
  const K_QA_SKIP = 'applock-qaskip';

  // ---------- 存储（根命名空间，localStorage 直读兜底） ----------
  function gGet(k) {
    try { const v = window.xyStore ? window.xyStore(G).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
    try { return localStorage.getItem(G + ':' + k); } catch (e2) { return null; }
  }
  function gSet(k, v) {
    try { if (window.xyStore) window.xyStore(G).set(k, v); else localStorage.setItem(G + ':' + k, v); }
    catch (e) { try { localStorage.setItem(G + ':' + k, v); } catch (e2) {} }
  }

  // cyrb53：密码/答案只存摘要
  function h53(str) {
    const s = String(str);
    let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
  }
  function pinHash() { return gGet(K_PIN) || ''; }
  function qaGet() {
    try {
      const v = gGet(K_QA);
      if (v && typeof v === 'string') {
        const o = JSON.parse(v);
        if (o && o.q && o.h) return o;
      }
    } catch (e) {}
    return null;
  }
  function enabled() { return gGet(K_EN) === '1'; }
  function setEn(v) { gSet(K_EN, v ? '1' : '0'); }
  function savePin(pin) { gSet(K_PIN, h53(pin)); }
  function saveQa(q, h) { gSet(K_QA, JSON.stringify({ q: String(q), h: String(h) })); }

  // ---------- 开屏问答门数据 ----------
  // 存储为 JSON：[{ q:'题目', h:'答案摘要(cyrb53)' }]，答案不落明文（同数字密码）。
  // 可独立于数字密码锁开关（应用锁可不设）；本机输暗号 QA_SKIP_CODE 后 qaskip=1 永久跳过问答层。
  const QA_SKIP_CODE = '990915';
  const DEFAULT_QA = [
    { q: 'mj 是什么意思？', a: '梦角' },
    { q: '是否已知晓：全站为随机代码运行，不含任何 AI，请不要添加负面字卡吓唬自己？', a: '是' }
  ];
  function qaRaw() {
    try {
      const v = gGet(K_QA_LIST);
      if (v && typeof v === 'string') {
        const arr = JSON.parse(v);
        if (Array.isArray(arr) && arr.length && arr.every(function (it) { return it && it.q && it.h; })) {
          return arr.map(function (it) { return { q: String(it.q), h: String(it.h) }; });
        }
      }
    } catch (e) {}
    return null;
  }
  // 展示用：返回 [{q,h}]，无存储时给默认题（不落盘）
  function qaList() {
    const r = qaRaw();
    if (r) return r;
    return DEFAULT_QA.map(function (it) { return { q: it.q, h: h53(String(it.a).trim()) }; });
  }
  // 保存：入参 [{q,a}]，内部转成摘要
  function qaSave(items) {
    gSet(K_QA_LIST, JSON.stringify(items.map(function (it) {
      return { q: String(it.q), h: h53(String(it.a).trim()) };
    })));
  }
  function qaSeedDefault() { if (!qaRaw()) qaSave(DEFAULT_QA); }
  function qaEnabled() { return gGet(K_QA_EN) === '1'; }
  function qaSetEn(v) { gSet(K_QA_EN, v ? '1' : '0'); }
  function qaSkipped() { return gGet(K_QA_SKIP) === '1'; }  // 本机已输暗号 → 永久跳过问答层
  function qaSkipSet(v) { gSet(K_QA_SKIP, v ? '1' : '0'); }
  function qaAnswerOk(v, h) { return h53(String(v == null ? '' : v).trim()) === h; }

  function sessOk() { try { return sessionStorage.getItem(SESS) === '1'; } catch (e) { return false; } }
  function sessMark() { try { sessionStorage.setItem(SESS, '1'); } catch (e) {} }

  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2200);
  }

  // ---------- 全屏遮罩（kind: pad 数字键盘 / text 文本输入 / info 说明） ----------
  const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 018 0v3"/><circle cx="12" cy="15.5" r="1.5" fill="currentColor"/><path d="M12 17v1.5"/></svg>';
  const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5V11c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5.5z"/></svg>';
  let MASK = null;
  function maskEl() {
    if (!MASK) {
      MASK = document.createElement('div');
      MASK.id = 'applock-mask';
      MASK.hidden = true;
      MASK.addEventListener('click', onMaskClick);
      document.body.appendChild(MASK);
    }
    return MASK;
  }

  let cur = null;   // 当前面板配置
  let buf = '';     // pad 输入缓冲

  function render() {
    const m = maskEl();
    const o = cur;
    let inner = '<div class="applock-box">' +
      '<div class="applock-ico">' + (o.ico || ICON_LOCK) + '</div>' +
      '<div class="applock-title">' + (o.title || '') + '</div>' +
      (o.sub ? '<div class="applock-sub">' + o.sub + '</div>' : '');
    if (o.kind === 'text') {
      inner += '<input class="applock-txt" type="text" id="applock-txt" maxlength="' + (o.maxlen || 60) + '"' +
        (o.value != null ? ' value="' + String(o.value).replace(/"/g, '&quot;') + '"' : '') +
        (o.placeholder ? ' placeholder="' + o.placeholder + '"' : '') + ' autocomplete="off">' +
        '<div class="applock-err" id="applock-err"></div>' +
        '<div class="applock-btns">' +
        (o.cancel !== false ? '<button type="button" class="al-ghost" data-link="cancel">' + (o.cancelLabel || '取消') + '</button>' : '') +
        '<button type="button" class="al-primary" data-submit="1">' + (o.okLabel || '确定') + '</button>' +
        '</div>' +
        (o.links && o.links.length ? '<div class="applock-links">' + o.links.map(function (l) {
          return '<button data-link="' + l.act + '">' + l.label + '</button>';
        }).join('') + '</div>' : '');
    } else if (o.kind === 'info') {
      inner += '<div class="applock-btns" style="margin-top:6px">' +
        (o.secondary ? '<button type="button" class="al-ghost" data-link="' + o.secondary.act + '">' + o.secondary.label + '</button>' : '') +
        '<button type="button" class="al-primary" data-ok="1">' + (o.okLabel || '知道了') + '</button>' +
        '</div>';
    } else if (o.kind === 'qalist') {
      // 开屏问答 · 题目管理（增删改问答题，答案只存摘要）
      const items = o.items || [];
      inner += '<div class="applock-err" id="applock-err"></div>' +
        '<div class="al-qa-list" id="al-qa-list">' +
        (items.length ? items.map(function (it, i) {
          return '<div class="al-qa-row">' +
            '<span class="al-qa-idx">' + (i + 1) + '</span>' +
            '<span class="al-qa-q">' + it.q + '</span>' +
            '<span class="al-qa-ops">' +
            '<button type="button" data-qal="edit:' + i + '">改</button>' +
            (items.length > 1 ? '<button type="button" data-qal="del:' + i + '">删</button>' : '') +
            '</span>' +
            '</div>';
        }).join('') : '<div class="applock-empty">还没有题目，点下方「添加题目」新建。</div>') +
        '</div>' +
        '<div class="applock-btns" style="margin-top:4px">' +
        '<button type="button" class="al-ghost" data-qal="add">＋ 添加题目</button>' +
        '<button type="button" class="al-primary" data-qal="done">完成</button>' +
        '</div>' +
        (o.extra ? '<div class="applock-sub" style="margin-top:8px">' + o.extra + '</div>' : '');
    } else { // pad
      let dots = '';
      for (let i = 0; i < o.max; i++) dots += '<i></i>';
      const keyLabels = { C: 'C', b: '⌫' };
      let kh = '';
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'b'].forEach(function (k) {
        kh += '<button class="applock-key' + (/^\d$/.test(k) ? '' : ' dim') + '" data-k="' + k + '">' + (keyLabels[k] || k) + '</button>';
      });
      inner += '<div class="applock-dots" id="applock-dots">' + dots + '</div>' +
        '<div class="applock-err" id="applock-err"></div>' +
        '<div class="applock-keys">' + kh + '</div>' +
        '<button class="applock-ok" id="applock-ok" disabled>' + (o.confirm || '确定') + '</button>' +
        (o.links && o.links.length ? '<div class="applock-links">' + o.links.map(function (l) {
          return '<button data-link="' + l.act + '">' + l.label + '</button>';
        }).join('') + '</div>' : '');
    }
    inner += '</div>';
    m.innerHTML = inner;
    if (o.kind === 'text') {
      try {
        const inp = document.getElementById('applock-txt');
        if (inp) setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
      } catch (e) {}
    }
    syncPad();
  }
  function box() { const m = maskEl(); return m.firstElementChild; }
  function shake() {
    const b = box();
    if (!b) return;
    b.classList.remove('applock-shake');
    void b.offsetWidth;
    b.classList.add('applock-shake');
  }
  function showErr(msg) {
    const e = box() ? box().querySelector('#applock-err') : null;
    if (e) e.textContent = msg || '';
    if (msg) shake();
  }
  function syncPad() {
    if (!cur || cur.kind !== 'pad') return;
    const b = box();
    if (!b) return;
    const dots = b.querySelector('#applock-dots');
    if (dots) Array.prototype.forEach.call(dots.children, function (d, i) {
      d.className = i < buf.length ? 'on' : '';
    });
    const ok = b.querySelector('#applock-ok');
    if (ok) ok.disabled = buf.length < (cur.min || 1);
  }
  function padAdd(d) {
    showErr('');
    if (buf.length >= cur.max) return;
    buf += d;
    syncPad();
    if (buf.length >= cur.max) padTry();
  }
  function padTry() {
    if (!cur || cur.kind !== 'pad') return;
    if (buf.length < (cur.min || 1)) return;
    const pin = buf;
    if (cur.check && !cur.check(pin)) return; // check 失败时内部已提示+清空
    const cb = cur.onOk;
    cur = null; buf = '';
    const m = maskEl(); m.hidden = true;
    if (cb) cb(pin);
  }
  function close(cb) {
    const oc = cur ? (cur.onCancel || null) : null;
    cur = null; buf = '';
    maskEl().hidden = true;
    if (cb) cb(); else if (oc) oc();
  }
  function padOpen(o) {
    cur = Object.assign({}, o);
    if (o.kind !== 'text' && o.kind !== 'info' && o.kind !== 'qalist') { cur.kind = 'pad'; if (!cur.max) cur.max = 6; if (cur.min == null) cur.min = 1; }
    buf = '';
    render();
    maskEl().hidden = false;
  }

  function onMaskClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const key = t.closest('.applock-key');
    if (key) {
      const k = key.getAttribute('data-k');
      if (k === 'C') { buf = ''; syncPad(); return; }
      if (k === 'b') { buf = buf.slice(0, -1); syncPad(); return; }
      if (/^\d$/.test(k)) { padAdd(k); return; }
      return;
    }
    if (t.closest('#applock-ok')) { padTry(); return; }
    if (t.closest('[data-qal]')) {
      if (!cur || cur.kind !== 'qalist') return;
      const act = t.closest('[data-qal]').getAttribute('data-qal');
      onQal(act);
      return;
    }
    if (t.closest('[data-ok]')) {
      if (!cur || cur.kind !== 'info') return;
      const oc = cur.onPrimary;
      cur = null; buf = '';
      maskEl().hidden = true;
      if (oc) oc();
      return;
    }
    if (t.closest('[data-submit]')) {
      if (!cur || cur.kind !== 'text') return;
      const inp = document.getElementById('applock-txt');
      const v = inp ? String(inp.value || '').trim() : '';
      if (cur.onSubmit) cur.onSubmit(v);
      return;
    }
    if (t.closest('[data-link]')) {
      const act = t.closest('[data-link]').getAttribute('data-link');
      if (!cur) return;
      if (act === 'cancel') { const oc = cur.onCancel || null; cur = null; buf = ''; maskEl().hidden = true; if (oc) oc(); return; }
      if (cur.onLink) { cur.onLink(act); return; }
    }
  }

  // ---------- 密码校验 & 新密码流程 ----------
  function pinOk(pin) { return pinHash() !== '' && pinHash() === h53(pin); }

  // cfg: { t1,s1,t2,s2, done(pin), cancel() }（两阶段输入新密码）
  function flowNewPin(cfg) {
    padOpen({
      title: cfg.t1, sub: cfg.s1, min: 4, max: 6, confirm: '确定', ico: ICON_LOCK,
      cancelLabel: '取消',
      links: [{ act: 'cancel', label: '取消' }],
      check: function (pin) {
        if (!/^\d{4,6}$/.test(pin)) { showErr('密码需为 4-6 位数字'); buf = ''; syncPad(); return false; }
        return true;
      },
      onOk: function (pin) {
        padOpen({
          title: cfg.t2, sub: cfg.s2, min: 4, max: 6, confirm: '确定', ico: ICON_LOCK,
          links: [{ act: 'cancel', label: '取消' }],
          check: function (p2) {
            if (p2 !== pin) { showErr('两次输入不一致，请重输'); buf = ''; syncPad(); return false; }
            return true;
          },
          onOk: function () { if (cfg.done) cfg.done(pin); },
          onCancel: function () { if (cfg.cancel) cfg.cancel(); else close(); }
        });
      },
      onCancel: function () { if (cfg.cancel) cfg.cancel(); else close(); }
    });
  }

  // ---------- 文本输入屏 ----------
  // o: { title, sub, placeholder, maxlen, okLabel, cancelLabel, cancel:false|fn, onSubmit(v), onCancel() }
  function textAsk(o) {
    padOpen(Object.assign({ kind: 'text' }, o));
  }

  // ---------- 安全问答输入（答案错误就地重试；取消中止） ----------
  function askQa(ok, cancel) {
    const qa = qaGet();
    if (!qa) { if (cancel) cancel(); return; }
    textAsk({
      title: '安全问题', sub: qa.q, placeholder: '输入答案（原样输入，区分大小写）',
      maxlen: 60, cancelLabel: '取消',
      onSubmit: function (v) {
        if (!v) { showErr('请输入答案'); return; }
        if (qa.h === h53(v)) { if (ok) ok(); }
        else { const inp = document.getElementById('applock-txt'); if (inp) inp.value = ''; showErr('答案不正确，请重试'); }
      },
      onCancel: function () { if (cancel) cancel(); }
    });
  }

  // 设新安全问题：问题→答案 两屏。done(q, aHash)；任一步取消则中止
  function askQaSetup(done) {
    textAsk({
      title: '设置安全问题', sub: '忘记密码时，回答正确即可重设。请输入一个问题：',
      placeholder: '例如：我们第一次见面的城市？', maxlen: 40, okLabel: '下一步',
      onSubmit: function (q) {
        if (!q) { showErr('问题不能为空'); return; }
        textAsk({
          title: '设置答案', sub: '请牢记答案（原样输入，区分大小写），忘记密码时回答它即可重设：',
          placeholder: '安全问题的答案', maxlen: 60, okLabel: '完成',
          onSubmit: function (a) {
            if (!a) { showErr('答案不能为空'); return; }
            if (done) done(q, a);
          },
          onCancel: function () { /* 中止整个设置 */ if (cur) close(); }
        });
      },
      onCancel: function () { if (cur) close(); }
    });
  }

  // ---------- 锁屏 ----------
  function showLock() {
    padOpen({
      title: '应用锁已开启', sub: '输入密码解锁本站',
      min: 1, max: 6, confirm: '解锁', ico: ICON_LOCK,
      links: [{ act: 'forget', label: '忘记密码？' }],
      check: function (pin) {
        if (pinOk(pin)) return true;
        showErr('密码不正确'); buf = ''; syncPad();
        return false;
      },
      onOk: function () { sessMark(); maskEl().hidden = true; },
      onLink: function (act) {
        if (act === 'forget') lockForget();
      }
    });
  }
  function lockForget() {
    const qa = qaGet();
    if (!qa) {
      padOpen({
        kind: 'info', title: '无法重置', ico: ICON_SHIELD, okLabel: '返回锁屏', onPrimary: showLock,
        sub: '设置密码时未设置安全问题，无法通过问答找回。唯一出路是清除本站数据后重来（聊天记录会丢失，建议先在有数据的设备上导出备份）。'
      });
      return;
    }
    maskEl().hidden = true;   // 问答文本屏本身也是 mask 屏，无需先隐藏
    askQa(function () {
      flowNewPin({
        t1: '重设密码', s1: '设置 4-6 位新数字密码', t2: '再输入一次确认', s2: '请再输入一次新密码',
        done: function (pin) {
          savePin(pin); sessMark();
          toast('已重设密码并解锁');
          maskEl().hidden = true;
        },
        cancel: function () { showLock(); }
      });
    }, function () { showLock(); });
  }

  // ---------- 验证当前密码面板（改密码/改问答/关闭开关前） ----------
  // opts: { title, sub, forget:bool, onOk(pin), onForgetDone(), afterReset(), onCancel() }
  function padVerify(opts) {
    const links = [{ act: 'cancel', label: '取消' }];
    if (opts.forget) links.push({ act: 'forget', label: '忘记密码？' });
    padOpen({
      title: opts.title || '验证密码', sub: opts.sub || '请输入当前密码',
      min: 1, max: 6, confirm: '确定', ico: ICON_LOCK,
      links: links,
      check: function (pin) {
        if (pinOk(pin)) return true;
        showErr('密码不正确'); buf = ''; syncPad();
        return false;
      },
      onOk: function (pin) {
        maskEl().hidden = true;
        if (opts.onOk) opts.onOk(pin);
      },
      onCancel: function () { if (opts.onCancel) opts.onCancel(); else close(); },
      onLink: function (act) {
        if (act === 'cancel') { const oc = opts.onCancel || null; maskEl().hidden = true; cur = null; buf = ''; if (oc) oc(); return; }
        if (act === 'forget') verifyForget(opts);
      }
    });
  }
  function verifyForget(opts) {
    const qa = qaGet();
    if (!qa) {
      padOpen({
        kind: 'info', title: '无法用问答重置', ico: ICON_SHIELD, okLabel: '返回', onPrimary: function () { padVerify(opts); },
        sub: '设置密码时未设置安全问题。忘记密码只能清除本站数据后重来（聊天记录会丢失）。'
      });
      return;
    }
    askQa(function () {
      flowNewPin({
        t1: '重设密码', s1: '设置 4-6 位新数字密码', t2: '再输入一次确认', s2: '请再输入一次新密码',
        done: function (pin) {
          savePin(pin); sessMark();
          if (opts.onForgetDone) { opts.onForgetDone(); }
          else { maskEl().hidden = true; toast('密码已重设'); }
          if (opts.afterReset) opts.afterReset();
        },
        cancel: function () { padVerify(opts); }
      });
    }, function () { padVerify(opts); });
  }

  // ---------- 开屏问答门流程（可独立于数字密码锁；暗号 990915 本机永久跳过问答层） ----------
  // items 为 [{q,h}]；答对全部进入 afterAll()；每屏底部可「输暗号 990915 跳过问答」
  function qaStart(afterAll) {
    const items = qaList();
    qaAsk(items, 0, afterAll);
  }
  function qaAsk(items, i, afterAll) {
    if (i >= items.length) { if (afterAll) afterAll(); return; }
    const it = items[i];
    textAsk({
      title: '开屏问答 ' + (i + 1) + '/' + items.length,
      sub: it.q,
      placeholder: '输入答案', okLabel: (i + 1 >= items.length ? '进入' : '下一题'), cancel: false,
      links: [{ act: 'skipqa', label: '输暗号 990915，本机永久跳过问答' }],
      onSubmit: function (v) {
        if (qaAnswerOk(v, it.h)) { qaAsk(items, i + 1, afterAll); }
        else {
          const inp = document.getElementById('applock-txt'); if (inp) inp.value = '';
          showErr('答案不对，再想想～');
        }
      },
      onLink: function (act) { if (act === 'skipqa') qaSkipAsk(items, i, afterAll); }
    });
  }
  function qaSkipAsk(items, i, afterAll) {
    textAsk({
      title: '跳过开屏问答', sub: '输入暗号后，这台设备以后每次打开都不再问答（不再显示问答层）。',
      placeholder: '输暗号', maxlen: 12, okLabel: '确定', cancelLabel: '返回',
      onSubmit: function (v) {
        if (String(v || '').trim() === QA_SKIP_CODE) {
          qaSkipSet(true);
          toast('已跳过：本机以后不再问答');
          qaAsk(items, items.length, afterAll);   // 直接进下一层（密码锁 或 解锁完成）
        } else {
          const inp = document.getElementById('applock-txt'); if (inp) inp.value = '';
          showErr('暗号不对');
        }
      },
      onCancel: function () { qaAsk(items, i, afterAll); }
    });
  }

  // 冷启动/数据回填后评估是否需要锁屏（问答门 与 数字密码锁 双重可选，同时开时先问答后密码）
  function evalLock() {
    if (MASK && !MASK.hidden) return;   // 已锁屏中
    if (enabled() && !pinHash()) setEn(false);  // 异常态自愈（原逻辑保留）
    const needPin = enabled() && !!pinHash();
    const needQa = qaEnabled() && !qaSkipped();
    if (!needPin && !needQa) return;
    if (sessOk()) return;               // 本会话已解过锁
    if (needQa) {
      qaStart(function () {
        if (needPin) showLock();
        else { sessMark(); maskEl().hidden = true; }
      });
    } else {
      showLock();
    }
  }

  // ---------- 设置页 ----------
  function enEl() { return document.getElementById('applock-en'); }
  function subEl() { return document.getElementById('applock-sub'); }
  function qaEl() { return document.getElementById('applock-qa-en'); }
  function qaSubEl() { return document.getElementById('applock-qa-sub'); }
  function syncUi() {
    const c = enEl();
    const s = subEl();
    if (!c || !s) return;
    const on = enabled() && !!pinHash();
    c.checked = on;
    let html;
    if (on) {
      html = '<span>已开启：每次打开本站都需要输入密码，防止别人偷看聊天记录。</span>' +
        actsHtml([{ act: 'modify', label: '修改密码' }, { act: 'qa', label: '修改安全问题' }]);
    } else if (pinHash()) {
      html = '<span>已设过密码（当前关闭），拨动开关即可重新开启。</span>' +
        actsHtml([{ act: 'modify', label: '修改密码' }, { act: 'qa', label: '修改安全问题' }]);
    } else {
      html = '<span>未开启。开启后每次打开本站都要输入密码；可再设一个安全问题，忘记密码时用它重置。</span>';
    }
    s.innerHTML = html;
    Array.prototype.forEach.call(s.querySelectorAll('[data-aa]'), function (b) {
      b.addEventListener('click', function () {
        const act = b.getAttribute('data-aa');
        if (act === 'modify') flowModify();
        else if (act === 'qa') flowQaEdit();
      });
    });
  }
  function actsHtml(acts) {
    if (!acts || !acts.length) return '';
    return '<span class="applock-acts">' + acts.map(function (a) {
      return '<button type="button" data-aa="' + a.act + '">' + a.label + '</button>';
    }).join('') + '</span>';
  }
  function flowModify() {
    if (!pinHash()) { toast('请先开启应用锁'); return; }
    padVerify({
      title: '修改密码', sub: '先输入当前密码', forget: true,
      onOk: function () {
        flowNewPin({
          t1: '设置新密码', s1: '设置 4-6 位新数字密码', t2: '再输入一次确认', s2: '请再输入一次新密码',
          done: function (pin) { savePin(pin); toast('密码已更新'); syncUi(); },
          cancel: function () { syncUi(); }
        });
      },
      onForgetDone: function () { toast('密码已重设'); syncUi(); },
      onCancel: function () { syncUi(); }
    });
  }
  function flowQaEdit() {
    if (!pinHash()) { toast('请先开启应用锁'); return; }
    padVerify({
      title: '修改安全问题', sub: '先输入当前密码', forget: true,
      onOk: function () {
        askQaSetup(function (q, a) {
          saveQa(q, h53(a)); toast('安全问题已更新'); syncUi();
        });
      },
      onForgetDone: function () { toast('密码已重设（如需再改安全问题请再次进入）'); syncUi(); },
      onCancel: function () { syncUi(); }
    });
  }

  // ---------- 开屏问答门 · 设置页管理 ----------
  // 编辑缓冲：qaList() 的 {q,h} 深拷贝；答案留空=保留原答案（摘要不回显）
  let qaBuf = null;
  function qaOpenEdit() {
    qaBuf = (qaRaw() || qaList()).map(function (it) { return { q: String(it.q), h: String(it.h) }; });
    qaPanel();
  }
  function qaPanel() {
    padOpen({ kind: 'qalist', title: '开屏问答题', sub: '答案加密存储不显示；改题时答案留空＝不变。至少保留 1 道。', ico: ICON_SHIELD, items: qaBuf });
  }
  function qaRerender() {
    if (!cur || cur.kind !== 'qalist' || !qaBuf) return;
    cur.items = qaBuf;
    render();
  }
  // act: done / add / edit:i / del:i
  function onQal(act) {
    if (act === 'done') {
      const arr = (qaBuf || []).filter(function (it) { return it && it.q; });
      if (!arr.length) { showErr('至少要保留一道题'); return; }
      gSet(K_QA_LIST, JSON.stringify(arr.map(function (it) { return { q: it.q, h: it.h }; })));
      qaBuf = null;
      maskEl().hidden = true; cur = null; buf = '';
      toast('问答题已保存');
      syncQaUi(); syncUi();
      return;
    }
    if (act === 'add') { qaEditItem(null); return; }
    if (act.indexOf('edit:') === 0) { qaEditItem(parseInt(act.slice(5), 10)); return; }
    if (act.indexOf('del:') === 0) {
      const i = parseInt(act.slice(4), 10);
      if (!qaBuf || i < 0 || i >= qaBuf.length) return;
      if (qaBuf.length <= 1) { showErr('至少保留一道题'); return; }
      qaBuf.splice(i, 1);
      qaRerender();
    }
  }
  // 编辑 idx（null=新增）：题目 → 答案（留空=保留原答案）
  function qaEditItem(idx) {
    const isNew = idx === null || idx === undefined;
    const editing = !isNew ? qaBuf[idx] : null;
    textAsk({
      title: isNew ? '添加题目' : '修改题目', sub: isNew ? '输入问题内容：' : '输入新的问题内容（或直接下一步不改）：',
      placeholder: '问题', maxlen: 80, okLabel: '下一步', cancel: false,
      value: editing ? editing.q : '',
      onSubmit: function (q) {
        if (!q) { showErr('问题不能为空'); return; }
        textAsk({
          title: isNew ? '设置答案' : '设置答案（留空＝不变）',
          sub: isNew ? '输入该题的正确答案（原样输入，区分大小写）：' : '输入新答案；留空则沿用原答案：',
          placeholder: '答案', maxlen: 60, okLabel: isNew ? '添加' : '保存', cancel: false,
          onSubmit: function (a) {
            if (isNew) {
              if (!a) { showErr('答案不能为空'); return; }
              qaBuf.push({ q: q, h: h53(String(a).trim()) });
            } else {
              editing.q = q;
              if (a) editing.h = h53(String(a).trim());
            }
            qaPanel();
          }
        });
      }
    });
  }
  // 管理操作前置验证：有数字密码→输密码；否则→输暗号 990915（防旁人顺手删题/关问答门）
  // next() 通过；cancel() 用户取消
  function qaGuard(next, cancel) {
    const onCancel = function () { if (cancel) cancel(); else { syncQaUi(); syncUi(); } };
    if (pinHash()) {
      padVerify({
        title: '验证身份', sub: '先输入当前密码', forget: true,
        onOk: function () { next(); },
        onForgetDone: function () { toast('密码已重设'); next(); },
        onCancel: onCancel
      });
      return;
    }
    textAsk({
      title: '验证身份', sub: '本机未设数字密码，请输入开屏问答的暗号继续：',
      placeholder: '暗号', maxlen: 12, okLabel: '确定', cancelLabel: '取消',
      onSubmit: function (v) {
        if (String(v || '').trim() === QA_SKIP_CODE) { next(); }
        else {
          const inp = document.getElementById('applock-txt'); if (inp) inp.value = '';
          showErr('暗号不对');
        }
      },
      onCancel: onCancel
    });
  }
  function syncQaUi() {
    const c = qaEl();
    const s = qaSubEl();
    if (!c || !s) return;
    const on = qaEnabled();
    c.checked = on;
    const raw = qaRaw();
    const n = raw ? raw.length : (qaList().length);
    let html;
    if (on) {
      const acts = [{ act: 'qa-manage', label: '编辑问答题' }];
      if (qaSkipped()) acts.push({ act: 'qa-unskip', label: '恢复本机问答' });
      html = '<span>已开启：每次打开本站需先答对 <b>' + n + '</b> 道问答题' +
        (enabled() && !!pinHash() ? '，再输入数字密码' : '') + '。' +
        (qaSkipped() ? '本机已输暗号跳过问答（当前不再询问）。' : '锁屏时点「输暗号 990915」可让本机永久跳过问答层。') +
        '</span>' + actsHtml(acts);
    } else {
      html = '<span>未开启。开启后每次打开本站需先答对问答题才放行；可不设上方数字密码锁单独使用。锁屏时输暗号 <b>990915</b> 可让本机永久跳过问答层。</span>' +
        (raw ? actsHtml([{ act: 'qa-manage', label: '编辑问答题' }]) : '');
    }
    s.innerHTML = html;
    Array.prototype.forEach.call(s.querySelectorAll('[data-aa]'), function (b) {
      b.addEventListener('click', function () {
        const act = b.getAttribute('data-aa');
        if (act === 'qa-manage') qaGuard(qaOpenEdit);
        else if (act === 'qa-unskip') { qaSkipSet(false); toast('已恢复：本机再次打开会询问问答'); syncQaUi(); }
      });
    });
  }
  function bindQaSettings() {
    const c = qaEl();
    const s = qaSubEl();
    if (!c || !s) return;
    syncQaUi();
    c.addEventListener('change', function () {
      const wantOn = c.checked;
      c.disabled = true;
      const done = function () { c.disabled = false; syncQaUi(); syncUi(); };
      if (wantOn) {
        if (!qaRaw()) { gSet(K_QA_LIST, JSON.stringify(qaList().map(function (it) { return { q: it.q, h: it.h }; }))); }
        qaSetEn(true);
        done();
        toast('开屏问答已开启');
      } else {
        // 关闭问答门：防旁人顺手关（有密码用密码，无密码用暗号）
        qaGuard(function () {
          qaSetEn(false);
          done();
          toast('开屏问答已关闭');
        }, function () {
          c.disabled = false;
          c.checked = true;    // 验证未通过 → 保持开启
          syncQaUi(); syncUi();
        });
      }
    });
  }

  function bindSettings() {
    const c = enEl();
    const s = subEl();
    if (!c || !s) return;
    syncUi();
    c.addEventListener('change', function () {
      const wantOn = c.checked;
      c.disabled = true;
      const done = function () { c.disabled = false; syncUi(); syncQaUi(); };
      if (wantOn) {
        if (pinHash()) { setEn(true); done(); toast('应用锁已开启'); return; }
        flowNewPin({
          t1: '设置解锁密码', s1: '设置 4-6 位数字密码', t2: '再输入一次确认', s2: '请再输入一次',
          done: function (pin) {
            savePin(pin);
            setEn(true);
            done();
            toast('应用锁已开启');
            if (!qaGet()) {   // 顺手引导设置安全问题（可跳过，跳过即无问答重置途径）
              setTimeout(function () {
                askQaSetup(function (q, a) {
                  saveQa(q, h53(a)); toast('安全问题已记录'); syncUi();
                });
              }, 300);
            }
          },
          cancel: done
        });
      } else {
        padVerify({
          title: '关闭应用锁', sub: '输入当前密码确认关闭（防止旁人随手关掉锁）',
          forget: true,
          onOk: function () { setEn(false); toast('应用锁已关闭'); done(); },
          onForgetDone: function () { setEn(false); toast('已重设密码并关闭应用锁'); done(); },
          onCancel: function () { done(); }
        });
      }
    });
  }

  // ---------- 启动 ----------
  function init() {
    bindSettings();
    bindQaSettings();
    try { evalLock(); } catch (e) {}
    // 数据主要在 IndexedDB 时 LS 首帧可能还没值 → 回填完成后补一次评估
    document.addEventListener('mochi-restore-done', function () {
      try { evalLock(); } catch (e) {}
    });
  }
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);

  window.__applockReady = true;
  // 无头验证专用入口（仅 tools/verify-applock.mjs 使用；无锁态下不绕行 evalLock）
  window.__applockQaTest = {
    openEdit: function () { qaOpenEdit(); },
    getList: function () { return qaRaw() || qaList(); }
  };
})();
