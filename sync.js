/* Firebase Realtime Database 동기화.
   클라우드에는 전체 상태를 JSON 문자열 하나로 둔다: users/{uid}/main = { json, rev, at, by }.
   올릴 때는 트랜잭션 안에서 클라우드 값과 Core.merge로 합쳐서, 두 기기가 동시에 저장해도 기록을 잃지 않는다. */
(function (root) {
  'use strict';
  var CFG = root.FIREBASE_CONFIG, SDK = '10.14.1';
  var DIRTY = 'habitApp.dirty', DEV = 'habitApp.device', REV = 'habitApp.syncRev:', REPL = 'habitApp.replace';
  var api = { configured: !!CFG, user: null, status: CFG ? 'starting' : 'off', error: '', online: false, lastAt: 0 };
  var hooks, auth, db, ref, timer, pushing = false, again = false, asking = false, device;
  // 덮어쓰기(복원·'이 기기 기록 사용')는 세대 번호(epoch)를 새로 붙여서 올린다.
  // 다른 기기는 세대가 바뀐 걸 보면 합치지 않고 그대로 받는다. 그래야 지운 기록이 되살아나지 않는다.
  function replacing() { return localStorage.getItem(REPL) === '1'; }
  function setReplacing(v) { if (v) localStorage.setItem(REPL, '1'); else localStorage.removeItem(REPL); }
  function newEpoch() {
    var st = Core.clone(hooks.get()); if (!st) return;
    st.epoch = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    hooks.set(st);
  }
  function adopt(remote, rev) { hooks.set(remote); setLastRev(rev); setDirty(false); }

  function isDirty() { return localStorage.getItem(DIRTY) === '1'; }
  function setDirty(v) { if (v) localStorage.setItem(DIRTY, '1'); else localStorage.removeItem(DIRTY); }
  function lastRev() { var v = api.user && localStorage.getItem(REV + api.user.uid); return v === null || v === undefined ? null : Number(v); }
  function setLastRev(r) { if (api.user) localStorage.setItem(REV + api.user.uid, String(r)); }
  function set(st, err) { api.status = st; api.error = err || ''; if (hooks) hooks.onStatus(); }
  function settled() { if (!isDirty()) { api.lastAt = Date.now(); set('ok'); } }
  function msg(e) {
    var c = e && e.code || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return '이메일 또는 비밀번호가 맞지 않아요';
    if (/too-many-requests/.test(c)) return '여러 번 틀려서 잠시 막혔어요. 조금 뒤에 다시 해 주세요';
    if (/network-request-failed/.test(c)) return '인터넷 연결을 확인해 주세요';
    if (/PERMISSION_DENIED|permission/i.test(c + (e && e.message))) return '데이터베이스 규칙이 접근을 막고 있어요. 규칙 설정을 확인해 주세요';
    return (e && e.message) || '동기화 오류';
  }

  api.init = function (h) {
    hooks = h;
    device = localStorage.getItem(DEV) || ('d' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem(DEV, device);
    if (!CFG) return;
    // 설정이 있을 때만 SDK를 받는다. 한 번 받으면 서비스 워커가 캐시해서 오프라인에서도 열린다.
    var base = 'https://www.gstatic.com/firebasejs/' + SDK + '/firebase-';
    if (root.firebase) { start(); return; }
    loadAll([base + 'app-compat.js', base + 'auth-compat.js', base + 'database-compat.js']).then(start, function () {
      set('error', 'Firebase를 불러오지 못했어요. 인터넷에 연결한 뒤 앱을 다시 열어 주세요');
    });
  };
  function loadAll(urls) {
    return urls.reduce(function (p, u) {
      return p.then(function () {
        return new Promise(function (ok, fail) { var sc = document.createElement('script'); sc.src = u; sc.onload = ok; sc.onerror = fail; document.head.appendChild(sc); });
      });
    }, Promise.resolve());
  }
  function start() {
    try { firebase.initializeApp(CFG); auth = firebase.auth(); db = firebase.database(); }
    catch (e) { set('error', '동기화 설정이 올바르지 않아요: ' + e.message); return; }
    api.ready = true;
    db.ref('.info/connected').on('value', function (s) {
      api.online = !!s.val();
      if (!api.user) return;
      if (!api.online) set('offline');
      else if (isDirty()) schedule(0); else settled();
    });
    auth.onAuthStateChanged(function (u) {
      if (ref) { ref.off(); ref = null; }
      api.user = u;
      if (!u) { set('signed-out'); return; }
      set('syncing');
      ref = db.ref('users/' + u.uid + '/main');
      ref.on('value', onRemote, function (e) { set('error', msg(e)); });
    });
  };

  function onRemote(snap) {
    var v = snap.val(), local = hooks.get();
    if (asking) return;
    if (!v || !v.json) { // 클라우드가 비어 있음
      if (local) { setDirty(true); schedule(0); } else settled();
      return;
    }
    if (v.rev === lastRev() && !isDirty()) { settled(); return; } // 이미 반영한 값(내가 올린 것 포함)
    var remote;
    try { remote = JSON.parse(v.json); } catch (e) { set('error', '클라우드 데이터를 읽을 수 없어요'); return; }
    if (!local) { hooks.set(remote); setLastRev(v.rev); setDirty(false); settled(); return; }
    if (lastRev() === null) { // 이 기기에서 처음 연결: 어느 쪽을 쓸지 묻는다
      asking = true;
      hooks.askFirst(remote, v, function (choice) {
        asking = false;
        if (choice === 'cloud') { hooks.set(remote); setLastRev(v.rev); setDirty(false); settled(); }
        else if (choice === 'local') { setLastRev(v.rev); newEpoch(); setDirty(true); setReplacing(true); schedule(0); }
        else { api.signOut(); }
      });
      return;
    }
    if (replacing()) { schedule(0); return; } // 이 기기의 덮어쓰기가 아직 안 올라감
    if ((remote.epoch || '') !== (local.epoch || '')) { // 다른 기기가 통째로 바꿈
      adopt(remote, v.rev); settled(); if (hooks.onReplaced) hooks.onReplaced(); return;
    }
    var merged = Core.merge(remote, local, Date.now());
    setLastRev(v.rev);
    if (JSON.stringify(merged) !== JSON.stringify(local)) hooks.set(merged);
    if (JSON.stringify(merged) !== v.json) { setDirty(true); schedule(0); }
    else { setDirty(false); settled(); }
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(push, ms == null ? 800 : ms); }
  function push() {
    if (!ref || asking) return;
    if (pushing) { again = true; return; }
    if (!hooks.get()) return;
    pushing = true; set('syncing');
    var replace = replacing();
    ref.transaction(function (cur) {
      var local = hooks.get(); if (!local) return; // 취소
      var base = null;
      if (cur && cur.json && !replace) { try { base = JSON.parse(cur.json); } catch (e) { base = null; } }
      if (base && (base.epoch || '') !== (local.epoch || '')) return; // 다른 기기가 통째로 바꿈: 올리지 않고 받는다
      var out = base ? Core.merge(base, local, Date.now()) : local;
      return { json: JSON.stringify(out), rev: ((cur && cur.rev) || 0) + 1, at: Date.now(), by: device };
    }, function (err, committed, snap) {
      pushing = false;
      if (err) { set(api.online ? 'error' : 'offline', msg(err)); return; }
      if (!committed) {
        var rv = snap && snap.val();
        if (rv && rv.json) { try { adopt(JSON.parse(rv.json), rv.rev); if (hooks.onReplaced) hooks.onReplaced(); } catch (e) { set('error', '클라우드 데이터를 읽을 수 없어요'); return; } }
      }
      if (committed) {
        if (replace) setReplacing(false);
        var v = snap.val(); setLastRev(v.rev);
        var st = JSON.parse(v.json), now = hooks.get();
        var m = now ? Core.merge(st, now, Date.now()) : st; // 올리는 사이에 생긴 변경도 살린다
        if (JSON.stringify(m) !== JSON.stringify(now)) hooks.set(m);
        if (JSON.stringify(m) !== v.json) again = true; else setDirty(false);
      }
      if (again) { again = false; schedule(0); } else settled();
    }, false);
  }

  // 앱에서 기록이 바뀔 때마다 호출
  api.changed = function () { setDirty(true); if (api.user && ref) { set(api.online ? 'syncing' : 'offline'); schedule(); } else if (hooks) hooks.onStatus(); };
  // 백업 복원처럼 클라우드를 이 기기 내용으로 통째로 바꿀 때
  api.replace = function () { if (!hooks.get()) return; newEpoch(); setDirty(true); setReplacing(true); if (api.user) schedule(0); };
  api.syncNow = function () {
    if (!ref) return;
    if (isDirty()) schedule(0);
    else { set('syncing'); ref.once('value').then(onRemote, function (e) { set('error', msg(e)); }); }
  };
  api.signIn = function (email, pw) {
    if (!auth) return Promise.reject(new Error(api.error || '동기화가 설정되지 않았어요'));
    return auth.signInWithEmailAndPassword(email, pw).catch(function (e) { throw new Error(msg(e)); });
  };
  api.signOut = function () { if (api.user) localStorage.removeItem(REV + api.user.uid); return auth ? auth.signOut() : Promise.resolve(); };
  api.isDirty = isDirty;
  root.Sync = api;
})(window);
