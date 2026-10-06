/* 화면 계층 (부모 전용). 모든 계산과 상태 변경은 core.js를 통해서만 한다. */
(function () {
  'use strict';
  var KEY = 'habitApp.v1', PREV = 'habitApp.prev';
  var CH = [['🐰', '토끼'], ['🐻', '곰'], ['🐱', '고양이'], ['🐶', '강아지'], ['🐼', '판다'], ['🦊', '여우']];
  var COLORS = ['#ffc2c2', '#ffe0a3', '#c9f0c0', '#bfe3ff', '#dccbff', '#ffd0ec'];
  var REST_REASONS = ['여행', '몸이 아픔', '가족 일정', '직접 입력'];
  var STATUS = {
    success: ['⭐', '성공', 'ok'], partial: ['🌗', '반액', 'wait'], fail: ['○', '실패', ''], rest: ['🛌', '쉬는 날', 'rest'],
    pending: ['⏳', '대기', 'wait'], progress: ['📝', '기록 전', ''], ready: ['📝', '기록 전', '']
  };

  var S = load();
  var ui = { view: 'home', day: 'today', form: {}, editing: {}, calKid: null, calMonth: null, rwKid: null, modal: null, req: {}, setup: null, restForm: null };
  var T = '', cache = {};

  // ---------- 저장 ----------
  function load() { try { var r = localStorage.getItem(KEY); return r ? migrate(JSON.parse(r)) : null; } catch (e) { return null; } }
  function migrate(s) { // 이전 버전(아이 제출·PIN) 데이터에서 쓰지 않는 값 정리
    if (!s || !s.family) return s;
    ['pin', 'recovery', 'lock', 'notify', 'maxSeen', 'alertDays', 'sound'].forEach(function (k) { delete s.family[k]; });
    return s;
  }
  function persist(c) { localStorage.setItem(KEY, JSON.stringify(c)); }
  function run(fn) {
    var c = Core.clone(S);
    try { var r = fn(c, Date.now()); persist(c); S = c; return { ok: true, r: r }; }
    catch (e) { toast(e && e.message ? e.message : '저장하지 못했어요'); return { ok: false }; }
  }
  function tickNow() { if (!S) return; try { Core.tick(S, Date.now()); persist(S); } catch (e) { /* 다음 동작에서 알림 */ } }

  // ---------- 유틸 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(n) { return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ko-KR') + '원'; }
  function num(n) { return Number(n).toLocaleString('ko-KR'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { var p = d.split('-').map(Number); return p[1] + '월 ' + p[2] + '일 (' + '일월화수목금토'[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ')'; }
  function fmtShort(d) { var p = d.split('-').map(Number); return p[1] + '/' + p[2]; }
  function fmtTime(ms) { var t = new Date(ms + 9 * 3600000); return (t.getUTCMonth() + 1) + '월 ' + t.getUTCDate() + '일 ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()); }
  function kid(id) { return S.kids.filter(function (k) { return k.id === id; })[0]; }
  function info(id) { return cache[id] || (cache[id] = Core.computeKid(S, id, T)); }
  function rowOf(id, date) { return info(id).rows.filter(function (r) { return r.date === date; })[0]; }
  function rid(key) { return ui.req[key] || (ui.req[key] = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
  function done(key) { delete ui.req[key]; }
  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? e.value : ''; }
  function toast(m) {
    var el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = m; document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
  }
  function kidStyle(k) { return 'style="--kc:' + esc(k.color) + '"'; }
  function badge(st) { var s = STATUS[st]; return '<span class="badge ' + s[2] + '">' + s[0] + ' ' + s[1] + '</span>'; }
  function kidSeg(act, cur) {
    return '<div class="seg">' + S.kids.map(function (k) {
      return '<button class="' + (k.id === cur ? 'on' : '') + '" data-act="' + act + '" data-id="' + k.id + '">' + esc(k.character) + ' ' + esc(k.name) + '</button>';
    }).join('') + '</div>';
  }
  function curKid(key) { var id = ui[key]; return id && kid(id) ? id : S.kids[0].id; }
  function recorded(r) { return !!r && (!!r.subId || r.status === 'rest'); }
  function selDate() { return ui.day === 'yesterday' ? Core.addDays(T, -1) : T; }
  function resultText(r) {
    if (!r) return '';
    if (r.status === 'success') return '⭐ 성공 · +' + won(r.reward) + ' · 연속 ' + r.streakE + '일';
    if (r.status === 'partial') return '🌗 반액 · +' + won(r.reward) + ' · 연속 ' + r.streakE + '일 유지';
    if (r.status === 'rest') return '🛌 쉬는 날 · 연속 ' + r.streakE + '일 유지';
    if (r.status === 'fail') return '○ 실패 · 연속 0일';
    if (r.status === 'pending') return '⏳ 이전 버전에서 제출된 기록 · 수정을 눌러 확정해 주세요';
    return '';
  }

  // ---------- 렌더 ----------
  function render() {
    var app = $('app');
    if (!app.firstChild) app.innerHTML = '<div id="view"></div><div id="modal"></div>';
    if (!S) { $('view').innerHTML = setupView(); renderModal(); return; }
    cache = {}; T = Core.viewToday(S, Date.now());
    var body = { cal: calView, rew: rewView, settings: settingsView, rest: restView }[ui.view] || homeView;
    var tab = ui.view === 'rest' ? 'settings' : ui.view;
    function tb(id, ic, t) { var on = tab === id; return '<button class="' + (on ? 'on' : '') + '"' + (on ? ' aria-current="page"' : '') + ' data-act="go" data-v="' + id + '"><span aria-hidden="true">' + ic + '</span>' + t + '</button>'; }
    $('view').innerHTML = body() + '<nav class="tabs"><div>' + tb('home', '📝', '오늘') + tb('cal', '📅', '달력') + tb('rew', '💰', '용돈') + tb('settings', '⚙️', '설정') + '</div></nav>';
    renderModal();
  }
  function go(view) { ui.view = view; render(); window.scrollTo(0, 0); }

  // ----- 첫 설정 -----
  function setupView() {
    var st = ui.setup = ui.setup || { kids: [{ name: '', ch: CH[0][0], color: COLORS[0], streak: '' }, { name: '', ch: CH[1][0], color: COLORS[1], streak: '' }] };
    var h = '<main><h1>처음 설정</h1><p class="sub">아이마다 별명과 캐릭터를 정해 주세요. 이미 진행 중이었다면 어제까지의 연속 성공일수를 넣으면 그만큼의 기록과 보상이 함께 만들어져요.</p>';
    st.kids.forEach(function (k, i) {
      h += '<div class="card"><div class="row"><h3>아이 ' + (i + 1) + '</h3>' + (st.kids.length > 1 ? '<button class="btn small danger" data-act="setupDel" data-i="' + i + '">삭제</button>' : '') + '</div>' +
        '<label for="sn' + i + '">별명</label><input type="text" id="sn' + i + '" maxlength="10" value="' + esc(k.name) + '" placeholder="예: 첫째">' +
        '<label>캐릭터</label><div class="chips">' + CH.map(function (c) { return '<button type="button" class="chip' + (c[0] === k.ch ? ' on' : '') + '" data-act="setupPick" data-i="' + i + '" data-f="ch" data-v="' + c[0] + '" aria-label="' + c[1] + '">' + c[0] + '</button>'; }).join('') + '</div>' +
        '<label>강조 색</label><div class="chips">' + COLORS.map(function (c) { return '<button type="button" class="chip' + (c === k.color ? ' on' : '') + '" data-act="setupPick" data-i="' + i + '" data-f="color" data-v="' + c + '" style="background:' + c + '" aria-label="색">　</button>'; }).join('') + '</div>' +
        '<label for="ss' + i + '">어제까지 연속 성공일수 (처음이면 비워 두세요)</label><input type="number" id="ss' + i + '" inputmode="numeric" min="0" step="1" value="' + esc(k.streak) + '" placeholder="0"></div>';
    });
    return h + '<button class="btn sec" data-act="setupAdd">+ 아이 추가</button><button class="btn" data-act="setupDone">시작하기</button></main>';
  }
  function setupRead() {
    ui.setup.kids.forEach(function (k, i) { if ($('sn' + i)) { k.name = val('sn' + i); k.streak = val('ss' + i); } });
  }

  // ----- 오늘 (홈) -----
  function homeView() {
    var D = selDate(), Y = Core.addDays(T, -1);
    var h = '<div class="top"><div><h1>오늘 기록</h1><div class="date">' + fmtDate(D) + '</div></div></div><main>' +
      '<div class="seg"><button class="' + (ui.day === 'today' ? 'on' : '') + '" data-act="day" data-v="today">오늘 ' + fmtShort(T) + '</button><button class="' + (ui.day === 'yesterday' ? 'on' : '') + '" data-act="day" data-v="yesterday">어제 ' + fmtShort(Y) + '</button></div>';
    S.kids.forEach(function (k) { h += kidCard(k, D); });
    return h + '<p class="sub center">더 지난 날짜는 달력에서 고칠 수 있어요</p></main>';
  }
  function formKey(id, D) { return id + '|' + D; }
  function formOf(k, D, r) {
    var key = formKey(k.id, D);
    if (!ui.form[key]) ui.form[key] = { count: r && r.subId ? String(r.count) : '', hw: !!(r && r.subId && r.hw && !r.noHw) };
    return ui.form[key];
  }
  function kidCard(k, D) {
    var I = info(k.id), m = Core.money(S, k.id), r = rowOf(k.id, D), key = formKey(k.id, D);
    var h = '<section class="card kidcard" ' + kidStyle(k) + ' aria-label="' + esc(k.name) + '"><div class="kidhead"><div class="avatar" aria-hidden="true">' + esc(k.character) + '</div><div class="grow"><div class="name">' + esc(k.name) + '</div>' +
      '<div class="sub">연속 ' + I.expectedStreak + '일 · 누적 적립 ' + won(m.earned) + ' · 미지급 ' + won(m.payable) + '</div></div>' +
      '<button class="btn small sec" data-act="show" data-id="' + k.id + '" aria-label="' + esc(k.name) + '에게 보여주기">👀</button></div>';
    if (!r) return h + '<p class="sub">' + fmtDate(k.startDate) + '부터 시작해요</p></section>';
    if (recorded(r) && !ui.editing[key]) {
      h += '<div class="result">' + esc(resultText(r)) + '</div>';
      if (r.status !== 'rest') h += '<p class="sub">줄넘기 ' + num(r.count) + ' / ' + num(r.target) + '개 · 숙제 ' + (r.noHw ? '없는 날' : r.hw ? '완료' : '안 함') + '</p>';
      return h + '<button class="btn small sec" data-act="edit" data-id="' + k.id + '">수정</button></section>';
    }
    var f = formOf(k, D, r), n = r.n, target = r.target;
    h += '<p class="goal">목표 <b>' + num(target) + '개</b> · 성공 시 <b>' + won(Core.rewardFor(n)) + '</b> <span class="sub">(하나만 하면 ' + won(Core.halfReward(n)) + ')</span></p>';
    if (r.status === 'rest') h += '<div class="hint info">쉬는 날로 기록돼 있어요. 저장하면 활동일로 바뀌어요.</div>';
    else if (r.closed && !r.subId) h += '<div class="hint">기록이 없어서 지금은 실패로 계산돼요</div>';
    h += '<div class="inrow"><label for="c_' + key + '">줄넘기</label><input type="number" id="c_' + key + '" data-form="' + key + '" inputmode="numeric" min="0" step="1" value="' + esc(f.count) + '" placeholder="0">' +
      '<span>개</span></div><div class="quick"><button class="btn small sec" data-act="addCount" data-k="' + key + '" data-n="100">+100</button><button class="btn small sec" data-act="addCount" data-k="' + key + '" data-n="500">+500</button><button class="btn small sec" data-act="setCount" data-k="' + key + '" data-n="' + target + '">목표만큼</button></div>';
    if (r.noHw) h += '<p>📖 숙제 없는 날</p>';
    else h += '<button class="btn small hwbtn ' + (f.hw ? 'ok' : 'sec') + '" data-act="toggleHw" data-k="' + key + '" aria-pressed="' + f.hw + '">숙제 ' + (f.hw ? '완료 ✓' : '안 함') + '</button>';
    h += '<button class="btn" data-act="save" data-id="' + k.id + '">기록 저장</button><div class="links">' +
      '<button class="link" data-act="restDay" data-id="' + k.id + '">쉬는 날로 기록</button>' + (ui.editing[key] ? '<button class="link" data-act="editCancel" data-id="' + k.id + '">취소</button>' : '') + '</div>';
    return h + '</section>';
  }

  // ----- 달력 -----
  function calView() {
    var kd = curKid('calKid'), k = kid(kd), I = info(kd);
    var ym = ui.calMonth || T.slice(0, 7), y = +ym.slice(0, 4), mo = +ym.slice(5, 7);
    var first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var byDate = {}; I.rows.forEach(function (r) { byDate[r.date] = r; });
    var h = '<div class="top"><h1>달력</h1></div><main>' + kidSeg('calKid', kd);
    h += '<div class="row"><button class="btn sec small" data-act="calMove" data-n="-1" aria-label="이전 달">◀</button><b>' + y + '년 ' + mo + '월</b><button class="btn sec small" data-act="calMove" data-n="1" aria-label="다음 달">▶</button></div><div class="cal">';
    '일월화수목금토'.split('').forEach(function (w) { h += '<div class="dow">' + w + '</div>'; });
    for (var i = 0; i < first; i++) h += '<div></div>';
    for (var d = 1; d <= days; d++) {
      var ds = ym + '-' + pad(d), r = byDate[ds], ic = '', tx = '', cls = '';
      if (r) { var st = STATUS[r.status]; ic = st[0]; tx = st[1]; if (r.noHw) tx += '·숙제無'; }
      else if (ds > T && ds >= k.startDate) {
        if (Core.hasMark(S, kd, ds, 'rest')) { ic = '🛌'; tx = '예약'; } else if (Core.hasMark(S, kd, ds, 'nohw')) { ic = '📖'; tx = '숙제無'; }
      } else cls = ' dim';
      if (ds === T) cls += ' today';
      h += '<button class="' + cls + '" data-act="dayOpen" data-d="' + ds + '"' + (ds === T ? ' aria-current="date"' : '') + '><span>' + d + '</span><span class="ic">' + ic + '</span><span class="t">' + tx + '</span></button>';
    }
    return h + '</div><p class="sub">⭐ 성공 · 🌗 반액 · ○ 실패 · 🛌 쉬는 날 · 📖 숙제 없음 · 날짜를 누르면 바로 고칠 수 있어요</p></main>';
  }

  // ----- 용돈 -----
  function rewView() {
    var kd = curKid('rwKid'), k = kid(kd), m = Core.money(S, kd);
    var h = '<div class="top"><h1>용돈</h1></div><main>' + kidSeg('rwKid', kd);
    h += '<div class="card kidcard" ' + kidStyle(k) + '><div class="row"><span>누적 적립</span><b class="money">' + won(m.earned) + '</b></div><div class="row"><span>지급 누계</span><b class="money">' + won(m.paid) + '</b></div><div class="row"><span>미지급</span><b class="money">' + won(m.payable) + '</b></div>';
    if (m.adjust > 0) h += '<div class="row"><span>다음 지급 조정액</span><b class="money">' + won(m.adjust) + '</b></div><div class="hint">기록을 고쳐서 이미 준 돈이 더 많아졌어요. 앞으로 적립되는 돈에서 먼저 채워지고, 그 전에는 지급할 수 없어요.</div>';
    h += '<button class="btn" data-act="payOpen" data-id="' + kd + '"' + (m.payable === 0 ? ' disabled' : '') + '>용돈 지급 기록</button></div>';
    var pays = S.payments.filter(function (p) { return p.kid === kd; }).slice().reverse();
    h += '<h2>지급·취소 내역</h2><div class="card list">' + (pays.length ? pays.map(function (p) {
      var cancelled = p.kind === 'pay' && Core.payCancelled(S, p.id);
      return '<div class="item"><div class="row"><span>' + (p.kind === 'pay' ? '💵 지급' : '↩️ 취소') + ' · ' + fmtDate(p.date) + '</span><b class="money">' + (p.kind === 'pay' ? '' : '-') + won(p.amount) + '</b></div>' +
        (p.memo ? '<div class="sub">' + esc(p.memo) + '</div>' : '') + (p.reason ? '<div class="sub">취소 이유: ' + esc(p.reason) + '</div>' : '') +
        (p.kind === 'pay' ? (cancelled ? '<span class="badge">취소됨</span>' : '<button class="btn small danger" data-act="cancelPayOpen" data-id="' + p.id + '">취소</button>') : '') + '</div>';
    }).join('') : '<p class="sub">지급 기록이 없어요</p>') + '</div>';
    var byDate = {};
    S.rewards.forEach(function (r) { if (r.kid === kd) byDate[r.date] = (byDate[r.date] || 0) + r.amount; });
    var ds = Object.keys(byDate).filter(function (d) { return byDate[d] !== 0; }).sort().reverse();
    h += '<h2>날짜별 적립</h2><div class="card list">' + (ds.length ? ds.map(function (d) { return '<div class="item row"><span>' + fmtDate(d) + '</span><b class="money">' + (byDate[d] > 0 ? '+' : '') + won(byDate[d]) + '</b></div>'; }).join('') : '<p class="sub">아직 없어요</p>') + '</div>';
    return h + '</main>';
  }

  // ----- 설정 -----
  function settingsView() {
    var f = S.family, h = '<div class="top"><h1>설정</h1></div><main>';
    S.kids.forEach(function (k) {
      h += '<div class="card kidcard" ' + kidStyle(k) + '><h3>' + esc(k.character) + ' ' + esc(k.name) + '</h3><label for="pn_' + k.id + '">별명</label><input type="text" id="pn_' + k.id + '" maxlength="10" value="' + esc(k.name) + '">' +
        '<label>캐릭터</label><div class="chips" id="pc_' + k.id + '">' + CH.map(function (c) { return '<button class="chip' + (c[0] === k.character ? ' on' : '') + '" data-act="pickChip" data-v="' + c[0] + '" aria-label="' + c[1] + '">' + c[0] + '</button>'; }).join('') + '</div>' +
        '<label>강조 색</label><div class="chips" id="pk_' + k.id + '">' + COLORS.map(function (c) { return '<button class="chip' + (c === k.color ? ' on' : '') + '" data-act="pickChip" data-v="' + c + '" style="background:' + c + '" aria-label="색">　</button>'; }).join('') + '</div>' +
        '<button class="btn small" data-act="profileSave" data-id="' + k.id + '">저장</button><button class="btn small sec" data-act="startOpen" data-id="' + k.id + '">시작 날짜 ' + fmtShort(k.startDate) + ' 변경</button>' +
        (S.kids.length > 1 ? '<button class="btn small danger" data-act="kidDel" data-id="' + k.id + '">아이 삭제</button>' : '') + '</div>';
    });
    h += '<button class="btn sec" data-act="kidAddOpen">+ 아이 추가</button>';
    h += '<button class="btn sec" data-act="go" data-v="rest">🛌 쉬는 날·숙제 없음 미리 지정</button>';
    h += '<div class="card"><h3>백업과 복원</h3><p class="sub">기록은 이 폰에만 있어요. 마지막 백업: ' + (f.lastBackup ? fmtTime(f.lastBackup) : '아직 없어요') + '</p>' +
      ((f.lastBackup ? Core.daysBetween(Core.kstDate(f.lastBackup), T) : 99) >= 30 ? '<div class="hint">백업한 지 30일이 넘었어요</div>' : '') +
      '<button class="btn small" data-act="backupOpen">백업 파일 만들기</button><button class="btn small sec" data-act="restoreOpen">백업에서 복원</button>' +
      (localStorage.getItem(PREV) ? '<button class="btn small danger" data-act="undoRestore">직전 복원 되돌리기</button>' : '') + '<input type="file" id="rfile" class="hide" accept=".hbk,.json,application/json"></div>';
    h += '<div class="card"><h3>기록 알림</h3><p class="sub">웹앱은 꺼져 있을 때 알림을 띄울 수 없어요. 아이폰 <b>시계 앱 알람</b>이나 <b>미리알림 앱</b>에 매일 반복 알림(예: 밤 9시 “아이들 기록”)을 만들어 두세요.</p></div>';
    h += '<div class="card"><h3>규칙 안내</h3><p>줄넘기 목표와 숙제를 둘 다 하면 성공: 보상은 연속 성공일수 × 100원.</p><p>목표는 1,000개, 연속 21일째부터 하루 10개씩 늘어요.</p>' +
      '<p>하나만 하면 그날 보상의 절반, 연속일수는 전날 그대로예요.</p><p>둘 다 못 하거나 기록이 없으면 실패: 연속일수와 목표만 처음으로 돌아가고 모은 돈은 그대로예요.</p>' +
      '<p>쉬는 날은 연속일수에서 제외해요. 연속은 유지되고 그날 보상은 없어요. 아플 때나 여행 때는 쉬는 날을 적극 활용해 주세요.</p>' +
      '<p class="sub">오늘·어제는 바로 고칠 수 있고, 그보다 지난 날짜는 달력에서 이유를 적고 고쳐요.</p></div></main>';
    return h;
  }

  // ----- 쉬는 날 미리 지정 -----
  function restView() {
    var f = ui.restForm = ui.restForm || { kids: S.kids.map(function (k) { return k.id; }), kind: 'rest', reason: '여행' };
    var h = '<div class="top"><button class="btn sec small" data-act="go" data-v="settings">← 설정</button></div><main><h1>쉬는 날·숙제 없음</h1><div class="card"><label>누구에게</label><div class="chips">';
    S.kids.forEach(function (k) { h += '<button class="chip ' + (f.kids.indexOf(k.id) >= 0 ? 'on' : '') + '" data-act="restKid" data-id="' + k.id + '" aria-pressed="' + (f.kids.indexOf(k.id) >= 0) + '">' + esc(k.character) + ' ' + esc(k.name) + '</button>'; });
    h += '</div><label>종류</label><div class="seg"><button class="' + (f.kind === 'rest' ? 'on' : '') + '" data-act="restKind" data-v="rest">🛌 쉬는 날</button><button class="' + (f.kind === 'nohw' ? 'on' : '') + '" data-act="restKind" data-v="nohw">📖 숙제 없음</button></div>';
    h += '<label for="rf">시작 날짜</label><input type="date" id="rf" value="' + (f.from || T) + '"><label for="rt">끝 날짜 (하루면 같은 날짜)</label><input type="date" id="rt" value="' + (f.to || f.from || T) + '">';
    if (f.kind === 'rest') {
      h += '<label>사유</label><div class="chips">' + REST_REASONS.map(function (r) { return '<button class="chip ' + (f.reason === r ? 'on' : '') + '" data-act="restReason" data-v="' + r + '">' + r + '</button>'; }).join('') + '</div>';
      if (f.reason === '직접 입력') h += '<input type="text" id="rr" placeholder="사유" value="' + esc(f.custom || '') + '" style="margin-top:8px">';
      h += '<p class="sub">연속은 유지되고 그날 보상은 없어요.</p>';
    } else h += '<p class="sub">그날은 숙제 조건을 채운 것으로 보고 줄넘기 목표만 적용해요.</p>';
    h += '<p class="sub">오늘과 미래 날짜를 지정해요. 이미 기록한 날짜는 홈이나 달력에서 고쳐 주세요.</p><button class="btn" data-act="restSave">저장</button></div>';
    var list = S.marks.filter(function (m) { return m.active && m.date >= T; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    h += '<h2>예정된 지정</h2><div class="card list">' + (list.length ? list.map(function (m) {
      var k = kid(m.kid); if (!k) return '';
      return '<div class="item row"><span>' + esc(k.name) + ' · ' + fmtDate(m.date) + ' · ' + (m.kind === 'rest' ? '🛌 쉬는 날' : '📖 숙제 없음') + (m.reason ? ' (' + esc(m.reason) + ')' : '') + '</span>' +
        '<button class="btn small danger" data-act="markCancel" data-k="' + m.kid + '" data-d="' + m.date + '" data-kind="' + m.kind + '">취소</button></div>';
    }).join('') : '<p class="sub">예정된 날이 없어요</p>') + '</div></main>';
    return h;
  }

  // ---------- 모달 ----------
  function openModal(m) { ui.modal = m; renderModal(); }
  function closeModal() { ui.modal = null; renderModal(); }
  function renderModal() {
    var el = $('modal'); if (!el) return;
    var m = ui.modal; if (!m) { el.innerHTML = ''; return; }
    var b = '', cls = 'modal';
    switch (m.type) {
      case 'show': b = showModal(m); cls = 'modal full'; break;
      case 'edit': b = editModal(m); break;
      case 'future': b = futureModal(m); break;
      case 'confirmRecord':
        b = '<h2>뒤 날짜 결과도 바뀌어요</h2><p class="sub">' + esc(kid(m.p.kid).name) + ' · ' + fmtDate(m.p.date) + ' 기록을 저장하면 아래처럼 다시 계산돼요.</p><div class="card">' + previewHtml(m.pv) + '</div><button class="btn" data-act="confirmRecordOk">저장</button><button class="btn sec" data-act="modalClose">취소</button>'; break;
      case 'pay': {
        var mm = Core.money(S, m.kid);
        b = '<h2>용돈 지급 기록</h2><p class="sub">실제로 준 돈을 기록해요. 이체는 되지 않아요. 지금 줄 수 있는 금액 ' + won(mm.payable) + '</p><label for="payAmt">금액(원)</label><input type="number" id="payAmt" inputmode="numeric" min="1" step="1" value="' + mm.payable + '"><label for="payDate">지급 날짜</label><input type="date" id="payDate" value="' + T + '"><label for="payMemo">메모(선택)</label><input type="text" id="payMemo"><button class="btn" data-act="payOk" data-id="' + m.kid + '">기록하기</button><button class="btn sec" data-act="modalClose">취소</button>'; break; }
      case 'cancelPay':
        b = '<h2>지급 취소</h2><p class="sub">원래 기록은 남기고 취소 기록을 더해요. 한 번만 취소할 수 있어요.</p><label for="cpReason">취소 이유</label><input type="text" id="cpReason"><button class="btn danger" data-act="cancelPayOk" data-id="' + m.id + '">취소 기록 추가</button><button class="btn sec" data-act="modalClose">닫기</button>'; break;
      case 'start': b = startModal(m); break;
      case 'kidAdd':
        b = '<h2>아이 추가</h2><label for="kaName">별명</label><input type="text" id="kaName" maxlength="10"><label>캐릭터</label><div class="chips" id="kaCh">' + CH.map(function (c, j) { return '<button class="chip' + (j === 0 ? ' on' : '') + '" data-act="pickChip" data-v="' + c[0] + '" aria-label="' + c[1] + '">' + c[0] + '</button>'; }).join('') + '</div>' +
          '<label>강조 색</label><div class="chips" id="kaCo">' + COLORS.map(function (c, j) { return '<button class="chip' + (j === 0 ? ' on' : '') + '" data-act="pickChip" data-v="' + c + '" style="background:' + c + '" aria-label="색">　</button>'; }).join('') + '</div>' +
          '<label for="kaStreak">어제까지 연속 성공일수 (처음이면 비워 두세요)</label><input type="number" id="kaStreak" inputmode="numeric" min="0" step="1" placeholder="0"><button class="btn" data-act="kidAddOk">추가</button><button class="btn sec" data-act="modalClose">취소</button>'; break;
      case 'password':
        b = '<h2>' + (m.mode === 'export' ? '백업 암호 정하기' : '백업 암호 입력') + '</h2>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') +
          (m.mode === 'export' ? '<p class="sub">이 암호를 잊으면 복원할 수 없어요. 파일 안에는 암호가 들어가지 않아요.</p>' : '') +
          '<input type="password" id="bkPw" autocomplete="off" aria-label="암호">' + (m.mode === 'export' ? '<label for="bkPw2">한 번 더</label><input type="password" id="bkPw2" autocomplete="off">' : '') +
          '<button class="btn" data-act="' + (m.mode === 'export' ? 'exportGo' : 'restoreGo') + '">확인</button><button class="btn sec" data-act="modalClose">취소</button>'; break;
      case 'restorePreview': {
        var d = m.data, ks = d.kids.map(function (k) { var mo = Core.money(d, k.id); return '<tr><td>' + esc(k.name) + '</td><td>' + fmtShort(k.startDate) + '~</td><td>' + won(mo.earned) + '</td><td>' + won(mo.paid) + '</td></tr>'; }).join('');
        b = '<h2>복원 미리보기</h2><p>백업 날짜: ' + fmtTime(m.createdAt) + '</p><table><tr><th>아이</th><th>시작</th><th>적립</th><th>지급</th></tr>' + ks + '</table><div class="hint">지금 기록은 백업 내용으로 바뀌어요. 복원 직전 기록은 따로 보관돼서 설정에서 되돌릴 수 있어요.</div><button class="btn danger" data-act="restoreApply">복원하기</button><button class="btn sec" data-act="modalClose">취소</button>'; break; }
    }
    el.innerHTML = '<div class="' + cls + '" data-act="modalBg" role="dialog" aria-modal="true"><div>' + b + '</div></div>';
  }

  // 아이에게 보여주기 (전체 화면)
  function showModal(m) {
    var k = kid(m.kid), I = info(m.kid), mo = Core.money(S, m.kid), r = I.today;
    var msg = !r ? '곧 시작해요' : r.status === 'success' ? '오늘도 해냈어! 🎉' : r.status === 'partial' ? '오늘은 절반 성공! 내일은 둘 다 해보자' : r.status === 'rest' ? '오늘은 쉬는 날' : '오늘 목표 ' + num(r.target) + '개, 하나씩 해보자';
    return '<div class="celebrate" ' + kidStyle(k) + '><div class="em">' + esc(k.character) + '</div><h1>' + esc(k.name) + '</h1><p class="bigline">🔥 연속 ' + I.expectedStreak + '일</p><p class="bigline">' + esc(msg) + '</p><p>지금까지 모은 돈 <b>' + won(mo.earned) + '</b></p></div><button class="btn" data-act="modalClose">닫기</button>';
  }

  function editModal(m) {
    var k = kid(m.kid), r = rowOf(m.kid, m.date), old = m.date < Core.addDays(T, -1);
    var h = '<h2>' + esc(k.name) + ' · ' + fmtDate(m.date) + '</h2>';
    if (r) h += '<p class="result">' + (resultText(r) ? esc(resultText(r)) : badge(r.status) + ' 아직 기록 전') + '</p>' + (r.status !== 'rest' ? '<p class="sub">그날 목표 ' + num(r.target) + '개 · 성공 시 ' + won(Core.rewardFor(r.n)) + '</p>' : '');
    h += '<div class="seg"><button class="' + (m.rest ? '' : 'on') + '" data-act="editMode" data-v="0">기록</button><button class="' + (m.rest ? 'on' : '') + '" data-act="editMode" data-v="1">쉬는 날</button></div>';
    if (!m.rest) h += '<label for="eCount">줄넘기 개수</label><input type="number" id="eCount" inputmode="numeric" min="0" step="1" value="' + esc(m.count) + '" placeholder="0">' +
      '<label class="chk"><input type="checkbox" id="eHw"' + (m.hw ? ' checked' : '') + '> 숙제 완료</label><label class="chk"><input type="checkbox" id="eNo"' + (m.noHw ? ' checked' : '') + '> 숙제 없는 날</label>';
    if (old) h += '<label for="eReason">고치는 이유 (필수)</label><input type="text" id="eReason" value="' + esc(m.reason || '') + '" placeholder="예: 기록을 깜빡함">';
    var ad = S.audit.filter(function (a) { return a.kid === m.kid && a.date === m.date; });
    if (ad.length) h += '<h3>변경 이력</h3>' + ad.map(function (a) { return '<p class="sub">' + fmtTime(a.at) + ' · ' + esc(a.reason) + '</p>'; }).join('');
    return h + '<button class="btn" data-act="editSave">저장</button><button class="btn sec" data-act="modalClose">닫기</button>';
  }
  function futureModal(m) {
    var k = kid(m.kid), rs = Core.hasMark(S, m.kid, m.date, 'rest'), nh = Core.hasMark(S, m.kid, m.date, 'nohw');
    return '<h2>' + esc(k.name) + ' · ' + fmtDate(m.date) + '</h2><p class="sub">미래 날짜는 쉬는 날·숙제 없음만 미리 정할 수 있어요.</p>' +
      '<button class="btn ' + (rs ? 'danger' : 'sec') + '" data-act="futureMark" data-kind="rest">' + (rs ? '🛌 쉬는 날 예약 취소' : '🛌 쉬는 날로 예약') + '</button>' +
      '<button class="btn ' + (nh ? 'danger' : 'sec') + '" data-act="futureMark" data-kind="nohw">' + (nh ? '📖 숙제 없음 예약 취소' : '📖 숙제 없음으로 예약') + '</button><button class="btn sec" data-act="modalClose">닫기</button>';
  }

  var ST_TXT = { success: '성공', partial: '반액', fail: '실패', rest: '쉬는 날', pending: '대기', progress: '기록 전', ready: '기록 전' };
  function rowTxt(r) {
    if (!r) return '—';
    var t = ST_TXT[r.status];
    if (r.status !== 'rest') t += ' · ' + num(r.target) + '개';
    if (r.reward != null && r.status !== 'rest') t += ' · ' + won(r.reward);
    return t + ' · 연속 ' + r.streakE;
  }
  function previewHtml(pv) {
    var h = '<table><tr><th>날짜</th><th>이전</th><th>이후</th></tr>' + pv.changes.slice(0, 40).map(function (c) {
      return '<tr><td>' + fmtShort(c.date) + '</td><td>' + esc(rowTxt(c.before)) + '</td><td><b>' + esc(rowTxt(c.after)) + '</b></td></tr>';
    }).join('') + '</table>' + (pv.changes.length > 40 ? '<p class="sub">외 ' + (pv.changes.length - 40) + '일</p>' : '');
    var a = pv.moneyBefore, b = pv.moneyAfter;
    h += '<div class="row"><span>누적 적립</span><b>' + won(a.earned) + ' → ' + won(b.earned) + '</b></div><div class="row"><span>미지급</span><b>' + won(a.payable) + ' → ' + won(b.payable) + '</b></div>';
    if (a.adjust || b.adjust) h += '<div class="row"><span>다음 지급 조정액</span><b>' + won(a.adjust) + ' → ' + won(b.adjust) + '</b></div>';
    return h;
  }
  function startModal(m) {
    var k = kid(m.kid);
    var h = '<h2>' + esc(k.name) + ' 시작 날짜 변경</h2>' + (m.err ? '<div class="hint bad">' + esc(m.err) + '</div>' : '') + '<label for="sdNew">새 시작 날짜</label><input type="date" id="sdNew" value="' + esc(m.date) + '"><label for="sdReason">변경 이유 (필수)</label><input type="text" id="sdReason" value="' + esc(m.reason || '') + '"><button class="btn sec" data-act="startPreview">영향 미리보기</button>';
    if (m.pv) h += '<div class="card">' + previewHtml(m.pv) + '</div><button class="btn danger" data-act="startSave">확인하고 저장</button>';
    return h + '<button class="btn sec" data-act="modalClose">취소</button>';
  }

  // ---------- 기록 저장 (홈·달력 공통) ----------
  // 뒤 날짜 결과가 바뀌는 경우에만 미리보기를 거친다.
  function saveRecord(p, onDone) {
    var now = Date.now(), pv;
    try { pv = Core.preview(S, p.kid, now, function (c) { Core.recordDay(c, p, now); }); }
    catch (e) { toast(e.message); return; }
    if (pv.changes.some(function (c) { return c.date > p.date; })) { openModal({ type: 'confirmRecord', p: p, pv: pv, onDone: onDone }); return; }
    commitRecord(p, onDone);
  }
  function commitRecord(p, onDone) {
    var r = run(function (c, now) { return Core.recordDay(c, p, now); });
    if (!r.ok) return;
    cache = {};
    var row = Core.computeKid(S, p.kid, T).rows.filter(function (x) { return x.date === p.date; })[0];
    toast(kid(p.kid).name + ' ' + resultText(row));
    if (onDone) onDone();
    if (ui.modal && (ui.modal.type === 'confirmRecord' || ui.modal.type === 'edit')) ui.modal = null;
    render();
  }
  function confirmEmpty(count, hw) {
    if (count === 0 && !hw) return confirm('줄넘기 0개, 숙제 안 함으로 저장하면 실패로 기록돼요(연속 초기화). 저장할까요?');
    if (count > S.family.bigCount) return confirm(num(count) + '개가 맞나요?');
    return true;
  }
  function parseCount(v) { return v === '' || v == null ? 0 : Number(v); }

  // ---------- 백업 ----------
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function subtle() { if (!window.crypto || !window.crypto.subtle) throw new Error('이 주소에서는 암호화를 쓸 수 없어요. https 주소로 열어 주세요'); return window.crypto.subtle; }
  async function deriveKey(pw, salt) {
    var km = await subtle().importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function exportBackup(pw) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveKey(pw, salt);
    var ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(S)));
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
    var d; try { d = migrate(JSON.parse(new TextDecoder().decode(pt))); } catch (e) { throw new Error('백업 내용을 읽을 수 없어요'); }
    var okShape = d && d.v === 1 && Array.isArray(d.kids) && d.kids.length && ['subs', 'marks', 'rewards', 'payments', 'audit'].every(function (k) { return Array.isArray(d[k]); }) && d.days && d.family;
    if (!okShape) throw new Error('백업 내용이 올바르지 않아요');
    if (!Core.verify(d, Date.now())) throw new Error('백업의 보상 합계가 기록과 맞지 않아요. 복원을 중단했어요');
    return { data: d, createdAt: env.createdAt };
  }

  // ---------- 동작 ----------
  function selChip(g) { var on = document.querySelector('#' + g + ' .on'); return on ? on.getAttribute('data-v') : null; }
  function restRead() { var f = ui.restForm; if (!f) return; if ($('rf')) f.from = val('rf'); if ($('rt')) f.to = val('rt'); if ($('rr')) f.custom = val('rr'); }
  function editRead() {
    var m = ui.modal;
    if ($('eCount')) m.count = val('eCount');
    if ($('eHw')) m.hw = $('eHw').checked;
    if ($('eNo')) m.noHw = $('eNo').checked;
    if ($('eReason')) m.reason = val('eReason');
  }

  var H = {
    go: function (d) { go(d.v); },
    modalClose: function () { closeModal(); },
    modalBg: function (d, el, e) { if (e.target === el) closeModal(); },
    pickChip: function (d, el) { Array.prototype.forEach.call(el.parentNode.querySelectorAll('.chip'), function (c) { c.classList.remove('on'); }); el.classList.add('on'); },
    // 첫 설정
    setupPick: function (d) { setupRead(); ui.setup.kids[+d.i][d.f] = d.v; render(); },
    setupAdd: function () { setupRead(); var n = ui.setup.kids.length; ui.setup.kids.push({ name: '', ch: CH[n % CH.length][0], color: COLORS[n % COLORS.length], streak: '' }); render(); },
    setupDel: function (d) { setupRead(); ui.setup.kids.splice(+d.i, 1); render(); },
    setupDone: function () {
      setupRead();
      var now = Date.now(), s = Core.newState();
      try {
        ui.setup.kids.forEach(function (k, i) {
          s.kids.push({ id: 'kid' + (i + 1), name: k.name.trim() || '아이' + (i + 1), character: k.ch, color: k.color, startDate: Core.kstDate(now) });
        });
        Core.tick(s, now);
        ui.setup.kids.forEach(function (k, i) { Core.seedHistory(s, 'kid' + (i + 1), k.streak === '' ? 0 : Number(k.streak), now); });
        persist(s);
      } catch (e) { toast(e.message || '저장할 수 없어요'); return; }
      S = s; ui.setup = null; go('home');
    },
    // 홈
    day: function (d) { ui.day = d.v; render(); },
    addCount: function (d) { var f = ui.form[d.k]; f.count = String(parseCount(f.count) + Number(d.n)); render(); },
    setCount: function (d) { ui.form[d.k].count = d.n; render(); },
    toggleHw: function (d) { ui.form[d.k].hw = !ui.form[d.k].hw; render(); },
    edit: function (d) { var key = formKey(d.id, selDate()); delete ui.form[key]; ui.editing[key] = true; render(); },
    editCancel: function (d) { var key = formKey(d.id, selDate()); delete ui.form[key]; delete ui.editing[key]; render(); },
    save: function (d) {
      var D = selDate(), key = formKey(d.id, D), f = ui.form[key], count = parseCount(f.count);
      if (!confirmEmpty(count, f.hw || rowOf(d.id, D).noHw)) return;
      saveRecord({ kid: d.id, date: D, count: count, hw: f.hw }, function () { delete ui.form[key]; delete ui.editing[key]; });
    },
    restDay: function (d) {
      var D = selDate(), key = formKey(d.id, D);
      saveRecord({ kid: d.id, date: D, rest: true }, function () { delete ui.form[key]; delete ui.editing[key]; });
    },
    show: function (d) { openModal({ type: 'show', kid: d.id }); },
    // 달력
    calKid: function (d) { ui.calKid = d.id; render(); },
    calMove: function (d) {
      var ym = ui.calMonth || T.slice(0, 7), y = +ym.slice(0, 4), m = +ym.slice(5, 7) + Number(d.n);
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      ui.calMonth = y + '-' + pad(m); render();
    },
    dayOpen: function (d) {
      var kd = curKid('calKid'), k = kid(kd);
      if (d.d > T) { if (d.d >= k.startDate) openModal({ type: 'future', kid: kd, date: d.d }); return; }
      if (d.d < k.startDate) { toast('시작 날짜(' + fmtDate(k.startDate) + ') 전이에요'); return; }
      var r = rowOf(kd, d.d);
      openModal({ type: 'edit', kid: kd, date: d.d, rest: r.status === 'rest', count: r.subId ? String(r.count) : '', hw: !!(r.subId && r.hw && !r.noHw), noHw: !!r.noHw, reason: '' });
    },
    editMode: function (d) { editRead(); ui.modal.rest = d.v === '1'; renderModal(); },
    editSave: function () {
      editRead(); var m = ui.modal, count = parseCount(m.count);
      if (!m.rest && !confirmEmpty(count, m.hw || m.noHw)) return;
      saveRecord(m.rest ? { kid: m.kid, date: m.date, rest: true, reason: m.reason } : { kid: m.kid, date: m.date, count: count, hw: m.hw, noHw: m.noHw, reason: m.reason });
    },
    confirmRecordOk: function () { var m = ui.modal; commitRecord(m.p, m.onDone); },
    futureMark: function (d) {
      var m = ui.modal, on = Core.hasMark(S, m.kid, m.date, d.kind);
      var r = run(function (c, now) { return on ? Core.cancelMark(c, m.kid, m.date, d.kind, now) : Core.setMark(c, m.kid, m.date, d.kind, '', now); });
      if (r.ok) { toast(on ? '예약을 취소했어요' : '예약했어요'); render(); }
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
    restKid: function (d) { var f = ui.restForm, i = f.kids.indexOf(d.id); restRead(); if (i >= 0) f.kids.splice(i, 1); else f.kids.push(d.id); render(); },
    restKind: function (d) { restRead(); ui.restForm.kind = d.v; render(); },
    restReason: function (d) { restRead(); ui.restForm.reason = d.v; render(); },
    restSave: function () {
      restRead(); var f = ui.restForm, from = f.from || T, to = f.to || from;
      if (!f.kids.length) { toast('아이를 선택해 주세요'); return; }
      if (to < from) { toast('날짜를 확인해 주세요'); return; }
      if (Core.daysBetween(from, to) > 60) { toast('한 번에 60일까지 지정할 수 있어요'); return; }
      var reason = f.kind === 'rest' ? (f.reason === '직접 입력' ? (f.custom || '') : f.reason) : '';
      if (f.kind === 'rest' && f.reason === '직접 입력' && !reason.trim()) { toast('사유를 입력해 주세요'); return; }
      var r = run(function (c, now) { for (var d = from; d <= to; d = Core.addDays(d, 1)) f.kids.forEach(function (id) { Core.setMark(c, id, d, f.kind, reason, now); }); });
      if (r.ok) { toast('저장했어요'); ui.restForm = null; render(); }
    },
    markCancel: function (d) { var r = run(function (c, now) { return Core.cancelMark(c, d.k, d.d, d.kind, now); }); if (r.ok) { toast('취소했어요'); render(); } },
    // 설정
    profileSave: function (d) {
      var nm = val('pn_' + d.id).trim(); if (!nm) { toast('별명을 입력해 주세요'); return; }
      var ch = selChip('pc_' + d.id), co = selChip('pk_' + d.id);
      if (run(function (c) { var k = c.kids.filter(function (x) { return x.id === d.id; })[0]; k.name = nm; if (ch) k.character = ch; if (co) k.color = co; }).ok) { toast('저장했어요'); render(); }
    },
    kidAddOpen: function () { openModal({ type: 'kidAdd' }); },
    kidAddOk: function () {
      var nm = val('kaName').trim(), st = val('kaStreak'), ch = selChip('kaCh'), co = selChip('kaCo');
      if (!nm) { toast('별명을 입력해 주세요'); return; }
      var r = run(function (c, now) {
        var id = 'kid' + Date.now().toString(36);
        c.kids.push({ id: id, name: nm, character: ch || CH[0][0], color: co || COLORS[0], startDate: Core.kstDate(now) });
        Core.seedHistory(c, id, st === '' ? 0 : Number(st), now);
      });
      if (r.ok) { closeModal(); toast(nm + ' 추가했어요'); render(); }
    },
    kidDel: function (d) {
      var k = kid(d.id);
      if (!confirm(k.name + '의 기록·적립·지급 내역이 모두 지워져요. 되돌릴 수 없어요(백업이 있으면 복원 가능). 삭제할까요?')) return;
      var r = run(function (c) {
        c.kids = c.kids.filter(function (x) { return x.id !== d.id; });
        ['marks', 'subs', 'rewards', 'payments', 'audit'].forEach(function (a) { c[a] = c[a].filter(function (x) { return x.kid !== d.id; }); });
        delete c.days[d.id];
      });
      if (r.ok) { ui.calKid = ui.rwKid = null; toast('삭제했어요'); render(); }
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
    backupOpen: function () { openModal({ type: 'password', mode: 'export' }); },
    exportGo: async function () {
      var a = val('bkPw'), b = val('bkPw2');
      if (a.length < 4) { openModal({ type: 'password', mode: 'export', err: '암호는 4자 이상이에요' }); return; }
      if (a !== b) { openModal({ type: 'password', mode: 'export', err: '암호가 서로 달라요' }); return; }
      try { if (await exportBackup(a)) { run(function (c, now) { c.family.lastBackup = now; }); closeModal(); toast('백업 파일을 만들었어요. 폰 밖에도 보관해 주세요'); render(); } }
      catch (e) { openModal({ type: 'password', mode: 'export', err: e.message }); }
    },
    restoreOpen: function () {
      var f = $('rfile'); f.value = '';
      f.onchange = function () { var file = f.files[0]; if (!file) return; var rd = new FileReader(); rd.onload = function () { ui.restoreText = String(rd.result); openModal({ type: 'password', mode: 'restore' }); }; rd.readAsText(file); };
      f.click();
    },
    restoreGo: async function () {
      try { var r = await decryptBackup(ui.restoreText, val('bkPw')); ui.restoreData = r.data; openModal({ type: 'restorePreview', data: r.data, createdAt: r.createdAt }); }
      catch (e) { openModal({ type: 'password', mode: 'restore', err: e.message }); }
    },
    restoreApply: function () {
      var d = ui.restoreData; if (!d) return;
      try {
        localStorage.setItem(PREV, JSON.stringify(S));
        d.audit.push({ id: Core.uid(d, 'a'), at: Date.now(), kid: null, date: T, type: 'restore', reason: '백업 복원', before: null, after: null });
        persist(d); S = d; ui.restoreData = ui.restoreText = null; ui.form = {}; ui.editing = {}; tickNow(); closeModal(); toast('복원했어요'); render();
      } catch (e) { toast('복원하지 못했어요. 지금 기록은 그대로예요'); }
    },
    undoRestore: function () {
      if (!confirm('직전 복원 이전 기록으로 되돌릴까요?')) return;
      try { var p = migrate(JSON.parse(localStorage.getItem(PREV))); persist(p); S = p; localStorage.removeItem(PREV); ui.form = {}; toast('되돌렸어요'); render(); } catch (e) { toast('되돌리지 못했어요'); }
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null; if (!el) return;
    var fn = H[el.getAttribute('data-act')]; if (!fn) return;
    var d = {}; for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (a.name.indexOf('data-') === 0) d[a.name.slice(5)] = a.value; }
    fn(d, el, e);
  });
  // 개수 입력은 다시 그리지 않고 값만 보관 (기록 저장 때 한 번에 넘김)
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-form');
    if (k && ui.form[k]) ui.form[k].count = e.target.value;
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && S) { var prev = T; tickNow(); if (Core.viewToday(S, Date.now()) !== prev && !ui.modal) render(); }
  });
  setInterval(function () { // 앱을 켜 둔 채 자정을 넘기면 새 날짜로 갱신
    if (!S) return;
    var prev = T; tickNow();
    if (Core.viewToday(S, Date.now()) !== prev && !ui.modal) { ui.form = {}; ui.editing = {}; render(); }
  }, 30000);

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () { });
  tickNow(); render();
})();
