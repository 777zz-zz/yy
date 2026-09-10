// ===== 功能：消消乐（聊天页更多功能 → 小游戏） =====
// 和 TA 轮流交换的经典三消：点一格再点相邻一格，交换后凑成同款三连即消除，
// 上方补落、连锁连消；两人共用一张棋盘、共同冲目标分，不计输赢、记「默契分」。
// TA 由代码控制（无真 AI）：每回合枚举全部可消交换步并打分，再抽行为状态——
//   serious 走最优步 / normal 前五随机（人式不精确）/ sandbag 故意走最差的可消步 /
//   blunder 先点一次无效交换（抖一下「点错了」）再随便走一步。
// 死锁自动洗牌；目标达成通关结算：写聊天记录（special:'match3'）+ 字卡库 TA 回应 +
// 默契分 + 心意币奖励（日封顶）。难度（头部下拉）：休闲 300 / 普通 600 / 挑战 1000 分。
// 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-match3-panel');
  if (!panel) return;
  const boardEl = document.getElementById('m3-board');
  const stageEl = document.getElementById('m3-stage');
  const statusEl = document.getElementById('m3-status');
  const infoEl = document.getElementById('m3-info');
  const overlayEl = document.getElementById('m3-overlay');
  const ovTitleEl = document.getElementById('m3-ov-title');
  const ovBodyEl = document.getElementById('m3-ov-body');
  const startBtn = document.getElementById('m3-btn-start');
  const endBtn = document.getElementById('m3-btn-end');
  const hintBtn = document.getElementById('m3-hint');
  const soundBtn = document.getElementById('m3-sound');
  const closeBtn = document.getElementById('m3-close');
  const diffSel = document.getElementById('m3-diff');
  const partnerNameEl = document.getElementById('m3-partner-name');

  const N = 8, KIND_N = 6;
  const KINDS = ['🍓', '🍋', '🍇', '🔔', '⭐', '🎈'];
  const DIFFS = {
    casual: { target: 300, coin: 520, label: '🌱 休闲 · 300 分' },
    normal: { target: 600, coin: 1314, label: '🌙 普通 · 600 分' },
    hard:   { target: 1000, coin: 5200, label: '⭐ 挑战 · 1000 分' }
  };
  const THINK_LINES = ['TA正在找能消的……', 'TA扫视着棋盘', 'TA歪头想了想'];
  const TURN_MIN = 900, TURN_VAR = 800;

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function fastMul() { return (window.__m3Debug && window.__m3Debug.fast) ? 0.05 : 1; }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---- 音效 ----
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.value = vol || 0.16;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  const sfxPick = () => beep(500, 0.06, 0.14);
  const sfxSwap = () => beep(380, 0.07, 0.14);
  const sfxClear = (n) => { beep(560 + Math.min(5, n) * 60, 0.09, 0.16); };
  const sfxBad = () => beep(180, 0.07, 0.12);
  const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };

  // ---- 对局状态 ----
  let st = null;
  let thinkT = null;

  function newState(diff) {
    return {
      diff: diff,
      target: DIFFS[diff].target,
      grid: [],                // grid[r][c] = 种类下标
      turn: 1,                 // 1 玩家 / 2 TA
      over: false,
      started: false,
      lock: false,             // 消除动画/结算期间锁输入
      sel: null,
      score: 0, myScore: 0, taScore: 0,
      misPicks: 0
    };
  }

  // ---- 战绩（每联系人独立） ----
  function statsKey() { return prefix() + ':match3-stats'; }
  function loadStats() {
    const d = { clears: 0, bestChem: 0, lastDiff: 'normal' };
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
    } catch (e) {}
    return d;
  }
  function saveStats(s) { try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {} }

  // ---- 三消规则（纯函数，__m3Debug 复用） ----
  // 找出全部 ≥3 同款直线（行/列），返回要消除的格子集合（去重）
  function findMatches(grid) {
    const mark = [];
    for (let r = 0; r < N; r++) mark.push(new Array(N).fill(false));
    let any = false;
    for (let r = 0; r < N; r++) {
      let run = 1;
      for (let c = 1; c <= N; c++) {
        const same = c < N && grid[r][c] === grid[r][c - 1] && grid[r][c] >= 0;
        if (same) { run++; continue; }
        if (run >= 3 && grid[r][c - 1] >= 0) {
          any = true;
          for (let k = c - run; k < c; k++) mark[r][k] = true;
        }
        run = 1;
      }
    }
    for (let c = 0; c < N; c++) {
      let run = 1;
      for (let r = 1; r <= N; r++) {
        const same = r < N && grid[r][c] === grid[r - 1][c] && grid[r][c] >= 0;
        if (same) { run++; continue; }
        if (run >= 3 && grid[r - 1][c] >= 0) {
          any = true;
          for (let k = r - run; k < r; k++) mark[k][c] = true;
        }
        run = 1;
      }
    }
    return any ? mark : null;
  }
  // 重力补落：每列非空值下沉、顶部补随机新格；返回是否发生变动
  function collapse(grid) {
    let moved = false;
    for (let c = 0; c < N; c++) {
      let write = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        if (grid[r][c] >= 0) {
          if (write !== r) { grid[write][c] = grid[r][c]; grid[r][c] = -1; moved = true; }
          write--;
        }
      }
      for (let r = write; r >= 0; r--) { grid[r][c] = Math.floor(Math.random() * KIND_N); moved = true; }
    }
    return moved;
  }
  // 在副本上完整结算一段消除链，返回本次交换消掉的格子总数（TA 打分用）
  function simulateClear(gridIn) {
    const g = gridIn.map((row) => row.slice());
    let total = 0, chain = 0;
    for (;;) {
      const m = findMatches(g);
      if (!m) break;
      let cnt = 0;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { if (m[r][c]) { g[r][c] = -1; cnt++; } }
      total += cnt * (chain + 1);
      collapse(g);
      chain++;
      if (chain > 20) break;
    }
    return total;
  }
  // 枚举全部相邻交换后能产生消除的步（TA 决策 / 死锁检测 / 提示共用）
  function allMoves(grid) {
    const out = [];
    const dirs = [[0, 1], [1, 0]];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      for (let d = 0; d < dirs.length; d++) {
        const r2 = r + dirs[d][0], c2 = c + dirs[d][1];
        if (r2 >= N || c2 >= N) continue;
        const g = grid.map((row) => row.slice());
        const t = g[r][c]; g[r][c] = g[r2][c2]; g[r2][c2] = t;
        const gain = simulateClear(g);
        if (gain > 0) out.push({ a: [r, c], b: [r2, c2], gain: gain });
      }
    }
    return out;
  }

  // ---- 发牌 / 死锁洗牌 ----
  function dealGrid() {
    let grid;
    do {
      grid = [];
      for (let r = 0; r < N; r++) {
        const row = [];
        for (let c = 0; c < N; c++) row.push(Math.floor(Math.random() * KIND_N));
        grid.push(row);
      }
    } while (findMatches(grid) || allMoves(grid).length === 0);
    return grid;
  }
  function reshuffle() {
    let flat = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) flat.push(st.grid[r][c]);
    for (let tries = 0; tries < 80; tries++) {
      shuffle(flat);
      const g = [];
      for (let r = 0; r < N; r++) g.push(flat.slice(r * N, (r + 1) * N));
      if (!findMatches(g) && allMoves(g).length > 0) { st.grid = g; renderBoard(); return true; }
    }
    renderBoard();
    return false;
  }

  // ---- 渲染 ----
  function buildBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = 'repeat(' + N + ',1fr)';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const cell = document.createElement('div');
      cell.className = 'm3-tile';
      cell.setAttribute('data-r', String(r));
      cell.setAttribute('data-c', String(c));
      boardEl.appendChild(cell);
    }
  }
  function fitBoard() {
    if (!stageEl || panel.hidden || !st) return;
    const w = stageEl.clientWidth;
    if (!w) return;
    const cellPx = Math.max(28, Math.min(46, Math.floor(w / N)));
    boardEl.style.width = (cellPx * N) + 'px';
    const tiles = boardEl.querySelectorAll('.m3-tile');
    for (let i = 0; i < tiles.length; i++) { tiles[i].style.width = cellPx + 'px'; tiles[i].style.height = cellPx + 'px'; tiles[i].style.fontSize = Math.round(cellPx * 0.54) + 'px'; }
  }
  function tileAt(r, c) { return boardEl.children[r * N + c] || null; }
  function renderBoard() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const el = tileAt(r, c);
      if (!el) continue;
      el.classList.remove('m3-sel', 'm3-hint', 'm3-shake');
      el.textContent = st.grid[r][c] >= 0 ? KINDS[st.grid[r][c]] : '';
    }
    updateInfo();
  }
  function flashClear(cells) {
    for (let i = 0; i < cells.length; i++) {
      const el = tileAt(cells[i][0], cells[i][1]);
      if (el) { el.classList.add('m3-pop'); setTimeout(((el2) => () => el2.classList.remove('m3-pop'))(el), 220); }
    }
  }
  function updateInfo() {
    if (infoEl) infoEl.innerHTML =
      '<span>🎯 ' + st.score + ' / ' + st.target + '</span>' +
      '<span>你 ' + st.myScore + '</span>' +
      '<span>' + T('TA') + ' ' + st.taScore + '</span>' +
      '<span>💕 ' + chemNow() + '</span>';
  }
  function chemNow() {
    const total = st.myScore + st.taScore;
    if (!total) return 60;
    const share = Math.min(st.myScore, st.taScore) / Math.max(1, Math.max(st.myScore, st.taScore));
    return Math.max(0, Math.min(100, Math.round(55 + share * 35 - st.misPicks * 2)));
  }
  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  function dot(side) { return '<i class="c4-dot ' + (side === 1 ? 'c4-dot-you' : 'c4-dot-ta') + '"></i>'; }
  function showTurnStatus() {
    if (!statusEl || !st || st.over) return;
    setStatus(st.turn === 1 ? dot(1) + '你的回合：点一格再点相邻一格交换' : T(THINK_LINES[0]));
  }

  // ---- 对局流程 ----
  function newGame() {
    clearTimeout(thinkT); thinkT = null;
    const diff = diffSel && DIFFS[diffSel.value] ? diffSel.value : 'normal';
    st = newState(diff);
    st.grid = dealGrid();
    st.started = true;
    hideOverlay();
    buildBoard();
    fitBoard();
    renderBoard();
    st.turn = 1;
    setStatus(dot(1) + '你的回合：点一格再点相邻一格交换');
  }
  // 执行一次有效交换并完整结算连锁；byMe=发起方计分
  function doSwap(a, b, byMe, cb) {
    st.lock = true;
    const t = st.grid[a[0]][a[1]];
    st.grid[a[0]][a[1]] = st.grid[b[0]][b[1]];
    st.grid[b[0]][b[1]] = t;
    let chain = 0, gained = 0;
    const step = () => {
      const m = findMatches(st.grid);
      if (!m) {
        if (!chain) {
          // 无效交换：换回去
          const t2 = st.grid[a[0]][a[1]];
          st.grid[a[0]][a[1]] = st.grid[b[0]][b[1]];
          st.grid[b[0]][b[1]] = t2;
          renderBoard();
          st.lock = false;
          sfxBad();
          if (cb) cb(false, 0);
          return;
        }
        finish();
        return;
      }
      chain++;
      const cells = [];
      let cnt = 0;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { if (m[r][c]) { st.grid[r][c] = -1; cells.push([r, c]); cnt++; } }
      const pts = cnt * chain;
      gained += pts;
      st.score += pts;
      if (byMe) st.myScore += pts; else st.taScore += pts;
      flashClear(cells);
      sfxClear(chain);
      collapse(st.grid);          // 重力补落后再等下一轮查连锁
      renderBoard();
      setTimeout(step, Math.round(230 * fastMul()));
    };
    const finish = () => {
      updateInfo();
      st.lock = false;
      if (cb) cb(true, gained);
    };
    step();
  }
  function afterMove(byMe) {
    if (st.score >= st.target) { endGame(); return; }
    if (allMoves(st.grid).length === 0) {
      reshuffle();
      setStatus('🌀 没有能消的了，自动洗了个牌');
    }
    st.turn = byMe ? 2 : 1;
    if (st.turn === 2) scheduleTaTurn(TURN_MIN + Math.random() * TURN_VAR);
    else showTurnStatus();
  }
  function playerSwap(a, b) {
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    sfxSwap();
    doSwap(a, b, true, (ok) => {
      if (!ok) { st.misPicks++; updateInfo(); }
      afterMove(true);
    });
  }

  // ---- TA 回合 ----
  function rollMode() {
    const r = Math.random();
    if (r < 0.55) return 'serious';
    if (r < 0.8) return 'normal';
    if (r < 0.93) return 'sandbag';
    return 'blunder';
  }
  function scheduleTaTurn(delay) {
    clearTimeout(thinkT);
    setStatus(T(THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)]));
    thinkT = setTimeout(taTurn, Math.round(delay * fastMul()));
  }
  function taTurn() {
    if (!st || st.over || st.turn !== 2 || st.lock) return;
    st.mode = rollMode();
    const moves = allMoves(st.grid);
    if (!moves.length) { endGame(); return; }
    if (st.mode === 'serious') {
      moves.sort((x, y) => y.gain - x.gain);
      exec(pick(moves.slice(0, 2)));
    } else if (st.mode === 'normal') {
      moves.sort((x, y) => y.gain - x.gain);
      exec(pick(moves.slice(0, 5)));
    } else if (st.mode === 'sandbag') {
      moves.sort((x, y) => x.gain - y.gain);
      exec(pick(moves.slice(0, Math.max(2, Math.ceil(moves.length / 2)))));
    } else {
      // blunder：先点一次无效交换（抖一下），再随便走一步
      const a = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)];
      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
      const d = pick(dirs);
      const b = [a[0] + d[0], a[1] + d[1]];
      if (b[0] >= 0 && b[0] < N && b[1] >= 0 && b[1] < N) {
        const g2 = st.grid.map((row) => row.slice());
        const t = g2[a[0]][a[1]]; g2[a[0]][a[1]] = g2[b[0]][b[1]]; g2[b[0]][b[1]] = t;
        if (!findMatches(g2)) {
          sfxBad();
          setStatus(T('TA') + '点错了，重新选……');
          const ea = tileAt(a[0], a[1]);
          if (ea) { ea.classList.add('m3-shake'); setTimeout(() => ea.classList.remove('m3-shake'), 300); }
          setTimeout(() => {
            if (!st || st.over) return;
            exec(pick(moves));
          }, Math.round(600 * fastMul()));
          return;
        }
      }
      exec(pick(moves));
    }
    function exec(mv) {
      if (!mv) { st.turn = 1; showTurnStatus(); return; }
      sfxSwap();
      doSwap(mv.a, mv.b, false, () => {
        if (st.score >= st.target) { endGame(); return; }
        if (allMoves(st.grid).length === 0) reshuffle();
        st.turn = 1;
        showTurnStatus();
      });
    }
  }

  // ---- 结束：默契 / 奖励 / 聊天联动 ----
  function endGame() {
    st.over = true; st.turn = 0; st.lock = false;
    clearTimeout(thinkT); thinkT = null;
    const chem = chemNow();
    const s = loadStats();
    s.clears = (s.clears || 0) + 1;
    s.bestChem = Math.max(s.bestChem || 0, chem);
    s.lastDiff = st.diff;
    saveStats(s);
    sfxWin();
    // 心意币：按难度发放，日封顶 ¥104，双方同步同额
    var coinLine = '';
    try {
      var COIN_CAP = 10400;
      var day = new Date().toISOString().slice(0, 10);
      var ck = prefix() + ':ml2_coin_match3_' + day;
      var cur = Number(localStorage.getItem(ck)) || 0;
      if (cur < COIN_CAP) {
        var real = Math.min(DIFFS[st.diff].coin, COIN_CAP - cur);
        try { localStorage.setItem(ck, String(cur + real)); } catch (e2) {}
        if (real > 0 && typeof window.giftWalletChange === 'function') {
          if (window.giftWalletChange(real, real, '消消乐')) {
            coinLine = '🪙 双方心意币各 +¥' + (real / 100).toFixed(2);
          }
        }
      }
    } catch (e) {}
    const body =
      '<div class="pong-end-stat">🎯 达成 ' + st.score + ' / ' + st.target + ' 分</div>' +
      '<div class="pong-end-stat">💕 默契 ' + chem + ' · 你 ' + st.myScore + ' · ' + T('TA') + ' ' + st.taScore + '</div>' +
      '<div class="pong-end-stat">累计通关 ' + s.clears + ' 局 · 历史最佳默契 ' + s.bestChem + '</div>' +
      (coinLine ? '<div class="pong-end-stat">' + coinLine + '</div>' : '');
    showOverlay('目标达成！', body, '再来一局');
    if (startBtn) startBtn.textContent = '再来一局';
    if (endBtn) endBtn.hidden = false;
    setStatus('🎉 达成目标！默契 ' + chem);
    // 写聊天系统消息 + TA 随机回应
    try {
      if (window.chatAddSystem) window.chatAddSystem(T('消消乐') + ' · 达成 ' + st.score + ' 分 · 默契 ' + chem, { special: 'match3' });
      const fb = ['通关啦，配合不错。', '我们好默契呀。', '再来一局？'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏平局·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      setTimeout(() => {
        try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
      }, 800);
    } catch (e) {}
  }

  // ---- 覆盖层 ----
  function showOverlay(title, body, btnText) {
    if (!overlayEl) return;
    if (ovTitleEl) ovTitleEl.innerHTML = title || '';
    if (ovBodyEl) ovBodyEl.innerHTML = body || '';
    if (startBtn && btnText) startBtn.textContent = btnText;
    overlayEl.hidden = false;
  }
  function showStartOverlay() {
    const s = loadStats();
    showOverlay('消消乐',
      '<div class="c4-start-tip">和 ' + T('TA') + ' 轮流交换相邻两格<br>凑成同款三连就消除，一起冲到目标分</div>' +
      '<div class="c4-start-note">🎲 ' + T('TA') + '每回合状态随机——最优步 / 前五挑一 / 放水 / 手滑</div>' +
      (s.clears > 0 ? '<div class="pong-end-stat">累计通关 ' + s.clears + ' 局 · 历史最佳默契 ' + s.bestChem + '</div>' : ''),
      s.clears > 0 ? '再来一局' : '开始对局');
    if (endBtn) endBtn.hidden = true;
  }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; if (endBtn) endBtn.hidden = true; }

  // ---- 输入 ----
  boardEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = e.target.closest('.m3-tile');
    if (!cell) return;
    const r = parseInt(cell.getAttribute('data-r'), 10) || 0;
    const c = parseInt(cell.getAttribute('data-c'), 10) || 0;
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    if (st.sel && st.sel[0] === r && st.sel[1] === c) {
      st.sel = null;
      cell.classList.remove('m3-sel');
      sfxPick();
      return;
    }
    if (!st.sel) {
      st.sel = [r, c];
      cell.classList.add('m3-sel');
      sfxPick();
      return;
    }
    const a = st.sel;
    const dr = Math.abs(a[0] - r), dc = Math.abs(a[1] - c);
    const adj = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
    st.sel = null;
    boardEl.querySelectorAll('.m3-sel').forEach((x) => x.classList.remove('m3-sel'));
    if (!adj) {
      st.sel = [r, c];
      cell.classList.add('m3-sel');
      sfxPick();
      return;
    }
    playerSwap(a, [r, c]);
  });
  if (startBtn) startBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (diffSel) diffSel.addEventListener('change', () => {
    const s = loadStats(); s.lastDiff = diffSel.value; saveStats(s);
  });
  if (hintBtn) hintBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    const moves = allMoves(st.grid);
    if (!moves.length) return;
    moves.sort((x, y) => y.gain - x.gain);
    const mv = moves[0];
    [mv.a, mv.b].forEach((p) => {
      const el = tileAt(p[0], p[1]);
      if (el) { el.classList.remove('m3-hint'); void el.offsetWidth; el.classList.add('m3-hint'); }
    });
    sfxPick();
  });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.classList.toggle('pong-sound-off', !soundOn);
  });

  // ---- 打开 / 关闭 ----
  function setNames() {
    let name = T('TA');
    try {
      const s = window.activeStore && window.activeStore();
      name = (s && (s.get('cs-lbl-partner') || s.get('lbl-partner'))) || name;
    } catch (e) {}
    if (partnerNameEl) partnerNameEl.textContent = name;
  }
  window.openMatch3Panel = function () {
    if (!st || !st.started) { try { const s = loadStats(); if (DIFFS[s.lastDiff] && diffSel) diffSel.value = s.lastDiff; } catch (e) {} }
    panel.hidden = false;
    try { setNames(); } catch (e) {}
    try { if (st && st.started) fitBoard(); } catch (e) {}
    // 有进行中的对局 → 接着玩（关面板期间轮到 TA 的补调度）
    if (st && st.started && !st.over) {
      if (st.turn === 2 && !thinkT && !st.lock) scheduleTaTurn(TURN_MIN + Math.random() * TURN_VAR);
      else if (st.turn === 1) showTurnStatus();
      return;
    }
    showStartOverlay();
    setStatus('点击「开始对局」');
  };
  function closePanel() {
    clearTimeout(thinkT); thinkT = null;
    if (panel) panel.hidden = true;
  }
  window.closeMatch3Panel = closePanel;
  document.addEventListener('contact-switched', () => { try { closePanel(); } catch (e) {} });
  window.addEventListener('resize', () => { if (!panel.hidden) fitBoard(); });

  // ---- 入口：聊天更多功能 → 小游戏 → 消消乐（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-match3');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      hideSiblingPanels('chat-match3-panel');
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { openMatch3Panel(); } catch (err) {
        try { panel.hidden = false; showStartOverlay(); setStatus('点击「开始对局」'); } catch (e2) {}
        try { console.error('[match3] open failed', err); } catch (e2) {}
      }
    });
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = siblingIds('chat-match3-panel');
        const mo = new MutationObserver(() => {
          if (panel.hidden) return;
          for (let i = 0; i < SIBLING_IDS.length; i++) {
            const el = document.getElementById(SIBLING_IDS[i]);
            if (el && !el.hidden) { closePanel(); break; }
          }
        });
        SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
      }
    } catch (e) {}
  })();

  // 半框互斥清单（全部聊天页浮层面板；各游戏文件各自维护一份含其余全部面板的列表）
  function siblingIds(self) {
    return ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-ms-panel', 'chat-fish-panel', 'chat-memory-panel', 'chat-gift-panel', 'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-more-panel'].filter((id) => id !== self);
  }
  function hideSiblingPanels(self) {
    siblingIds(self).forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
  }

  // 只读调试口（供后续 verify 脚本复用）
  window.__m3Debug = {
    st: () => st,
    newGame: newGame,
    findMatches: findMatches,
    allMoves: allMoves,
    simulateClear: simulateClear,
    fast: false
  };
})();
