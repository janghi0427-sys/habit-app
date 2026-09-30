/* 계산·상태 변경 모듈 (화면과 분리). 설계서 v2 3.5절 재계산 절차 구현.
   브라우저(window.Core)와 Node(require) 모두에서 동작한다. */
(function (root) {
  'use strict';
  var DAY = 86400000, KST = 9 * 3600000;
  var RULE_VERSION = 1;
  function E(m) { return new Error(m); }

  // ---------- 날짜 (Asia/Seoul 고정) ----------
  function kstDate(ms) { return new Date(ms + KST).toISOString().slice(0, 10); }
  function dnum(d) { var p = d.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / DAY; }
  function addDays(d, n) { return new Date((dnum(d) + n) * DAY).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return dnum(b) - dnum(a); }
  function goalFor(n) { return 1000 + 10 * Math.max(0, n - 20); }
  function rewardFor(n) { return 100 * n; }

  // ---------- 상태 ----------
  function newState() {
    return {
      v: 1,
      family: {
        tz: 'Asia/Seoul', ruleVersion: RULE_VERSION, pin: null, recovery: null,
        lock: { fails: 0, until: 0 }, notify: { on: false, time: '19:00' },
        cleanedThrough: null, maxSeen: 0, lastBackup: 0, alertDays: 3,
        sound: true, bigCount: 20000
      },
      kids: [], days: {}, marks: [], subs: [], rewards: [], payments: [], audit: [], reqIds: {}, seq: 0
    };
  }
  function uid(s, p) { s.seq += 1; return p + s.seq + '_' + Math.random().toString(36).slice(2, 7); }
  function getKid(s, id) {
    var k = s.kids.filter(function (x) { return x.id === id; })[0];
    if (!k) throw E('자녀를 찾을 수 없어요');
    return k;
  }
  function hasMark(s, kid, date, kind) {
    return s.marks.some(function (m) { return m.kid === kid && m.date === date && m.kind === kind && m.active; });
  }
  function sum(arr, f) { return arr.reduce(function (a, x) { return a + f(x); }, 0); }

  // ---------- 재계산 (3.5절) ----------
  function computeKid(s, kidId, today) {
    var kid = getKid(s, kidId);
    var rows = [], sC = 0, sE = 0, blocked = false, pendingCount = 0, confirmed = {};
    var kidDays = s.days[kidId] || {};
    var subsByDate = {};
    s.subs.forEach(function (x) { if (x.kid === kidId) (subsByDate[x.date] = subsByDate[x.date] || []).push(x); });
    for (var d = kid.startDate; d <= today; d = addDays(d, 1)) {
      var closed = d < today;
      var draft = kidDays[d] || {};
      var rest = hasMark(s, kidId, d, 'rest'), noHw = hasMark(s, kidId, d, 'nohw');
      var subs = subsByDate[d] || [];
      var appr = subs.filter(function (x) { return x.status === 'approved'; })[0];
      var val = subs.filter(function (x) { return x.status === 'valid'; })[0];
      var row = { date: d, closed: closed, rest: rest, noHw: noHw, subId: null, count: draft.count || 0, hw: !!draft.hw || noHw, reward: null, confirmed: false, expReward: null };
      if (rest) {
        row.status = 'rest'; row.reward = 0; row.confirmed = !blocked; row.streakE = sE; row.n = sE + 1;
        if (row.confirmed) confirmed[d] = 0;
        rows.push(row); continue;
      }
      var tE = goalFor(sE + 1);
      row.n = sE + 1; row.target = tE; row.estimated = blocked; row.streakBefore = sE;
      var last = subs.filter(function (x) { return x.status !== 'valid' && x.status !== 'approved'; }).slice(-1)[0];
      if (appr) {
        var ok = appr.count >= tE && (appr.hw || noHw);
        row.status = ok ? 'success' : 'fail'; row.subId = appr.id; row.count = appr.count; row.hw = !!appr.hw || noHw;
        row.approvedAt = appr.approvedAt; row.at = appr.at; row.anomaly = appr.anomaly; row.source = appr.source;
        sE = ok ? sE + 1 : 0;
        if (!blocked) { sC = sE; row.reward = ok ? rewardFor(sC) : 0; row.confirmed = true; confirmed[d] = row.reward; }
        else row.expReward = ok ? rewardFor(sE) : 0;
      } else if (val) {
        var okv = val.count >= tE && (val.hw || noHw);
        row.status = 'pending'; row.subId = val.id; row.count = val.count; row.hw = !!val.hw || noHw;
        row.at = val.at; row.anomaly = val.anomaly; row.subTarget = val.target; row.subEstimated = val.estimated;
        blocked = true; pendingCount += 1;
        sE = okv ? sE + 1 : 0; row.expReward = okv ? rewardFor(sE) : 0;
      } else if (closed) {
        row.status = 'fail';
        var cand = draft.count !== undefined ? { c: draft.count, h: !!draft.hw } : (last ? { c: last.count, h: !!last.hw } : null);
        if (cand && cand.c >= tE && (cand.h || noHw)) row.couldQualify = true;
        if (last && last.status === 'rejected') { row.rejectReasons = last.reasons; }
        sE = 0;
        if (!blocked) { sC = 0; row.reward = 0; row.confirmed = true; confirmed[d] = 0; }
      } else {
        var cnt = draft.count || 0, hwOK = !!draft.hw || noHw;
        row.status = (cnt >= tE && hwOK) ? 'ready' : 'progress';
        if (last && last.status === 'rejected') row.rejectReasons = last.reasons;
      }
      row.streakE = sE;
      rows.push(row);
    }
    var todayRow = rows.length && rows[rows.length - 1].date === today ? rows[rows.length - 1] : null;
    var pendingSubs = rows.filter(function (r) { return r.status === 'pending'; });
    return {
      rows: rows, today: todayRow, confirmedStreak: sC, expectedStreak: sE, blocked: blocked,
      pendingCount: pendingCount, pendingRows: pendingSubs, confirmed: confirmed, started: !!rows.length
    };
  }

  // ---------- 금액 ----------
  function money(s, kidId) {
    var earned = sum(s.rewards.filter(function (r) { return r.kid === kidId; }), function (r) { return r.amount; });
    var pays = s.payments.filter(function (p) { return p.kid === kidId; });
    var paid = sum(pays, function (p) { return p.kind === 'pay' ? p.amount : -p.amount; });
    var balance = earned - paid;
    return { earned: earned, paid: paid, balance: balance, payable: Math.max(0, balance), adjust: Math.max(0, -balance) };
  }
  function payCancelled(s, payId) { return s.payments.some(function (p) { return p.kind === 'cancel' && p.targetId === payId; }); }

  // ---------- 보상 내역 대조 ----------
  // mode 'normal': 새 확정 날짜의 보상 추가만 허용, 그 외 차이는 오류. mode 'adjust': 차액 조정 내역 추가.
  function reconcile(s, kidId, today, mode, nowMs) {
    var info = computeKid(s, kidId, today), kid = getKid(s, kidId), added = [];
    var byDate = {};
    s.rewards.forEach(function (r) { if (r.kid === kidId) byDate[r.date] = (byDate[r.date] || 0) + r.amount; });
    info.rows.forEach(function (row) {
      if (!row.confirmed) return;
      var want = row.reward || 0, have = byDate[row.date] || 0;
      if (want === have) return;
      if (mode === 'normal') {
        var dup = s.rewards.some(function (r) { return r.subId === row.subId; });
        if (have === 0 && want > 0 && row.subId && !dup) { added.push(mk(row.date, want, 'reward', row.subId)); return; }
        throw E('계산 결과가 기존 기록과 달라요 (' + row.date + '). 저장하지 않았어요');
      }
      added.push(mk(row.date, want - have, have === 0 ? 'reward' : 'adjust', row.subId));
    });
    Object.keys(byDate).forEach(function (d) {
      if (d < kid.startDate && byDate[d] !== 0) {
        if (mode === 'normal') throw E('시작 날짜 이전 기록이 있어요');
        added.push(mk(d, -byDate[d], 'adjust', null));
      }
    });
    function mk(date, amount, kind, subId) {
      return { id: uid(s, 'r'), kid: kidId, date: date, subId: subId || null, amount: amount, kind: kind, at: nowMs, ruleVersion: RULE_VERSION };
    }
    added.forEach(function (r) { s.rewards.push(r); });
    return added;
  }

  // ---------- 시각 관리 (9.4절, 5.3절) ----------
  function tick(s, nowMs) {
    var f = s.family;
    var anomaly = !!(f.maxSeen && nowMs < f.maxSeen - 10 * 60000);
    if (nowMs > f.maxSeen) f.maxSeen = nowMs;
    var y = addDays(kstDate(nowMs), -1);
    if (!f.cleanedThrough || y > f.cleanedThrough) f.cleanedThrough = y;
    return anomaly;
  }
  function clockBlocked(s, nowMs) { return !!(s.family.cleanedThrough && kstDate(nowMs) <= s.family.cleanedThrough); }
  function viewToday(s, nowMs) {
    var t = kstDate(nowMs);
    return clockBlocked(s, nowMs) ? addDays(s.family.cleanedThrough, 1) : t;
  }
  function guardToday(s, kidId, nowMs) {
    var kid = getKid(s, kidId), t = kstDate(nowMs);
    if (t < kid.startDate) throw E('아직 시작 전이에요');
    if (clockBlocked(s, nowMs)) throw E('휴대폰 시각이 바뀐 흔적이 있어요. 지난 날짜에는 새로 입력할 수 없어요');
    return t;
  }
  function once(s, reqId) {
    if (!reqId) return false;
    if (s.reqIds[reqId]) return true;
    s.reqIds[reqId] = 1; return false;
  }

  // ---------- 아이 동작 ----------
  function setDraft(s, kidId, nowMs, patch) {
    tick(s, nowMs);
    var t = guardToday(s, kidId, nowMs);
    var row = computeKid(s, kidId, t).today;
    if (row.status === 'rest') throw E('오늘은 쉬는 날이에요');
    if (row.status === 'success') throw E('이미 승인된 기록은 바꿀 수 없어요');
    var days = s.days[kidId] = s.days[kidId] || {};
    var dr = days[t] = days[t] || { count: 0, hw: false };
    var changed = false;
    if (patch.count !== undefined) {
      var c = patch.count;
      if (typeof c !== 'number' || !isFinite(c) || Math.floor(c) !== c || c < 0) throw E('0 이상의 정수를 입력해 주세요');
      if (c !== dr.count) changed = true; dr.count = c;
    }
    if (patch.hw !== undefined) {
      if (!!patch.hw !== !!dr.hw) changed = true; dr.hw = !!patch.hw;
    }
    var withdrawn = false;
    if (changed) s.subs.forEach(function (x) { if (x.kid === kidId && x.date === t && x.status === 'valid') { x.status = 'withdrawn'; withdrawn = true; } });
    return { withdrawn: withdrawn };
  }
  function submit(s, kidId, nowMs) {
    var anomaly = tick(s, nowMs);
    var t = guardToday(s, kidId, nowMs);
    var row = computeKid(s, kidId, t).today;
    if (row.status !== 'ready') throw E('아직 제출할 수 없어요');
    var sub = { id: uid(s, 's'), kid: kidId, date: t, count: row.count, hw: true, noHw: row.noHw, target: row.target, estimated: row.estimated, at: nowMs, anomaly: anomaly, status: 'valid', ruleVersion: RULE_VERSION };
    s.subs.push(sub);
    return sub;
  }

  // ---------- 부모 동작 ----------
  function approve(s, subId, reqId, nowMs) {
    var anomaly = tick(s, nowMs); void anomaly;
    if (once(s, reqId)) return { duplicate: true };
    var sub = s.subs.filter(function (x) { return x.id === subId; })[0];
    if (!sub || sub.status !== 'valid') throw E('승인할 수 있는 기록이 아니에요');
    var earlier = s.subs.some(function (x) { return x.kid === sub.kid && x.status === 'valid' && x.date < sub.date; });
    if (earlier) throw E('먼저 이전 날짜 기록부터 확인해 주세요');
    sub.status = 'approved'; sub.approvedAt = nowMs;
    var added = reconcile(s, sub.kid, viewToday(s, nowMs), 'normal', nowMs);
    return { added: added };
  }
  function reject(s, subId, reasons, note, reqId, nowMs) {
    tick(s, nowMs);
    if (once(s, reqId)) return { duplicate: true };
    if (!reasons || !reasons.length) throw E('반려 사유를 하나 이상 선택해 주세요');
    var sub = s.subs.filter(function (x) { return x.id === subId; })[0];
    if (!sub || sub.status !== 'valid') throw E('반려할 수 있는 기록이 아니에요');
    sub.status = 'rejected'; sub.reasons = reasons; sub.rejectNote = note || ''; sub.rejectedAt = nowMs;
    return {};
  }

  function setMark(s, kidId, date, kind, reason, nowMs) {
    tick(s, nowMs);
    var kid = getKid(s, kidId), today = viewToday(s, nowMs);
    if (date < kid.startDate) throw E('시작 날짜 이전은 지정할 수 없어요');
    if (date < today) throw E('지난 날짜는 과거 기록 정정으로 바꿔 주세요');
    if (hasMark(s, kidId, date, kind)) return {};
    if (date === today) {
      var row = computeKid(s, kidId, today).today;
      if (row && row.status === 'success') throw E('오늘 이미 성공한 기록은 과거 기록 정정으로 바꿔 주세요');
      if (kind === 'rest') s.subs.forEach(function (x) { if (x.kid === kidId && x.date === date && x.status === 'valid') { x.status = 'voided'; x.voidReason = '쉬는 날 지정'; } });
    }
    s.marks.push({ id: uid(s, 'm'), kid: kidId, date: date, kind: kind, reason: reason || '', at: nowMs, active: true });
    return {};
  }
  function cancelMark(s, kidId, date, kind, nowMs) {
    tick(s, nowMs);
    var today = viewToday(s, nowMs);
    if (date < today) throw E('지난 날짜는 과거 기록 정정으로 바꿔 주세요');
    var n = 0;
    s.marks.forEach(function (m) { if (m.kid === kidId && m.date === date && m.kind === kind && m.active) { m.active = false; m.cancelledAt = nowMs; n++; } });
    return { n: n };
  }

  function pay(s, kidId, amount, date, memo, reqId, nowMs) {
    if (once(s, reqId)) return { duplicate: true };
    getKid(s, kidId);
    if (!isFinite(amount) || Math.floor(amount) !== amount || amount <= 0) throw E('지급 금액을 올바르게 입력해 주세요');
    var m = money(s, kidId);
    if (amount > m.payable) throw E('지금 지급할 수 있는 금액은 ' + m.payable.toLocaleString('ko-KR') + '원이에요');
    var p = { id: uid(s, 'p'), kid: kidId, amount: amount, date: date, memo: memo || '', kind: 'pay', targetId: null, at: nowMs };
    s.payments.push(p);
    return p;
  }
  function cancelPay(s, payId, reason, reqId, nowMs) {
    if (once(s, reqId)) return { duplicate: true };
    var p = s.payments.filter(function (x) { return x.id === payId && x.kind === 'pay'; })[0];
    if (!p) throw E('취소할 지급 기록이 없어요');
    if (payCancelled(s, payId)) throw E('이미 취소된 지급이에요');
    if (!reason || !reason.trim()) throw E('취소 이유를 적어 주세요');
    s.payments.push({ id: uid(s, 'p'), kid: p.kid, amount: p.amount, date: kstDate(nowMs), memo: '', reason: reason.trim(), kind: 'cancel', targetId: payId, at: nowMs });
    return {};
  }

  // ---------- 과거 정정 (10절) ----------
  // p: {kid,date,mode:'success'|'fail'|'rest'|'normal', count,hw,noHw,reason}
  function applyCorrection(s, p, nowMs) {
    tick(s, nowMs);
    var today = viewToday(s, nowMs), kid = getKid(s, p.kid);
    if (!p.reason || !p.reason.trim()) throw E('수정 이유를 적어 주세요');
    if (p.date < kid.startDate || p.date > today) throw E('정정할 수 없는 날짜예요');
    var beforeRow = computeKid(s, p.kid, today).rows.filter(function (r) { return r.date === p.date; })[0];
    function voidSubs(why) {
      s.subs.forEach(function (x) { if (x.kid === p.kid && x.date === p.date && (x.status === 'valid' || x.status === 'approved')) { x.status = 'voided'; x.voidReason = why; } });
    }
    if (p.mode === 'rest') {
      if (!hasMark(s, p.kid, p.date, 'rest')) s.marks.push({ id: uid(s, 'm'), kid: p.kid, date: p.date, kind: 'rest', reason: p.reason, at: nowMs, active: true });
      voidSubs('정정: 쉬는 날');
    } else {
      s.marks.forEach(function (m) { if (m.kid === p.kid && m.date === p.date && m.kind === 'rest' && m.active) { m.active = false; m.cancelledAt = nowMs; } });
    }
    if (p.noHw !== undefined) {
      if (p.noHw && !hasMark(s, p.kid, p.date, 'nohw')) s.marks.push({ id: uid(s, 'm'), kid: p.kid, date: p.date, kind: 'nohw', reason: p.reason, at: nowMs, active: true });
      if (!p.noHw) s.marks.forEach(function (m) { if (m.kid === p.kid && m.date === p.date && m.kind === 'nohw' && m.active) { m.active = false; m.cancelledAt = nowMs; } });
    }
    if (p.mode === 'success') {
      var cnt = Number(p.count);
      if (!isFinite(cnt) || Math.floor(cnt) !== cnt || cnt < 0) throw E('개수는 0 이상의 정수여야 해요');
      voidSubs('정정: 성공 인정');
      s.subs.push({ id: uid(s, 's'), kid: p.kid, date: p.date, count: cnt, hw: !!p.hw, noHw: !!p.noHw, target: null, estimated: false, at: nowMs, anomaly: false, status: 'approved', approvedAt: nowMs, source: 'correction', ruleVersion: RULE_VERSION });
    } else if (p.mode === 'fail') {
      voidSubs('정정: 실패');
    }
    s.audit.push({ id: uid(s, 'a'), at: nowMs, kid: p.kid, date: p.date, type: 'correction', mode: p.mode, reason: p.reason.trim(), before: beforeRow ? { status: beforeRow.status, count: beforeRow.count, reward: beforeRow.reward } : null, after: { mode: p.mode, count: p.count, hw: !!p.hw } });
    var added = reconcile(s, p.kid, today, 'adjust', nowMs);
    return { added: added };
  }
  function applyStartDate(s, kidId, newDate, reason, nowMs) {
    tick(s, nowMs);
    if (!reason || !reason.trim()) throw E('변경 이유를 적어 주세요');
    var kid = getKid(s, kidId), old = kid.startDate;
    kid.startDate = newDate;
    s.audit.push({ id: uid(s, 'a'), at: nowMs, kid: kidId, date: newDate, type: 'startDate', reason: reason.trim(), before: { startDate: old }, after: { startDate: newDate } });
    return { added: reconcile(s, kidId, viewToday(s, nowMs), 'adjust', nowMs) };
  }

  // 첫 설정: 어제까지 streak일 연속 성공한 상태로 시작 (시작 날짜 = 어제 − (streak−1))
  function seedHistory(s, kidId, streak, nowMs) {
    var kid = getKid(s, kidId), today = kstDate(nowMs), yesterday = addDays(today, -1);
    if (!isFinite(streak) || Math.floor(streak) !== streak || streak < 0 || streak > 3650) throw E('연속 성공일수를 확인해 주세요');
    kid.startDate = streak ? addDays(yesterday, -(streak - 1)) : today;
    for (var i = 1; i <= streak; i++) {
      s.subs.push({ id: uid(s, 's'), kid: kidId, date: addDays(kid.startDate, i - 1), count: goalFor(i), hw: true, noHw: false, target: goalFor(i), estimated: false, at: nowMs, anomaly: false, status: 'approved', approvedAt: nowMs, source: 'initial', ruleVersion: RULE_VERSION });
    }
    if (streak) s.audit.push({ id: uid(s, 'a'), at: nowMs, kid: kidId, date: yesterday, type: 'seed', reason: '첫 설정: 어제 기준 ' + streak + '일 연속 성공', before: null, after: { streak: streak } });
    return reconcile(s, kidId, today, 'adjust', nowMs);
  }

  // 미리보기: 복사본에 적용하여 변경 전후를 비교
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function preview(s, kidId, nowMs, mutator) {
    var today = viewToday(s, nowMs);
    var b = computeKid(s, kidId, today), mb = money(s, kidId);
    var c = clone(s); mutator(c);
    var a = computeKid(c, kidId, today), ma = money(c, kidId);
    var map = {};
    b.rows.forEach(function (r) { map[r.date] = { b: r }; });
    a.rows.forEach(function (r) { (map[r.date] = map[r.date] || {}).a = r; });
    var changes = [];
    Object.keys(map).sort().forEach(function (d) {
      var x = map[d].b, y = map[d].a;
      function key(r) { return r ? [r.status, r.target, r.streakE, r.reward, r.expReward].join('|') : '-'; }
      if (key(x) !== key(y)) changes.push({ date: d, before: x || null, after: y || null });
    });
    return { changes: changes, moneyBefore: mb, moneyAfter: ma, pendingAfter: a.pendingRows };
  }

  // 백업 검증: 재계산 결과와 장부가 일치하는지
  function verify(s, nowMs) {
    var today = kstDate(nowMs);
    return s.kids.every(function (k) {
      var info = computeKid(s, k.id, today), byDate = {};
      s.rewards.forEach(function (r) { if (r.kid === k.id) byDate[r.date] = (byDate[r.date] || 0) + r.amount; });
      return info.rows.every(function (r) { return !r.confirmed || (byDate[r.date] || 0) === (r.reward || 0); });
    });
  }

  var api = {
    kstDate: kstDate, addDays: addDays, daysBetween: daysBetween, goalFor: goalFor, rewardFor: rewardFor,
    newState: newState, computeKid: computeKid, money: money, payCancelled: payCancelled, reconcile: reconcile,
    tick: tick, clockBlocked: clockBlocked, viewToday: viewToday,
    setDraft: setDraft, submit: submit, approve: approve, reject: reject,
    setMark: setMark, cancelMark: cancelMark, pay: pay, cancelPay: cancelPay,
    seedHistory: seedHistory, applyCorrection: applyCorrection, applyStartDate: applyStartDate, preview: preview, clone: clone, verify: verify,
    hasMark: hasMark, uid: uid, RULE_VERSION: RULE_VERSION
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof window !== 'undefined' ? window : this);
