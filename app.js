/* 화면 계층. 모든 계산과 상태 변경은 core.js를 통해서만 한다. */
(function () {
  'use strict';
  var KEY = 'habitApp.v1', PREV = 'habitApp.prev';
  var CH = [['🐰', '토끼'], ['🐻', '곰'], ['🐱', '고양이'], ['🐶', '강아지'], ['🐼', '판다'], ['🦊', '여우']];
  var COLORS = ['#ffc2c2', '#ffe0a3', '#c9f0c0', '#bfe3ff', '#dccbff', '#ffd0ec'];
  var REJECT_REASONS = ['개수 확인 필요', '숙제 확인 필요', '다른 아이 기록으로 입력됨', '직접 입력'];
  var REST_REASONS = ['여행', '몸이 아픔', '가족 일정', '직접 입력'];
  var PARENT_VIEWS = { parent: 1, approve: 1, rest: 1, settings: 1 };
  var STATUS = {
    success: ['⭐', '성공', 'ok'], fail: ['○', '실패', ''], rest: ['🛌', '쉬는 날', 'rest'],
    pending: ['⏳', '확인 대기', 'wait'], progress: ['📝', '진행 중', ''], ready: ['📤', '제출 가능', 'wait']
  };

  var S = load();
  var ui = { view: 'home', kid: null, parent: false, parentAt: 0, calKid: null, calMonth: null, rwKid: null, modal: null, anomaly: false, req: {}, pinCb: null };
  var T = '', cache = {};

  // ---------- 저장 ----------
  function load() { try { var r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function persist(c) { localStorage.setItem(KEY, JSON.stringify(c)); }
  function run(fn) {
    var c = Core.clone(S);
    try { var r = fn(c, Date.now()); persist(c); S = c; return { ok: true, r: r }; }
    catch (e) { toast(e && e.message ? e.message : '저장하지 못했어요'); return { ok: false }; }
  }
  function tickNow() {
    if (!S) return;
    try { ui.anomaly = Core.tick(S, Date.now()); persist(S); } catch (e) { /* 저장 공간 문제는 다음 동작에서 알림 */ }
  }

  // ---------- 유틸 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(n) { return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ko-KR') + '원'; }
  function num(n) { return Number(n).toLocaleString('ko-KR'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { var p = d.split('-').map(Number); return p[1] + '월 ' + p[2] + '일 (' + '일월화수목금토'[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ')'; }
  function fmtTime(ms) { var t = new Date(ms + 9 * 3600000); return (t.getUTCMonth() + 1) + '월 ' + t.getUTCDate() + '일 ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()); }
  function kid(id) { return S.kids.filter(function (k) { return k.id === id; })[0]; }
  function info(id) { return cache[id] || (cache[id] = Core.computeKid(S, id, T)); }
  function rid(key) { return ui.req[key] || (ui.req[key] = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
  function done(key) { delete ui.req[key]; }
  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? e.value : ''; }
  function toast(m) {
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = m; document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
  }
  function beep() {
    if (!S || !S.family.sound) return;
    try {
      var A = window.AudioContext || window.webkitAudioContext, c = new A(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination); o.frequency.value = 784; g.gain.value = 0.08; o.start();
      o.frequency.setValueAtTime(1047, c.currentTime + 0.12); o.stop(c.currentTime + 0.3);
    } catch (e) { /* 소리 실패는 무시 */ }
  }
  function kidStyle(k) { return 'style="--kc:' + esc(k.color) + '"'; }
  function badge(st, extra) { var s = STATUS[st]; return '<span class="badge ' + s[2] + '">' + s[0] + ' ' + s[1] + (extra || '') + '</span>'; }
  function kidSeg(act, cur) {
    return '<div class="seg">' + S.kids.map(function (k) {
      return '<button class="' + (k.id === cur ? 'on' : '') + '" data-act="' + act + '" data-id="' + k.id + '">' + esc(k.character) + ' ' + esc(k.name) + '</button>';
    }).join('') + '</div>';
  }
  function pendingTotal() { return S.kids.reduce(function (a, k) { return a + info(k.id).pendingCount; }, 0); }
  function oldestPendingAge(id) {
    var p = info(id).pendingRows; return p.length ? Core.daysBetween(p[0].date, T) : 0;
  }

  // ---------- 화면 전환 ----------
  function go(view, extra) {
    if (PARENT_VIEWS[view] && !ui.parent) { askPin(function () { go(view, extra); }); return; }
    ui.view = view; if (extra) Object.keys(extra).forEach(function (k) { ui[k] = extra[k]; });
    render(); window.scrollTo(0, 0);
  }
  function lockParent() { ui.parent = false; if (PARENT_VIEWS[ui.view]) ui.view = 'home'; }

  // ---------- 렌더 ----------
  function render() {
    var app = $('app');
    if (!app.firstChild) app.innerHTML = '<div id="view"></div><div id="modal"></div>';
    if (!S || ui.setupCode) { $('view').innerHTML = setupView(); return; }
    cache = {}; T = Core.viewToday(S, Date.now());
    var body = '';
    switch (ui.view) {
      case 'record': body = recordView(); break;
      case 'approve': body = approveView(); break;
      case 'cal': body = calView(); break;
      case 'rew': body = rewView(); break;
      case 'parent': body = parentView(); break;
      case 'rest': body = restView(); break;
      case 'settings': body = settingsView(); break;
      default: body = homeView();
    }
    var tab = { home: 'home', record: 'home', cal: 'cal', rew: 'rew' }[ui.view] || 'parent', pt = pendingTotal();
    function tb(id, ic, t, dot) { return '<button class="' + (tab === id ? 'on' : '') + '" data-act="go" data-v="' + id + '"><span>' + ic + '</span>' + t + (dot ? '<i class="dot">' + dot + '</i>' : '') + '</button>'; }
    $('view').innerHTML = body + '<nav class="tabs"><div>' + tb('home', '🏠', '홈') + tb('cal', '📅', '달력') + tb('rew', '💰', '용돈') + tb('parent', '🔒', '부모', pt || '') + '</div></nav>';
    document.body.classList.toggle('reduce', !S.family.sound);
    renderModal();
  }

  // ----- 첫 실행 -----
  function setupView() {
    if (ui.setupCode) {
      return '<main><h1>보호자 복구 코드</h1><p>PIN을 잊었을 때 필요해요. 종이에 적어 따로 보관하세요. 이 화면을 닫으면 다시 볼 수 없어요.</p>' +
        '<div class="mono">' + esc(ui.setupCode) + '</div>' +
        '<label class="chk"><input type="checkbox" id="codeOk"> 복구 코드를 안전한 곳에 적어 두었어요</label>' +
        '<button class="btn" data-act="setupFinish">시작하기</button></main>';
    }
    var h = '<main><h1>처음 설정</h1><p class="sub">두 아이의 별명과 캐릭터를 정해 주세요. 실명이나 학교 정보는 필요 없어요.</p>';
    [0, 1].forEach(function (i) {
      h += '<div class="card"><h3>' + (i ? '둘째' : '첫째') + '</h3><label>별명</label><input type="text" id="sn' + i + '" maxlength="10" value="' + (i ? '둘째' : '첫째') + '">' +
        '<label>캐릭터</label><div class="chips" id="sc' + i + '">' + CH.map(function (c, j) { return '<button type="button" class="chip' + (j === i ? ' on' : '') + '" data-act="pickChip" data-g="sc' + i + '" data-v="' + c[0] + '">' + c[0] + ' ' + c[1] + '</button>'; }).join('') + '</div>' +
        '<label>강조 색</label><div class="chips" id="sk' + i + '">' + COLORS.map(function (c, j) { return '<button type="button" class="chip' + (j === i ? ' on' : '') + '" data-act="pickChip" data-g="sk' + i + '" data-v="' + c + '" style="background:' + c + '">　</button>'; }).join('') + '</div>' +
        '<label>어제까지 연속 성공일수</label><input type="number" id="ss' + i + '" inputmode="numeric" min="0" step="1" value="' + (i ? 21 : 26) + '"><p class="sub">0이면 오늘부터 시작해요. 그만큼의 성공 기록과 보상이 함께 만들어져요.</p></div>';
    });
    h += '<div class="card">' +
      '<label>보호자 PIN (숫자 6자리 이상, 아이폰 암호와 다른 번호)</label><input type="password" inputmode="numeric" class="pin" id="sp1" autocomplete="off">' +
      '<label>PIN 한 번 더</label><input type="password" inputmode="numeric" class="pin" id="sp2" autocomplete="off"></div>' +
      '<button class="btn" data-act="setupDone">설정 끝내기</button></main>';
    return h;
  }

  // ----- S01 메인 -----
  function homeView() {
    var h = '<div class="top"><div><h1>오늘도 하나씩 해보자</h1><div class="date">' + fmtDate(T) + '</div></div><button class="gear" data-act="go" data-v="parent" aria-label="부모 메뉴">⚙️</button></div><main>';
    if (ui.anomaly || Core.clockBlocked(S, Date.now())) h += '<div class="hint bad">휴대폰 시각이 바뀐 흔적이 있어요. 지난 날짜에는 새로 제출할 수 없어요.</div>';
    S.kids.forEach(function (k) { h += kidCard(k); });
    return h + '</main>';
  }
  function kidCard(k) {
    var I = info(k.id), m = Core.money(S, k.id), t = I.today;
    var h = '<div class="card kidcard" ' + kidStyle(k) + '><div class="kidhead"><div class="avatar">' + esc(k.character) + '</div><div><div class="name">' + esc(k.name) + '</div>';
    if (!I.started) return h + '<div class="sub">' + fmtDate(k.startDate) + '부터 시작해요</div></div></div></div>';
    h += '<div class="streak">🔥 연속 성공 ' + I.expectedStreak + '일</div>';
    if (I.blocked && I.expectedStreak === I.confirmedStreak + I.pendingCount) h += '<div class="sub">확정 ' + I.confirmedStreak + '일 · 확인 대기 ' + I.pendingCount + '일</div>';
    h += '<div class="sub">부모가 정한 쉬는 날은 제외해요</div></div></div>';
    h += '<div class="row"><span>지금까지 번 돈</span><b class="money">' + won(m.earned) + '</b></div>';
    h += '<div class="row"><span>아직 받지 않은 돈</span><b class="money">' + won(m.payable) + '</b></div><hr style="border:0;border-top:1px solid var(--line)">';
    if (t.status === 'rest') h += '<p><b>😴 오늘은 쉬는 날</b></p><p class="sub">다음 도전은 ' + (I.expectedStreak + 1) + '일째</p>';
    else if (t.status === 'success') h += '<p>' + badge('success') + ' <b>오늘도 해냈어</b> · +' + won(t.reward) + '</p><p class="sub">다음 활동일 목표 ' + num(Core.goalFor(I.expectedStreak + 1)) + '개</p>';
    else {
      h += '<div class="row"><span>오늘 줄넘기</span><b class="money">' + num(t.count) + ' / ' + num(t.target) + '개' + (t.estimated ? ' (예상)' : '') + '</b></div>';
      h += '<div class="row"><span>숙제</span><b>' + (t.noHw ? '📖 오늘은 숙제 없음' : t.hw ? '✅ 숙제 완료' : '⬜ 숙제 아직') + '</b></div>';
      h += '<div class="row"><span>오늘 받을 수 있는 돈</span><b class="money">' + (t.estimated ? '예상 ' : '') + won(Core.rewardFor(t.n)) + '</b></div>';
      h += '<div class="row"><span>오늘 상태</span>' + badge(t.status) + '</div>';
    }
    if (I.pendingCount) h += '<div class="row"><span></span><span class="badge ' + (oldestPendingAge(k.id) >= S.family.alertDays ? 'urgent' : 'wait') + '">⏳ 아빠 확인 대기 ' + I.pendingCount + '건' + (oldestPendingAge(k.id) >= S.family.alertDays ? ' · 오래됐어요' : '') + '</span></div>';
    return h + '<button class="btn" data-act="openKid" data-id="' + k.id + '">오늘 할 일 보기</button></div>';
  }

  // ----- S02 오늘 기록 -----
  function recordView() {
    var k = kid(ui.kid), I = info(k.id), t = I.today, m = Core.money(S, k.id);
    var h = '<div class="top"><button class="btn sec small" data-act="go" data-v="home">← 홈</button><div class="date">' + fmtDate(T) + '</div></div><main>';
    h += '<div class="kidhead" ' + kidStyle(k) + '><div class="avatar">' + esc(k.character) + '</div><div><div class="name">' + esc(k.name) + '</div><div class="streak">🔥 연속 성공 ' + I.expectedStreak + '일</div></div></div>';
    if (!t) return h + '<div class="hint info">' + fmtDate(k.startDate) + '부터 시작해요</div></main>';
    if (t.status === 'rest') return h + '<div class="card center"><div class="big">😴</div><h2>오늘은 쉬는 날</h2><p>다음 도전은 ' + (I.expectedStreak + 1) + '일째예요</p></div></main>';
    if (t.status === 'success') return h + '<div class="card center"><div class="big">🎉</div><h2>오늘도 해냈어</h2><p>오늘 번 돈 <b>' + won(t.reward) + '</b> · 지금까지 ' + won(m.earned) + '</p><p class="sub">다음 활동일 목표 ' + num(Core.goalFor(I.expectedStreak + 1)) + '개</p></div></main>';
    var blockedClock = Core.clockBlocked(S, Date.now()), locked = blockedClock;
    h += '<div class="card"><div class="row"><span>오늘 목표</span><b class="money">' + num(t.target) + '개' + (t.estimated ? ' (예상)' : '') + '</b></div>';
    h += '<div class="row"><span>성공하면 받을 돈</span><b class="money">' + (t.estimated ? '예상 ' : '') + won(Core.rewardFor(t.n)) + '</b></div>';
    if (t.estimated) h += '<div class="hint info">이전 기록 확인 대기 중이라 목표와 금액은 예상이에요</div>';
    if (t.rejectReasons) h += '<div class="hint">아빠가 한 번 더 확인하고 싶대요. 고치고 다시 보내자<br><span class="sub">' + esc(t.rejectReasons.join(', ')) + '</span></div>';
    if (blockedClock) h += '<div class="hint bad">휴대폰 시각이 바뀐 흔적이 있어서 지금은 입력할 수 없어요</div>';
    h += '</div>';
    var pct = Math.min(100, Math.round(t.count / t.target * 100));
    h += '<div class="card"><h3>🪢 줄넘기</h3><label for="cnt">오늘 총 몇 개 했나요</label><input type="number" id="cnt" inputmode="numeric" min="0" step="1" value="' + t.count + '"' + (locked ? ' disabled' : '') + '>' +
      '<div class="bar ' + (t.count >= t.target ? 'done' : '') + '" ' + kidStyle(k) + '><i style="width:' + pct + '%"></i></div>' +
      '<div class="center money"><b>' + num(t.count) + '개</b> / ' + num(t.target) + '개' + (t.count >= t.target ? ' ✅ 목표 달성' : '') + '</div>' +
      '<div><button class="btn small sec" data-act="addCount" data-n="10"' + (locked ? ' disabled' : '') + '>+10</button><button class="btn small sec" data-act="addCount" data-n="100"' + (locked ? ' disabled' : '') + '>+100</button><button class="btn small" data-act="saveCount"' + (locked ? ' disabled' : '') + '>저장</button></div>';
    if (t.status === 'pending') h += '';
    h += '</div><div class="card"><h3>📚 숙제</h3>';
    if (t.noHw) h += '<div class="hint good">📖 오늘은 숙제 없는 날. 줄넘기만 하면 돼</div>';
    else h += '<button class="btn ' + (t.hw ? 'ok' : 'sec') + '" data-act="toggleHw"' + (locked ? ' disabled' : '') + '>' + (t.hw ? '✅ 오늘 숙제 완료 (누르면 취소)' : '⬜ 오늘 숙제 완료') + '</button>';
    h += '</div>';
    var need = t.target - t.count, why = '';
    if (need > 0) why = t.estimated ? '어제 기록을 아빠가 확인하기 전이라 ' + num(t.target) + '개가 목표예요' : '줄넘기 ' + num(need) + '개 더 하면 제출할 수 있어요';
    else if (!t.hw) why = '숙제까지 끝내면 오늘 도전 완료';
    if (t.status === 'pending') h += '<div class="hint">⏳ 아빠 확인을 기다리고 있어요<br><span class="sub">바꾸면 아빠에게 다시 확인받아야 해요</span></div>';
    else if (t.status === 'ready') h += '<button class="btn ok" data-act="submitToday"' + (locked ? ' disabled' : '') + '>다 했어요 아빠에게 확인받기</button>';
    else h += '<button class="btn" disabled>아빠에게 확인받기</button><p class="sub center">' + esc(why) + '</p>';
    return h + '</main>';
  }

  // ----- S03 부모 승인 -----
  function approveView() {
    var h = '<div class="top"><button class="btn sec small" data-act="go" data-v="parent">← 부모</button></div><main><h1>확인 대기</h1>';
    var any = false, now = Date.now();
    S.kids.forEach(function (k) {
      var rows = info(k.id).pendingRows;
      rows.forEach(function (r, idx) {
        any = true;
        var pv = Core.preview(S, k.id, now, function (c) { Core.reject(c, r.subId, ['x'], '', 'tmp', now); });
        var tc = pv.changes.filter(function (c) { return c.date === T && c.before && c.after && c.before.target !== c.after.target; })[0];
        var stale = Core.daysBetween(r.date, T) >= S.family.alertDays;
        h += '<div class="card kidcard" ' + kidStyle(k) + '><h3>' + esc(k.character) + ' ' + esc(k.name) + ' · ' + fmtDate(r.date) + (stale ? ' <span class="badge urgent">오래된 대기</span>' : '') + '</h3>' +
          '<div class="row"><span>그날 목표</span><b>' + num(r.target) + '개' + (r.subEstimated ? ' (제출 당시 예상)' : '') + '</b></div>' +
          '<div class="row"><span>입력한 개수</span><b>' + num(r.count) + '개</b></div>' +
          '<div class="row"><span>숙제</span><b>' + (r.noHw ? '📖 숙제 없음' : '✅ 완료') + '</b></div>' +
          '<div class="row"><span>제출 시각</span><b>' + fmtTime(r.at) + '</b></div>';
        if (r.anomaly) h += '<div class="hint bad">⚠️ 휴대폰 시각이 바뀐 흔적이 있어요</div>';
        if (r.expReward) h += '<div class="hint good">승인하면 연속 ' + r.streakE + '일째 · +' + won(r.expReward) + '</div>';
        else h += '<div class="hint bad">지금 계산으로는 목표에 미달해서 성공으로 인정되지 않아요. 과거 기록을 먼저 확인해 주세요.</div>';
        if (tc) h += '<div class="hint info">반려하면 오늘 목표가 ' + num(tc.before.target) + '개 → ' + num(tc.after.target) + '개로 바뀌어요</div>';
        if (idx > 0) h += '<div class="hint">먼저 ' + fmtDate(rows[0].date) + ' 기록부터 확인해 주세요</div>';
        h += '<button class="btn ok" data-act="approve" data-id="' + r.subId + '"' + (idx > 0 ? ' disabled' : '') + '>성공 승인</button>' +
          '<button class="btn danger" data-act="rejectOpen" data-id="' + r.subId + '">반려</button></div>';
      });
    });
    if (!any) h += '<div class="card center"><div class="big">👍</div><p>확인할 기록이 없어요</p></div>';
    return h + '</main>';
  }

  // ----- S04 기록 달력 -----
  function calView() {
    var kd = ui.calKid || S.kids[0].id, k = kid(kd), I = info(kd);
    var ym = ui.calMonth || T.slice(0, 7), y = +ym.slice(0, 4), mo = +ym.slice(5, 7);
    var first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var byDate = {}; I.rows.forEach(function (r) { byDate[r.date] = r; });
    var h = '<div class="top"><h1>기록 달력</h1></div><main>' + kidSeg('calKid', kd);
    h += '<div class="row"><button class="btn sec small" data-act="calMove" data-n="-1">◀</button><b>' + y + '년 ' + mo + '월</b><button class="btn sec small" data-act="calMove" data-n="1">▶</button></div><div class="cal">';
    '일월화수목금토'.split('').forEach(function (w) { h += '<div class="dow">' + w + '</div>'; });
    for (var i = 0; i < first; i++) h += '<div></div>';
    for (var d = 1; d <= days; d++) {
      var ds = ym + '-' + pad(d), r = byDate[ds], ic = '', tx = '', cls = '';
      if (r) { var st = STATUS[r.status]; ic = st[0]; tx = st[1]; if (r.noHw) tx += '·숙제無'; }
      else if (ds > T && ds >= k.startDate) {
        if (Core.hasMark(S, kd, ds, 'rest')) { ic = '🛌'; tx = '예약'; } else if (Core.hasMark(S, kd, ds, 'nohw')) { ic = '📖'; tx = '숙제無'; }
      } else cls = ' dim';
      if (ds === T) cls += ' today';
      h += '<button class="' + cls + '" data-act="dayOpen" data-d="' + ds + '"><span>' + d + '</span><span class="ic">' + ic + '</span><span class="t">' + tx + '</span></button>';
    }
    h += '</div><p class="sub">⭐ 성공 · ○ 실패 · 🛌 쉬는 날 · ⏳ 확인 대기 · 📖 숙제 없음</p>';
    if (ui.parent) {
      var cands = I.rows.filter(function (r) { return r.couldQualify; });
      if (cands.length) {
        h += '<h2>정정 후보</h2><div class="hint">기록은 목표를 채웠는데 제출되지 않은 날이에요. 실제로 했다면 정정할 수 있어요.</div><div class="card list">' +
          cands.map(function (r) { return '<div class="item row"><span>' + fmtDate(r.date) + ' · ' + num(r.count) + '개</span><button class="btn small sec" data-act="dayOpen" data-d="' + r.date + '">보기</button></div>'; }).join('') + '</div>';
      }
    }
    return h + '</main>';
  }

  // ----- S05 보상과 용돈 -----
  function rewView() {
    var kd = ui.rwKid || S.kids[0].id, k = kid(kd), m = Core.money(S, kd);
    var h = '<div class="top"><h1>보상과 용돈</h1></div><main>' + kidSeg('rwKid', kd);
    h += '<div class="card kidcard" ' + kidStyle(k) + '><div class="row"><span>지금까지 번 돈</span><b class="money">' + won(m.earned) + '</b></div><div class="row"><span>아직 받지 않은 돈</span><b class="money">' + won(m.payable) + '</b></div>';
    if (ui.parent) {
      h += '<div class="row"><span>지급 누계</span><b class="money">' + won(m.paid) + '</b></div>';
      if (m.adjust > 0) h += '<div class="row"><span>다음 지급 조정액</span><b class="money">' + won(m.adjust) + '</b></div><div class="hint">과거 정정으로 지급액이 더 커졌어요. 이후 번 돈에서 조정되며, 조정이 끝나기 전에는 지급할 수 없어요.</div>';
      h += '<button class="btn" data-act="payOpen" data-id="' + kd + '"' + (m.payable === 0 ? ' disabled' : '') + '>용돈 지급 기록</button>';
      if (m.payable === 0) h += '<p class="sub">지금 지급할 수 있는 금액은 0원이에요' + (m.adjust > 0 ? ' (조정액이 남아 있어요)' : '') + '</p>';
    }
    h += '</div><h2>날짜별 획득 내역</h2><div class="card list">';
    var byDate = {};
    S.rewards.forEach(function (r) { if (r.kid === kd) byDate[r.date] = (byDate[r.date] || 0) + r.amount; });
    var ds = Object.keys(byDate).filter(function (d) { return byDate[d] > 0; }).sort().reverse();
    h += ds.length ? ds.map(function (d) { return '<div class="item row"><span>' + fmtDate(d) + '</span><b class="money">+' + won(byDate[d]) + '</b></div>'; }).join('') : '<p class="sub">아직 없어요. 오늘부터 시작!</p>';
    h += '</div>';
    if (ui.parent) {
      var pays = S.payments.filter(function (p) { return p.kid === kd; }).slice().reverse();
      h += '<h2>지급·취소 내역</h2><div class="card list">' + (pays.length ? pays.map(function (p) {
        var cancelled = p.kind === 'pay' && Core.payCancelled(S, p.id);
        return '<div class="item"><div class="row"><span>' + (p.kind === 'pay' ? '💵 지급' : '↩️ 취소') + ' · ' + fmtDate(p.date) + '</span><b class="money">' + (p.kind === 'pay' ? '' : '-') + won(p.amount) + '</b></div>' +
          (p.memo ? '<div class="sub">' + esc(p.memo) + '</div>' : '') + (p.reason ? '<div class="sub">취소 이유: ' + esc(p.reason) + '</div>' : '') +
          (p.kind === 'pay' ? (cancelled ? '<span class="badge">취소됨</span>' : '<button class="btn small danger" data-act="cancelPayOpen" data-id="' + p.id + '">취소</button>') : '') + '</div>';
      }).join('') : '<p class="sub">지급 기록이 없어요</p>') + '</div>';
      var adj = S.rewards.filter(function (r) { return r.kid === kd && r.kind === 'adjust'; });
      if (adj.length) h += '<h2>정정 조정 내역</h2><div class="card list">' + adj.map(function (r) { return '<div class="item row"><span>' + fmtDate(r.date) + ' 정정</span><b class="money">' + won(r.amount) + '</b></div>'; }).join('') + '</div>';
    }
    return h + '</main>';
  }

  // ----- 부모 메뉴 -----
  function parentView() {
    if (!ui.parent) return '<div class="top"><h1>부모 메뉴</h1></div><main><div class="card center"><div class="big">🔒</div><p>보호자 인증이 필요해요</p><button class="btn" data-act="askParent">보호자 인증</button></div></main>';
    var pt = pendingTotal();
    var h = '<div class="top"><h1>부모 메뉴</h1></div><main><p class="sub">2분 동안 아무것도 하지 않으면 자동으로 잠겨요.</p>';
    if (daysSinceBackup() >= 30) h += '<div class="hint">마지막 백업 후 30일이 지났어요. 설정에서 백업해 주세요.</div>';
    h += '<button class="btn" data-act="go" data-v="approve">✅ 확인 대기 ' + (pt ? '(' + pt + '건)' : '') + '</button>' +
      '<button class="btn sec" data-act="go" data-v="rest">🛌 쉬는 날·숙제 없음 설정</button>' +
      '<button class="btn sec" data-act="go" data-v="rew">💰 용돈 지급 기록</button>' +
      '<button class="btn sec" data-act="go" data-v="cal">🛠 기록 정정 (달력에서 날짜 선택)</button>' +
      '<button class="btn sec" data-act="go" data-v="settings">⚙️ 설정·백업</button>' +
      '<button class="btn danger" data-act="lockNow">지금 잠그기</button></main>';
    return h;
  }
  function daysSinceBackup() {
    var b = S.family.lastBackup;
    return b ? Core.daysBetween(Core.kstDate(b), T) : Math.max(0, Core.daysBetween(S.kids[0].startDate, T));
  }

  // ----- S06 쉬는 날 설정 -----
  function restView() {
    var f = ui.restForm = ui.restForm || { kids: S.kids.map(function (k) { return k.id; }), kind: 'rest', reason: '여행' };
    var h = '<div class="top"><button class="btn sec small" data-act="go" data-v="parent">← 부모</button></div><main><h1>쉬는 날·숙제 없음</h1><div class="card"><label>누구에게 적용할까요</label><div class="chips">';
    S.kids.forEach(function (k) { h += '<button class="chip ' + (f.kids.indexOf(k.id) >= 0 ? 'on' : '') + '" data-act="restKid" data-id="' + k.id + '">' + esc(k.character) + ' ' + esc(k.name) + '</button>'; });
    h += '</div><label>종류</label><div class="seg"><button class="' + (f.kind === 'rest' ? 'on' : '') + '" data-act="restKind" data-v="rest">🛌 쉬는 날</button><button class="' + (f.kind === 'nohw' ? 'on' : '') + '" data-act="restKind" data-v="nohw">📖 숙제 없음</button></div>';
    h += '<label>시작 날짜</label><input type="date" id="rf" value="' + (f.from || T) + '"><label>끝 날짜 (하루면 같은 날짜)</label><input type="date" id="rt" value="' + (f.to || f.from || T) + '">';
    if (f.kind === 'rest') {
      h += '<label>사유</label><div class="chips">' + REST_REASONS.map(function (r) { return '<button class="chip ' + (f.reason === r ? 'on' : '') + '" data-act="restReason" data-v="' + r + '">' + r + '</button>'; }).join('') + '</div>';
      if (f.reason === '직접 입력') h += '<input type="text" id="rr" placeholder="사유" value="' + esc(f.custom || '') + '" style="margin-top:8px">';
      h += '<div class="hint info">연속 성공은 유지되고, 이날 보상은 없어요. 다음 도전 목표도 그대로예요.</div>';
    } else h += '<div class="hint info">그날은 숙제 조건을 채운 것으로 보고, 줄넘기 목표는 그대로 적용돼요.</div>';
    h += '<p class="sub">오늘·미래 날짜만 여기서 바꿀 수 있어요. 지난 날짜는 달력에서 정정해 주세요. 오늘 이미 제출한 기록이 있는 아이를 쉬는 날로 하면 제출이 무효가 되고 보상이 없어요.</p><button class="btn" data-act="restSave">저장</button></div>';
    var list = S.marks.filter(function (m) { return m.active && m.date >= Core.addDays(T, -14); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    h += '<h2>지정 목록</h2><div class="card list">' + (list.length ? list.map(function (m) {
      var k = kid(m.kid), past = m.date < T;
      return '<div class="item row"><span>' + esc(k.name) + ' · ' + fmtDate(m.date) + ' · ' + (m.kind === 'rest' ? '🛌 쉬는 날' : '📖 숙제 없음') + (m.reason ? ' (' + esc(m.reason) + ')' : '') + (m.date > T ? ' <span class="badge">예약</span>' : '') + '</span>' +
        (past ? '' : '<button class="btn small danger" data-act="markCancel" data-k="' + m.kid + '" data-d="' + m.date + '" data-kind="' + m.kind + '">취소</button>') + '</div>';
    }).join('') : '<p class="sub">지정한 날이 없어요</p>') + '</div></main>';
    return h;
  }

  // ----- S07 설정 -----
  function settingsView() {
    var f = S.family, h = '<div class="top"><button class="btn sec small" data-act="go" data-v="parent">← 부모</button></div><main><h1>설정</h1>';
    S.kids.forEach(function (k) {
      h += '<div class="card kidcard" ' + kidStyle(k) + '><h3>' + esc(k.character) + ' ' + esc(k.name) + ' 프로필</h3><label>별명</label><input type="text" id="pn_' + k.id + '" maxlength="10" value="' + esc(k.name) + '">' +
        '<label>캐릭터</label><div class="chips" id="pc_' + k.id + '">' + CH.map(function (c) { return '<button class="chip' + (c[0] === k.character ? ' on' : '') + '" data-act="pickChip" data-g="pc_' + k.id + '" data-v="' + c[0] + '">' + c[0] + '</button>'; }).join('') + '</div>' +
        '<label>강조 색</label><div class="chips" id="pk_' + k.id + '">' + COLORS.map(function (c) { return '<button class="chip' + (c === k.color ? ' on' : '') + '" data-act="pickChip" data-g="pk_' + k.id + '" data-v="' + c + '" style="background:' + c + '">　</button>'; }).join('') + '</div>' +
        '<button class="btn small" data-act="profileSave" data-id="' + k.id + '">프로필 저장</button><button class="btn small sec" data-act="startOpen" data-id="' + k.id + '">시작 날짜 ' + fmtDate(k.startDate) + ' 변경</button></div>';
    });
    h += '<div class="card"><h3>알림</h3><label class="chk"><input type="checkbox" id="nOn"' + (f.notify.on ? ' checked' : '') + '> 알림 사용</label><label>알림 시각</label><input type="time" id="nTime" value="' + esc(f.notify.time) + '">' +
      '<div class="hint info">웹앱은 앱이 열려 있을 때만 알림을 띄울 수 있어요. 알림을 못 봐도 날짜 판정과 보상 계산에는 영향이 없어요.</div>' +
      '<label>승인 대기 강조 기준(일)</label><input type="number" id="nAlert" min="1" value="' + f.alertDays + '"><label class="chk"><input type="checkbox" id="nSound"' + (f.sound ? ' checked' : '') + '> 소리와 움직임 효과</label><button class="btn small" data-act="prefSave">저장</button></div>';
    h += '<div class="card"><h3>보호자 인증</h3><p class="sub">앱 전용 PIN만 사용해요. 아이폰 기기 암호는 쓰지 않아요.</p><button class="btn small" data-act="pinChange">PIN 변경</button><button class="btn small sec" data-act="codeNew">복구 코드 다시 만들기</button></div>';
    h += '<div class="card"><h3>백업과 복원</h3><p class="sub">마지막 백업: ' + (f.lastBackup ? fmtTime(f.lastBackup) : '아직 없어요') + '</p><button class="btn small" data-act="backupOpen">백업 파일 만들기</button><button class="btn small sec" data-act="restoreOpen">백업에서 복원</button>' +
      (localStorage.getItem(PREV) ? '<button class="btn small danger" data-act="undoRestore">직전 복원 되돌리기</button>' : '') + '<input type="file" id="rfile" class="hide" accept=".hbk,.json,application/json"></div>';
    h += '<div class="card"><h3>규칙 안내</h3><p>성공 = 목표 이상 줄넘기 + 숙제 완료(또는 숙제 없음) + 부모 승인.</p><p>보상은 연속 성공일수 × 100원. 목표는 1,000개, 연속 21일째부터 하루 10개씩 늘어요.</p><p>실패하면 연속일수와 목표만 처음으로 돌아가고 번 돈은 그대로예요. 쉬는 날은 연속을 유지하지만 보상이 없어요.</p>' +
      '<p class="sub">아플 때나 여행 때는 쉬는 날을 적극 활용해 주세요. 긴 연속 기록이 한 번의 실패로 끊기면 의욕을 잃을 수 있어요.</p>' +
      '<p class="sub">아이에게 폰을 건넬 때는 아이폰의 ‘손쉬운 사용 → 사용법 유도’로 이 앱에 고정하는 것을 권해요. (Face ID 인증은 웹앱 방식에서는 쓰지 않고, PIN만 사용해요.)</p></div></main>';
    return h;
  }

  // ---------- 모달 ----------
  function openModal(m) { ui.modal = m; renderModal(); }
  function closeModal() { ui.modal = null; renderModal(); }
  function renderModal() {
    var el = $('modal'); if (!el) return;
    var m = ui.modal; if (!m) { el.innerHTML = ''; return; }
    var b = '';
    switch (m.type) {
      case 'pin':
        b = '<h2>보호자 인증</h2>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') + '<input type="password" inputmode="numeric" class="pin" id="pinIn" autocomplete="off" autofocus><button class="btn" data-act="pinOk">확인</button><button class="btn sec" data-act="modalClose">취소</button><button class="btn small sec" data-act="recoverOpen">PIN을 잊었어요</button>'; break;
      case 'recover':
        b = '<h2>복구 코드로 PIN 다시 정하기</h2>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') + '<label>복구 코드</label><input type="text" id="rcCode" autocapitalize="characters" autocomplete="off"><label>새 PIN (숫자 6자리 이상)</label><input type="password" inputmode="numeric" class="pin" id="rcP1"><label>새 PIN 한 번 더</label><input type="password" inputmode="numeric" class="pin" id="rcP2"><button class="btn" data-act="recoverOk">PIN 바꾸기</button><button class="btn sec" data-act="modalClose">취소</button><p class="sub">복구 코드도 없다면 백업 파일을 복원한 뒤 PIN을 다시 정할 수 있어요.</p>'; break;
      case 'pinNew':
        b = '<h2>새 PIN</h2>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') + '<label>새 PIN (숫자 6자리 이상)</label><input type="password" inputmode="numeric" class="pin" id="npA"><label>한 번 더</label><input type="password" inputmode="numeric" class="pin" id="npB"><button class="btn" data-act="pinNewOk">저장</button><button class="btn sec" data-act="modalClose">취소</button>'; break;
      case 'code':
        b = '<h2>새 복구 코드</h2><p>이전 코드는 더 이상 쓸 수 없어요. 적어서 보관하세요.</p><div class="mono">' + esc(m.code) + '</div><button class="btn" data-act="modalClose">적어 뒀어요</button>'; break;
      case 'celebrate':
        b = '<div class="celebrate"><div class="em">' + (m.ok ? '🎉' : 'ℹ️') + '</div><h2>' + esc(m.title) + '</h2><p>' + m.text + '</p></div><button class="btn" data-act="modalClose">좋아요</button>'; break;
      case 'reject':
        b = '<h2>반려 사유</h2><p class="sub">하나 이상 선택해 주세요</p>' + REJECT_REASONS.map(function (r, i) { return '<label class="chk"><input type="checkbox" class="rj" value="' + esc(r) + '"> ' + r + '</label>'; }).join('') + '<input type="text" id="rjNote" placeholder="메모 (직접 입력)"><button class="btn danger" data-act="rejectOk" data-id="' + m.id + '">반려하기</button><button class="btn sec" data-act="modalClose">취소</button>'; break;
      case 'pay': {
        var mm = Core.money(S, m.kid);
        b = '<h2>용돈 지급 기록</h2><p class="sub">실제로 전달한 돈을 기록하는 기능이에요. 이체는 되지 않아요.</p><div class="hint info">지금 지급할 수 있는 금액 ' + won(mm.payable) + '</div><label>금액(원)</label><input type="number" id="payAmt" inputmode="numeric" min="1" step="1" value="' + mm.payable + '"><label>지급 날짜</label><input type="date" id="payDate" value="' + T + '"><label>메모(선택)</label><input type="text" id="payMemo"><button class="btn" data-act="payOk" data-id="' + m.kid + '">지급 기록하기</button><button class="btn sec" data-act="modalClose">취소</button>'; break; }
      case 'cancelPay':
        b = '<h2>지급 취소</h2><p class="sub">원래 기록은 남기고 취소 기록을 추가해요. 한 번만 취소할 수 있어요.</p><label>취소 이유</label><input type="text" id="cpReason"><button class="btn danger" data-act="cancelPayOk" data-id="' + m.id + '">취소 기록 추가</button><button class="btn sec" data-act="modalClose">닫기</button>'; break;
      case 'day': b = dayModal(m); break;
      case 'corr': b = corrModal(m); break;
      case 'start': b = startModal(m); break;
      case 'password':
        b = '<h2>' + (m.mode === 'export' ? '백업 암호' : '백업 암호 입력') + '</h2>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') +
          (m.mode === 'export' ? '<div class="hint">이 암호를 잊으면 복원할 수 없어요. 파일 안에는 암호가 들어가지 않아요.</div>' : '') +
          '<input type="password" id="bkPw" autocomplete="off">' + (m.mode === 'export' ? '<label>한 번 더</label><input type="password" id="bkPw2" autocomplete="off">' : '') +
          '<button class="btn" data-act="' + (m.mode === 'export' ? 'exportGo' : 'restoreGo') + '">확인</button><button class="btn sec" data-act="modalClose">취소</button>'; break;
      case 'restorePreview': {
        var d = m.data, ks = d.kids.map(function (k) { var mo = Core.money(d, k.id); return '<tr><td>' + esc(k.name) + '</td><td>' + fmtDate(k.startDate) + '~</td><td>' + won(mo.earned) + '</td><td>' + won(mo.paid) + '</td></tr>'; }).join('');
        b = '<h2>복원 미리보기</h2><p>백업 날짜: ' + fmtTime(m.createdAt) + '</p><table><tr><th>자녀</th><th>기록 시작</th><th>번 돈</th><th>지급 누계</th></tr>' + ks + '</table><div class="hint">지금 기록은 백업 내용으로 완전히 바뀌어요. 복원 직전 기록은 자동으로 보관돼서 설정에서 되돌릴 수 있어요. 보호자 PIN은 지금 설정을 그대로 써요.</div><button class="btn danger" data-act="restoreApply">복원하기</button><button class="btn sec" data-act="modalClose">취소</button>'; break; }
    }
    $('modal').innerHTML = '<div class="modal" data-act="modalBg"><div>' + b + '</div></div>';
    var pin = $('pinIn'); if (pin) pin.focus();
  }

  function dayModal(m) {
    var k = kid(m.kid), I = info(m.kid), r = I.rows.filter(function (x) { return x.date === m.date; })[0];
    var h = '<h2>' + esc(k.name) + ' · ' + fmtDate(m.date) + '</h2>';
    if (!r) {
      var future = m.date > T;
      h += '<p class="sub">' + (future ? '예정된 날짜예요.' : '시작 날짜 전이에요.') + '</p>';
      if (future) {
        var rs = Core.hasMark(S, m.kid, m.date, 'rest'), nh = Core.hasMark(S, m.kid, m.date, 'nohw');
        h += '<p>' + (rs ? '🛌 쉬는 날 예약됨' : '') + (nh ? ' 📖 숙제 없음 예약됨' : '') + (!rs && !nh ? '예약된 계획이 없어요' : '') + '</p>';
        if (ui.parent) h += '<button class="btn small" data-act="quickMark" data-d="' + m.date + '" data-kind="rest" data-k="' + m.kid + '">🛌 쉬는 날 예약</button><button class="btn small sec" data-act="quickMark" data-d="' + m.date + '" data-kind="nohw" data-k="' + m.kid + '">📖 숙제 없음 예약</button>';
      }
      return h + '<button class="btn sec" data-act="modalClose">닫기</button>';
    }
    h += badge(r.status) + (r.noHw ? ' <span class="badge">📖 숙제 없음</span>' : '');
    if (r.status !== 'rest') h += '<div class="row"><span>그날 목표</span><b>' + num(r.target) + '개' + (r.estimated ? ' (예상)' : '') + '</b></div><div class="row"><span>실제 개수</span><b>' + num(r.count) + '개</b></div><div class="row"><span>숙제</span><b>' + (r.noHw ? '숙제 없음' : r.hw ? '완료' : '아직') + '</b></div>';
    if (r.at) h += '<div class="row"><span>제출 시각</span><b>' + fmtTime(r.at) + '</b></div>';
    if (r.approvedAt) h += '<div class="row"><span>승인 시각</span><b>' + fmtTime(r.approvedAt) + '</b></div>';
    if (r.anomaly) h += '<div class="hint bad">휴대폰 시각이 바뀐 흔적이 있는 제출이에요</div>';
    if (r.source === 'correction') h += '<div class="hint info">부모가 정정한 기록이에요</div>';
    if (r.status === 'success') h += '<div class="row"><span>확정 보상</span><b>' + (r.confirmed ? won(r.reward) : '확인 전 (예상 ' + won(r.expReward) + ')') + '</b></div>';
    if (r.status === 'pending') h += '<div class="row"><span>예상 보상</span><b>' + won(r.expReward || 0) + '</b></div>';
    S.subs.filter(function (s) { return s.kid === m.kid && s.date === m.date && s.status === 'rejected'; }).forEach(function (s) {
      h += '<div class="hint">반려됨 (' + fmtTime(s.rejectedAt) + '): ' + esc(s.reasons.join(', ')) + (s.rejectNote ? ' · ' + esc(s.rejectNote) : '') + '</div>';
    });
    S.marks.filter(function (x) { return x.kid === m.kid && x.date === m.date && x.active && x.reason; }).forEach(function (x) { h += '<p class="sub">' + (x.kind === 'rest' ? '쉬는 날 사유' : '숙제 없음 메모') + ': ' + esc(x.reason) + '</p>'; });
    var ad = S.audit.filter(function (a) { return a.kid === m.kid && a.date === m.date; });
    if (ad.length) h += '<h3>정정 이력</h3>' + ad.map(function (a) { return '<p class="sub">' + fmtTime(a.at) + ' · ' + esc(a.reason) + '</p>'; }).join('');
    if (r.couldQualify) h += '<div class="hint">기록이 목표를 채웠지만 제출되지 않았어요. 실제로 했다면 부모가 정정할 수 있어요.</div>';
    if (ui.parent) h += '<button class="btn" data-act="corrOpen" data-d="' + m.date + '">이 날짜 정정하기</button>';
    else h += '<button class="btn sec" data-act="corrOpen" data-d="' + m.date + '">🔒 부모: 정정하기</button>';
    return h + '<button class="btn sec" data-act="modalClose">닫기</button>';
  }

  var ST_TXT = { success: '성공', fail: '실패', rest: '쉬는 날', pending: '확인 대기', progress: '진행 중', ready: '제출 가능' };
  function rowTxt(r) {
    if (!r) return '—';
    var t = ST_TXT[r.status];
    if (r.status !== 'rest') t += ' · ' + num(r.target) + '개';
    var mo = r.reward != null ? r.reward : r.expReward;
    if (mo != null && r.status !== 'rest') t += ' · ' + (r.reward == null ? '예상 ' : '') + won(mo);
    return t;
  }
  function previewHtml(pv) {
    var h = '<table><tr><th>날짜</th><th>이전</th><th>이후</th></tr>' + pv.changes.slice(0, 40).map(function (c) {
      return '<tr><td>' + fmtDate(c.date) + '</td><td>' + esc(rowTxt(c.before)) + '</td><td><b>' + esc(rowTxt(c.after)) + '</b></td></tr>';
    }).join('') + '</table>' + (pv.changes.length > 40 ? '<p class="sub">외 ' + (pv.changes.length - 40) + '일</p>' : '') + (pv.changes.length ? '' : '<p class="sub">날짜별 결과는 바뀌지 않아요</p>');
    var a = pv.moneyBefore, b = pv.moneyAfter;
    h += '<div class="row"><span>번 돈</span><b>' + won(a.earned) + ' → ' + won(b.earned) + '</b></div><div class="row"><span>아직 받지 않은 돈</span><b>' + won(a.payable) + ' → ' + won(b.payable) + '</b></div>';
    if (a.adjust || b.adjust) h += '<div class="row"><span>다음 지급 조정액</span><b>' + won(a.adjust) + ' → ' + won(b.adjust) + '</b></div>';
    if (pv.pendingAfter.length) h += '<p class="sub">확인 대기 건의 승인 시 연속일수·보상은 위 표의 예상 값으로 다시 계산돼요.</p>';
    return h;
  }
  function corrParams(m) { return { kid: m.kid, date: m.date, mode: m.mode, count: m.count, hw: m.hw, noHw: m.noHw, reason: m.reason }; }
  function corrModal(m) {
    var k = kid(m.kid);
    var h = '<h2>과거 기록 정정</h2><p>' + esc(k.name) + ' · ' + fmtDate(m.date) + '</p>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') +
      '<label>이 날짜를</label><div class="seg"><button class="' + (m.mode === 'success' ? 'on' : '') + '" data-act="corrMode" data-v="success">성공으로 인정</button><button class="' + (m.mode === 'fail' ? 'on' : '') + '" data-act="corrMode" data-v="fail">실패</button><button class="' + (m.mode === 'rest' ? 'on' : '') + '" data-act="corrMode" data-v="rest">쉬는 날</button></div>';
    if (m.mode === 'success') h += '<label>실제 줄넘기 개수</label><input type="number" id="cCount" inputmode="numeric" min="0" step="1" value="' + esc(m.count) + '"><label class="chk"><input type="checkbox" id="cHw"' + (m.hw ? ' checked' : '') + '> 숙제 완료</label>';
    if (m.mode !== 'rest') h += '<label class="chk"><input type="checkbox" id="cNo"' + (m.noHw ? ' checked' : '') + '> 이 날은 숙제 없음</label>';
    h += '<label>수정 이유 (필수)</label><input type="text" id="cReason" value="' + esc(m.reason) + '" placeholder="예: 실제로 했는데 제출을 못 했음">' +
      '<button class="btn sec" data-act="corrPreview">영향 미리보기</button>';
    if (m.pv) h += '<div class="card">' + previewHtml(m.pv) + '</div><button class="btn danger" data-act="corrSave">확인하고 저장</button>';
    return h + '<button class="btn sec" data-act="modalClose">취소</button>';
  }
  function startModal(m) {
    var k = kid(m.kid);
    var h = '<h2>' + esc(k.name) + ' 시작 날짜 변경</h2>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') + '<label>새 시작 날짜</label><input type="date" id="sdNew" value="' + esc(m.date) + '"><label>변경 이유 (필수)</label><input type="text" id="sdReason" value="' + esc(m.reason || '') + '"><button class="btn sec" data-act="startPreview">영향 미리보기</button>';
    if (m.pv) h += '<div class="card">' + previewHtml(m.pv) + '</div><button class="btn danger" data-act="startSave">확인하고 저장</button>';
    return h + '<button class="btn sec" data-act="modalClose">취소</button>';
  }

  // ---------- 보호자 인증 ----------
  function newSalt() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function makeSecret(secret) { var salt = newSalt(); return { salt: salt, hash: Sha.stretch(secret, salt) }; }
  function checkSecret(o, secret) { return !!o && Sha.stretch(secret, o.salt) === o.hash; }
  function newCode() {
    var al = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', out = '', a = new Uint32Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < 12; i++) { out += al[a[i] % al.length]; if (i % 4 === 3 && i < 11) out += '-'; }
    return out;
  }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function validPin(p) { return /^\d{6,}$/.test(p); }
  function askPin(cb) { ui.pinCb = cb; openModal({ type: 'pin' }); }
  function pinOk() {
    var f = S.family, now = Date.now();
    if (f.lock.until > now) { openModal({ type: 'pin', err: Math.ceil((f.lock.until - now) / 1000) + '초 뒤에 다시 시도해 주세요' }); return; }
    var pin = val('pinIn');
    if (checkSecret(f.pin, pin)) {
      f.lock = { fails: 0, until: 0 }; persist(S);
      ui.parent = true; ui.parentAt = now; var cb = ui.pinCb; ui.pinCb = null; closeModal(); if (cb) cb(); else render();
    } else {
      f.lock.fails += 1;
      if (f.lock.fails >= 5) f.lock.until = now + Math.min(3600, 30 * Math.pow(2, f.lock.fails - 5)) * 1000;
      persist(S);
      openModal({ type: 'pin', err: f.lock.fails >= 5 ? '여러 번 틀려서 잠시 기다려야 해요' : 'PIN이 맞지 않아요 (' + f.lock.fails + '/5)' });
    }
  }

  // ---------- 백업 ----------
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function subtle() { if (!window.crypto || !window.crypto.subtle) throw new Error('이 주소에서는 암호화를 쓸 수 없어요. https 주소나 localhost로 열어 주세요'); return window.crypto.subtle; }
  async function deriveKey(pw, salt) {
    var enc = new TextEncoder(), km = await subtle().importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function exportBackup(pw) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var copy = Core.clone(S); copy.family.pin = null; copy.family.recovery = null; copy.family.lock = { fails: 0, until: 0 };
    var key = await deriveKey(pw, salt);
    var ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(copy)));
    var env = { app: 'habit', v: 1, createdAt: Date.now(), salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) };
    var name = 'habit-backup-' + Core.kstDate(Date.now()) + '.hbk';
    var blob = new Blob([JSON.stringify(env)], { type: 'application/json' });
    var file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '줄넘기 숙제 백업' }); } catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
    } else {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    return true;
  }
  async function decryptBackup(text, pw) {
    var env; try { env = JSON.parse(text); } catch (e) { throw new Error('백업 파일이 아니에요'); }
    if (!env || env.app !== 'habit' || env.v !== 1 || !env.data) throw new Error('지원하지 않는 백업 파일이에요');
    var key = await deriveKey(pw, unb64(env.salt)), pt;
    try { pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)); } catch (e) { throw new Error('암호가 맞지 않거나 파일이 손상되었어요'); }
    var d; try { d = JSON.parse(new TextDecoder().decode(pt)); } catch (e) { throw new Error('백업 내용을 읽을 수 없어요'); }
    var okShape = d && d.v === 1 && Array.isArray(d.kids) && d.kids.length && ['subs', 'marks', 'rewards', 'payments', 'audit'].every(function (k) { return Array.isArray(d[k]); }) && d.days && d.family;
    if (!okShape) throw new Error('백업 내용이 올바르지 않아요');
    if (!Core.verify(d, Date.now())) throw new Error('백업의 보상 합계가 기록과 맞지 않아요. 복원을 중단했어요');
    return { data: d, createdAt: env.createdAt };
  }

  // ---------- 알림 (앱이 열려 있을 때) ----------
  function notifyCheck() {
    if (!S || !S.family.notify.on || !window.Notification || Notification.permission !== 'granted') return;
    var kst = new Date(Date.now() + 9 * 3600000), hm = pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes()), flag = 'habitApp.notified';
    if (hm < S.family.notify.time || localStorage.getItem(flag) === T) return;
    var todo = S.kids.filter(function (k) { var t = info(k.id).today; return t && (t.status === 'progress' || t.status === 'ready'); });
    var lateWait = S.kids.some(function (k) { return oldestPendingAge(k.id) >= S.family.alertDays; });
    if (!todo.length && !lateWait) return;
    localStorage.setItem(flag, T);
    var msg = todo.length ? todo.map(function (k) { return k.name; }).join('·') + ' 오늘 할 일이 남았어요' : '오래된 확인 대기가 있어요';
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(function (r) { r.showNotification('줄넘기 숙제', { body: msg }); });
    else new Notification('줄넘기 숙제', { body: msg });
  }

  // ---------- 동작 처리 ----------
  function selChip(g) { var on = document.querySelector('#' + g + ' .on'); return on ? on.getAttribute('data-v') : null; }
  function readCount() { var v = val('cnt'); if (v === '') throw new Error('개수를 입력해 주세요'); return Number(v); }
  function saveDraft(patch) {
    var I = info(ui.kid), t = I.today;
    if (t.status === 'pending' && !confirm('바꾸면 아빠에게 다시 확인받아야 해요. 바꿀까요?')) { render(); return; }
    if (patch.count !== undefined && patch.count > S.family.bigCount && !confirm('정말 ' + num(patch.count) + '개나 했나요?')) { render(); return; }
    var r = run(function (c, now) { return Core.setDraft(c, ui.kid, now, patch); });
    if (r.ok && r.r.withdrawn) toast('제출이 취소됐어요. 다시 확인받아야 해요');
    render();
  }
  function corrRead() {
    var m = ui.modal;
    if ($('cReason')) m.reason = val('cReason');
    if ($('cCount')) m.count = val('cCount');
    if ($('cHw')) m.hw = $('cHw').checked;
    if ($('cNo')) m.noHw = $('cNo').checked;
  }

  var H = {
    go: function (d) { go(d.v); },
    askParent: function () { askPin(function () { render(); }); },
    lockNow: function () { lockParent(); render(); },
    modalClose: function () { ui.pinCb = null; closeModal(); },
    modalBg: function (d, el, e) { if (e.target === el) { ui.pinCb = null; closeModal(); } },
    openKid: function (d) { ui.kid = d.id; go('record'); },
    pickChip: function (d, el) { document.querySelectorAll('#' + d.g + ' .chip').forEach(function (c) { c.classList.remove('on'); }); el.classList.add('on'); },
    addCount: function (d) { var cur = val('cnt') === '' ? info(ui.kid).today.count : Number(val('cnt')); $('cnt').value = cur + Number(d.n); saveDraft({ count: cur + Number(d.n) }); },
    saveCount: function () { var n; try { n = readCount(); } catch (e) { toast(e.message); return; } saveDraft({ count: n }); },
    toggleHw: function () { saveDraft({ hw: !info(ui.kid).today.hw }); },
    submitToday: function () {
      var n = Number(val('cnt')); var t = info(ui.kid).today;
      if (val('cnt') !== '' && n !== t.count) { toast('먼저 저장 버튼을 눌러 개수를 저장해 주세요'); return; }
      var r = run(function (c, now) { return Core.submit(c, ui.kid, now); });
      if (r.ok) toast('아빠에게 보냈어요'); render();
    },
    // 설정 마법사
    setupDone: function () {
      var p1 = val('sp1'), p2 = val('sp2'), now = Date.now();
      if (!validPin(p1)) { toast('PIN은 숫자 6자리 이상이에요'); return; }
      if (p1 !== p2) { toast('PIN이 서로 달라요'); return; }
      var s = Core.newState();
      [0, 1].forEach(function (i) {
        var nm = val('sn' + i).trim(); if (!nm) nm = i ? '둘째' : '첫째';
        s.kids.push({ id: 'kid' + (i + 1), name: nm, character: selChip('sc' + i) || CH[i][0], color: selChip('sk' + i) || COLORS[i], startDate: Core.kstDate(now) });
      });
      var code = newCode();
      s.family.pin = makeSecret(p1); s.family.recovery = makeSecret(normCode(code));
      Core.tick(s, now);
      try { s.kids.forEach(function (k, i) { Core.seedHistory(s, k.id, Number(val('ss' + i)), now); }); } catch (e) { toast(e.message); return; }
      try { persist(s); } catch (e) { toast('저장할 수 없어요. 브라우저 저장 공간을 확인해 주세요'); return; }
      S = s; ui.setupCode = code; render();
    },
    setupFinish: function () { if (!$('codeOk').checked) { toast('복구 코드를 적어 두었는지 체크해 주세요'); return; } ui.setupCode = null; ui.view = 'home'; render(); },
    // 인증
    pinOk: pinOk,
    recoverOpen: function () { openModal({ type: 'recover' }); },
    recoverOk: function () {
      var f = S.family, p1 = val('rcP1'), p2 = val('rcP2');
      if (!checkSecret(f.recovery, normCode(val('rcCode')))) { openModal({ type: 'recover', err: '복구 코드가 맞지 않아요' }); return; }
      if (!validPin(p1) || p1 !== p2) { openModal({ type: 'recover', err: 'PIN은 같은 숫자 6자리 이상을 두 번 입력해 주세요' }); return; }
      f.pin = makeSecret(p1); f.lock = { fails: 0, until: 0 }; persist(S); toast('PIN을 다시 정했어요'); askPin(ui.pinCb);
    },
    pinChange: function () { openModal({ type: 'pinNew' }); },
    pinNewOk: function () {
      var a = val('npA'), b = val('npB');
      if (!validPin(a) || a !== b) { openModal({ type: 'pinNew', err: 'PIN은 같은 숫자 6자리 이상을 두 번 입력해 주세요' }); return; }
      run(function (c) { c.family.pin = makeSecret(a); }); closeModal(); toast('PIN을 바꿨어요');
    },
    codeNew: function () { var code = newCode(); if (run(function (c) { c.family.recovery = makeSecret(normCode(code)); }).ok) openModal({ type: 'code', code: code }); },
    // 승인
    approve: function (d) {
      var key = 'ap' + d.id, sub = S.subs.filter(function (x) { return x.id === d.id; })[0];
      var r = run(function (c, now) { return Core.approve(c, d.id, rid(key), now); });
      if (!r.ok) return;
      done(key); cache = {}; T = Core.viewToday(S, Date.now());
      var row = Core.computeKid(S, sub.kid, T).rows.filter(function (x) { return x.date === sub.date; })[0], k = kid(sub.kid);
      if (row && row.status === 'success') { beep(); openModal({ type: 'celebrate', ok: true, title: '오늘도 해냈어', text: esc(k.name) + ' 연속 ' + row.streakE + '일 성공 · +' + won(row.reward) }); }
      else openModal({ type: 'celebrate', ok: false, title: '승인했지만 성공으로 세지 않았어요', text: '지금 계산의 목표에 못 미쳐요. 달력에서 확인해 주세요.' });
      render();
    },
    rejectOpen: function (d) { openModal({ type: 'reject', id: d.id }); },
    rejectOk: function (d) {
      var rs = Array.prototype.map.call(document.querySelectorAll('.rj:checked'), function (e) { return e.value; }), note = val('rjNote'), key = 'rj' + d.id;
      var r = run(function (c, now) { return Core.reject(c, d.id, rs, note, rid(key), now); });
      if (r.ok) { done(key); closeModal(); toast('반려했어요'); render(); }
    },
    // 달력
    calKid: function (d) { ui.calKid = d.id; render(); },
    calMove: function (d) {
      var ym = ui.calMonth || T.slice(0, 7), y = +ym.slice(0, 4), m = +ym.slice(5, 7) + Number(d.n);
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      ui.calMonth = y + '-' + pad(m); render();
    },
    dayOpen: function (d) { openModal({ type: 'day', kid: ui.calKid || S.kids[0].id, date: d.d }); },
    quickMark: function (d) {
      var r = run(function (c, now) { return Core.setMark(c, d.k, d.d, d.kind, '', now); });
      if (r.ok) { toast('예약했어요'); render(); openModal({ type: 'day', kid: d.k, date: d.d }); }
    },
    corrOpen: function (d) {
      var kd = ui.modal.kid, date = d.d;
      var open = function () {
        var r = info(kd).rows.filter(function (x) { return x.date === date; })[0];
        openModal({ type: 'corr', kid: kd, date: date, mode: r.status === 'rest' ? 'rest' : 'success', count: r.count, hw: r.hw && !r.noHw, noHw: r.noHw, reason: '', pv: null });
      };
      if (!ui.parent) askPin(open); else open();
    },
    corrMode: function (d) { corrRead(); ui.modal.mode = d.v; ui.modal.pv = null; renderModal(); },
    corrPreview: function () {
      corrRead(); var m = ui.modal, now = Date.now(); m.err = '';
      try { m.pv = Core.preview(S, m.kid, now, function (c) { Core.applyCorrection(c, corrParams(m), now); }); } catch (e) { m.pv = null; m.err = e.message; }
      renderModal();
    },
    corrSave: function () {
      corrRead(); var m = ui.modal, key = 'co' + m.kid + m.date;
      var r = run(function (c, now) { return Core.applyCorrection(c, corrParams(m), now); });
      if (r.ok) { done(key); closeModal(); toast('정정했어요'); render(); }
    },
    // 용돈
    rwKid: function (d) { ui.rwKid = d.id; render(); },
    payOpen: function (d) { openModal({ type: 'pay', kid: d.id }); },
    payOk: function (d) {
      var amt = Number(val('payAmt')), key = 'pay' + d.id;
      var r = run(function (c, now) { return Core.pay(c, d.id, amt, val('payDate'), val('payMemo'), rid(key), now); });
      if (r.ok) { done(key); closeModal(); toast('지급을 기록했어요'); render(); }
    },
    cancelPayOpen: function (d) { openModal({ type: 'cancelPay', id: d.id }); },
    cancelPayOk: function (d) {
      var key = 'cp' + d.id;
      var r = run(function (c, now) { return Core.cancelPay(c, d.id, val('cpReason'), rid(key), now); });
      if (r.ok) { done(key); closeModal(); toast('취소 기록을 추가했어요'); render(); }
    },
    // 쉬는 날
    restKid: function (d) {
      var f = ui.restForm, i = f.kids.indexOf(d.id); restRead(); if (i >= 0) f.kids.splice(i, 1); else f.kids.push(d.id); render();
    },
    restKind: function (d) { restRead(); ui.restForm.kind = d.v; render(); },
    restReason: function (d) { restRead(); ui.restForm.reason = d.v; render(); },
    restSave: function () {
      restRead(); var f = ui.restForm, from = f.from, to = f.to || f.from;
      if (!f.kids.length) { toast('아이를 선택해 주세요'); return; }
      if (!from || to < from) { toast('날짜를 확인해 주세요'); return; }
      if (Core.daysBetween(from, to) > 60) { toast('한 번에 60일까지 지정할 수 있어요'); return; }
      var reason = f.kind === 'rest' ? (f.reason === '직접 입력' ? (f.custom || '') : f.reason) : '';
      if (f.kind === 'rest' && f.reason === '직접 입력' && !reason.trim()) { toast('사유를 입력해 주세요'); return; }
      var todayRest = f.kind === 'rest' && from <= T && to >= T && f.kids.some(function (id) { var t = info(id).today; return t && t.status === 'pending'; });
      if (todayRest && !confirm('오늘 제출한 기록이 무효가 되고 오늘 보상은 없어요. 계속할까요?')) return;
      var r = run(function (c, now) { for (var d = from; d <= to; d = Core.addDays(d, 1)) f.kids.forEach(function (id) { Core.setMark(c, id, d, f.kind, reason, now); }); });
      if (r.ok) { toast('저장했어요'); ui.restForm = null; render(); }
    },
    markCancel: function (d) { var r = run(function (c, now) { return Core.cancelMark(c, d.k, d.d, d.kind, now); }); if (r.ok) { toast('취소했어요'); render(); } },
    // 설정
    profileSave: function (d) {
      var nm = val('pn_' + d.id).trim(); if (!nm) { toast('별명을 입력해 주세요'); return; }
      var ch = selChip('pc_' + d.id), co = selChip('pk_' + d.id);
      run(function (c) { var k = c.kids.filter(function (x) { return x.id === d.id; })[0]; k.name = nm; if (ch) k.character = ch; if (co) k.color = co; }); toast('저장했어요'); render();
    },
    startOpen: function (d) { openModal({ type: 'start', kid: d.id, date: kid(d.id).startDate, reason: '', pv: null }); },
    startPreview: function () {
      var m = ui.modal; m.date = val('sdNew'); m.reason = val('sdReason'); m.err = ''; var now = Date.now();
      try { if (!m.date) throw new Error('날짜를 골라 주세요'); m.pv = Core.preview(S, m.kid, now, function (c) { Core.applyStartDate(c, m.kid, m.date, m.reason, now); }); } catch (e) { m.pv = null; m.err = e.message; }
      renderModal();
    },
    startSave: function () {
      var m = ui.modal; m.date = val('sdNew'); m.reason = val('sdReason');
      var r = run(function (c, now) { return Core.applyStartDate(c, m.kid, m.date, m.reason, now); });
      if (r.ok) { closeModal(); toast('시작 날짜를 바꿨어요'); render(); }
    },
    prefSave: function () {
      var on = $('nOn').checked, tm = val('nTime') || '19:00', al = Math.max(1, Math.floor(Number(val('nAlert')) || 3)), sd = $('nSound').checked;
      if (on && window.Notification && Notification.permission === 'default') Notification.requestPermission();
      run(function (c) { c.family.notify = { on: on, time: tm }; c.family.alertDays = al; c.family.sound = sd; }); toast('저장했어요'); render();
    },
    backupOpen: function () { openModal({ type: 'password', mode: 'export' }); },
    exportGo: async function () {
      var a = val('bkPw'), b = val('bkPw2');
      if (a.length < 4) { openModal({ type: 'password', mode: 'export', err: '암호는 4자 이상이에요' }); return; }
      if (a !== b) { openModal({ type: 'password', mode: 'export', err: '암호가 서로 달라요' }); return; }
      try { var ok = await exportBackup(a); if (ok) { run(function (c, now) { c.family.lastBackup = now; }); closeModal(); toast('백업 파일을 만들었어요. 기기 밖에도 보관해 주세요'); render(); } }
      catch (e) { openModal({ type: 'password', mode: 'export', err: e.message }); }
    },
    restoreOpen: function () { var f = $('rfile'); f.value = ''; f.onchange = function () { var file = f.files[0]; if (!file) return; var rd = new FileReader(); rd.onload = function () { ui.restoreText = String(rd.result); openModal({ type: 'password', mode: 'restore' }); }; rd.readAsText(file); }; f.click(); },
    restoreGo: async function () {
      try { var r = await decryptBackup(ui.restoreText, val('bkPw')); ui.restoreData = r.data; openModal({ type: 'restorePreview', data: r.data, createdAt: r.createdAt }); }
      catch (e) { openModal({ type: 'password', mode: 'restore', err: e.message }); }
    },
    restoreApply: function () {
      var d = ui.restoreData; if (!d) return;
      try {
        localStorage.setItem(PREV, JSON.stringify(S));
        var keep = S.family; d.family.pin = keep.pin; d.family.recovery = keep.recovery; d.family.lock = keep.lock;
        d.audit.push({ id: Core.uid(d, 'a'), at: Date.now(), kid: null, date: T, type: 'restore', reason: '백업 복원', before: null, after: null });
        d.family.maxSeen = Math.max(d.family.maxSeen || 0, S.family.maxSeen || 0);
        persist(d); S = d; ui.restoreData = null; ui.restoreText = null; tickNow(); closeModal(); toast('복원했어요'); render();
      } catch (e) { toast('복원하지 못했어요. 현재 기록은 그대로예요'); }
    },
    undoRestore: function () {
      if (!confirm('직전 복원 이전 기록으로 되돌릴까요?')) return;
      try { var p = JSON.parse(localStorage.getItem(PREV)); p.family.pin = S.family.pin; p.family.recovery = S.family.recovery; persist(p); S = p; localStorage.removeItem(PREV); toast('되돌렸어요'); render(); } catch (e) { toast('되돌리지 못했어요'); }
    }
  };
  function restRead() {
    var f = ui.restForm; if (!f) return;
    if ($('rf')) f.from = val('rf'); if ($('rt')) f.to = val('rt'); if ($('rr')) f.custom = val('rr');
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null; if (!el) return;
    ui.parentAt = Date.now();
    var fn = H[el.getAttribute('data-act')]; if (!fn) return;
    var d = {}; for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (a.name.indexOf('data-') === 0) d[a.name.slice(5)] = a.value; }
    fn(d, el, e);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && ui.modal && ui.modal.type === 'pin') pinOk();
    ui.parentAt = Date.now();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (ui.parent) { lockParent(); } }
    else { tickNow(); if (!ui.modal || ui.modal.type === 'pin') render(); }
  });
  setInterval(function () {
    if (!S) return;
    var prevT = T;
    tickNow();
    if (ui.parent && Date.now() - ui.parentAt > 120000) { lockParent(); render(); return; }
    if (Core.viewToday(S, Date.now()) !== prevT && !ui.modal) render();
    notifyCheck();
  }, 15000);

  function start() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () { });
    tickNow(); render();
  }
  start();
})();
