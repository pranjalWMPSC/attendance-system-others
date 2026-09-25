(function(){
  'use strict';

  // Public, unauthenticated page — this is the link shared with whoever is
  // marking attendance on-site. No admin login involved here.

  // ---------------- state ----------------
  var candidates = [];
  var sessions = []; // filtered to today's date only — see loadSessions()
  var attendanceForSession = []; // trimmed: {candidateId, status, markedAt, withinRadius}
  var selectedSessionId = null;
  var pendingMark = null; // {candidateId, sessionId, photoBlob, location: {lat,lng,accuracy}|null}
  var pendingFeedback = null; // {sessionId, candidateId}

  // ---------------- helpers ----------------
  function $(id){ return document.getElementById(id); }
  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function initials(name){
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var a = parts[0][0] || '';
    var b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }
  function todayISO(){
    var d = new Date();
    var tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
  }
  function fmtDate(iso){
    try{
      var dt = new Date(iso + 'T00:00:00');
      return dt.toLocaleDateString(undefined, {day:'2-digit', month:'short', year:'numeric'});
    }catch(e){ return iso; }
  }
  function fmtTimeRange(s, e){ return (s || '') + '–' + (e || ''); }
  function sessionLabel(s){
    return fmtDate(s.date) + ' · ' + fmtTimeRange(s.startTime, s.endTime) + ' · ' + (s.venueName || 'Venue TBC');
  }
  function isNum(v){ return typeof v === 'number' && isFinite(v); }

  // Auto-only geolocation — no manual entry anywhere in this flow. Resolves
  // {ok:true, lat, lng, accuracy} on success, or {ok:false, reason} so the UI
  // can show a specific message and a retry (never a way to type a location
  // in — the whole point is that it matches the device's real position).
  function getLocationDetailed(timeoutMs){
    return new Promise(function(resolve){
      if (!('geolocation' in navigator)){ resolve({ ok: false, reason: 'unsupported' }); return; }
      var settled = false;
      var timer = setTimeout(function(){
        if (!settled){ settled = true; resolve({ ok: false, reason: 'timeout' }); }
      }, timeoutMs);
      try{
        navigator.geolocation.getCurrentPosition(
          function(pos){
            if (settled) return;
            settled = true; clearTimeout(timer);
            resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
          },
          function(err){
            if (settled) return;
            settled = true; clearTimeout(timer);
            var reason = 'unavailable';
            if (err && err.code === 1) reason = 'denied';
            else if (err && err.code === 3) reason = 'timeout';
            resolve({ ok: false, reason: reason });
          },
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
        );
      }catch(e){
        if (!settled){ settled = true; clearTimeout(timer); resolve({ ok: false, reason: 'unavailable' }); }
      }
    });
  }
  function locationErrorMessage(reason){
    // Location is optional — none of these block marking present, they just
    // explain why no location will be attached this time.
    if (reason === 'denied') return "Location permission was denied — marking present without a location. Try again if you'd like to allow it.";
    if (reason === 'timeout') return "Couldn't get a location fix in time — marking present without a location. Try again if you'd like to retry.";
    if (reason === 'unsupported') return "This browser can't provide location access here — marking present without a location.";
    return "Location isn't available right now — marking present without a location. Try again if you'd like to retry.";
  }

  var toastTimer = null;
  function showToast(msg, kind){
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.hidden = true; }, 3200);
  }

  var confirmResolver = null;
  function showConfirm(title, message){
    return new Promise(function(resolve){
      confirmResolver = resolve;
      $('confirmTitle').textContent = title;
      $('confirmMessage').textContent = message;
      $('confirmOverlay').hidden = false;
    });
  }
  function resolveConfirm(val){
    $('confirmOverlay').hidden = true;
    var r = confirmResolver; confirmResolver = null;
    if (r) r(val);
  }

  // ---------------- API helpers (no auth — public endpoints) ----------------
  function api(path, opts){
    opts = opts || {};
    return fetch('/api' + path, opts).then(function(res){
      return res.json().then(function(data){
        if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
        return data;
      });
    });
  }
  function apiJSON(path, method, body){
    return api(path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }
  function apiForm(path, method, formData){
    return api(path, { method: method, body: formData });
  }

  // ---------------- data loading ----------------
  function loadCandidates(){
    return api('/candidates').then(function(data){
      candidates = data || [];
      candidates.sort(function(a, b){ return (a.name || '').localeCompare(b.name || ''); });
    });
  }
  function loadSessions(){
    return api('/sessions').then(function(data){
      var today = todayISO();
      // Attendance can only ever be marked for today's class(es) — a session
      // for any other date simply doesn't show up here.
      sessions = (data || []).filter(function(s){ return s.date === today; });
      if (!selectedSessionId && sessions.length) selectedSessionId = sessions[0]._id;
      if (selectedSessionId && !sessions.some(function(s){ return s._id === selectedSessionId; })){
        selectedSessionId = sessions.length ? sessions[0]._id : null;
      }
    });
  }
  function loadAttendance(){
    if (!selectedSessionId){ attendanceForSession = []; return Promise.resolve(); }
    return api('/attendance/session/' + selectedSessionId).then(function(data){
      attendanceForSession = data || [];
    });
  }
  function refreshAll(){
    return Promise.all([loadCandidates(), loadSessions()])
      .then(loadAttendance)
      .then(renderAll)
      .catch(function(err){ showToast(err.message, 'error'); });
  }
  function refreshAttendanceOnly(){
    return loadAttendance().then(renderAll).catch(function(err){ showToast(err.message, 'error'); });
  }

  function attendanceFor(candidateId){
    for (var i = 0; i < attendanceForSession.length; i++){
      if (attendanceForSession[i].candidateId === candidateId) return attendanceForSession[i];
    }
    return null;
  }
  function statusOf(candidateId){
    var a = attendanceFor(candidateId);
    if (!a) return 'unmarked';
    return a.status === 'present' ? 'present' : (a.status === 'absent' ? 'absent' : 'unmarked');
  }

  // ---------------- render ----------------
  function renderAll(){
    renderSessionSelect();
    renderSessionInfo();
    renderMarkList();
    renderStats();
  }

  function renderSessionSelect(){
    var picker = $('mark-session-picker');
    var sel = $('mark-session-select');
    // The picker (dropdown) only needs to exist at all when there's more
    // than one session today — with zero or one, there's nothing to choose.
    if (sessions.length <= 1){
      picker.hidden = true;
      return;
    }
    picker.hidden = false;
    sel.innerHTML = sessions.map(function(s){
      return '<option value="' + s._id + '"' + (s._id === selectedSessionId ? ' selected' : '') + '>' +
        escapeHtml(sessionLabel(s)) + '</option>';
    }).join('');
  }
  $('mark-session-select').addEventListener('change', function(){
    selectedSessionId = this.value || null;
    refreshAttendanceOnly();
  });

  function currentSession(){
    for (var i = 0; i < sessions.length; i++){ if (sessions[i]._id === selectedSessionId) return sessions[i]; }
    return null;
  }
  function renderSessionInfo(){
    var el = $('mark-session-info');
    var s = currentSession();
    if (!s){
      el.innerHTML = '<span>Today, ' + escapeHtml(fmtDate(todayISO())) + '</span>';
      return;
    }
    var loc = isNum(s.venueLat) && isNum(s.venueLng)
      ? s.venueLat.toFixed(4) + ', ' + s.venueLng.toFixed(4)
      : 'not set';
    el.innerHTML =
      '<span>' + escapeHtml(fmtTimeRange(s.startTime, s.endTime)) + '</span>' +
      '<span>' + escapeHtml(s.venueName || '') + '</span>' +
      '<span class="mono">Venue: ' + loc + '</span>' +
      '<span>Radius ' + (s.radiusM != null ? s.radiusM : 300) + ' m</span>';
  }

  function renderMarkList(){
    var wrap = $('markList');
    if (!sessions.length){
      wrap.innerHTML = '<div class="empty-state">No class session is scheduled for today — check back on the day of your class.</div>';
      return;
    }
    if (!candidates.length){
      wrap.innerHTML = '<div class="empty-state">No candidates in the roster yet.</div>';
      return;
    }
    wrap.innerHTML = candidates.map(function(c){
      var a = attendanceFor(c._id);
      var status = statusOf(c._id);
      var av = c.photoUrl
        ? '<img class="avatar" src="' + c.photoUrl + '" alt="">'
        : '<span class="avatar">' + escapeHtml(initials(c.name)) + '</span>';
      var pill = '<span class="pill pill-muted">Not marked</span>';
      if (status === 'present'){
        pill = '<span class="pill pill-good">Present</span>';
        if (a && a.withinRadius === false) pill += ' <span class="pill pill-warning">Off-site</span>';
      } else if (status === 'absent'){
        pill = '<span class="pill pill-critical">Absent</span>';
      }
      return (
        '<div class="row-card">' +
          av +
          '<div class="row-main">' +
            '<div class="row-title">' + escapeHtml(c.name) + '</div>' +
            '<div class="row-sub">' + pill + '</div>' +
          '</div>' +
          '<div class="row-actions">' +
            '<button type="button" class="btn btn-primary btn-sm btn-mark-present" data-id="' + c._id + '">Present</button>' +
            '<button type="button" class="btn btn-danger btn-sm btn-mark-absent" data-id="' + c._id + '">Absent</button>' +
            (status !== 'unmarked' ? '<button type="button" class="btn btn-ghost btn-sm btn-mark-clear" data-id="' + c._id + '">Clear</button>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderStats(){
    var el = $('mark-stats');
    var present = 0, absent = 0;
    candidates.forEach(function(c){
      var st = statusOf(c._id);
      if (st === 'present') present++; else if (st === 'absent') absent++;
    });
    var total = candidates.length;
    var unmarked = Math.max(0, total - present - absent);
    var rate = total ? Math.round((present / total) * 100) : 0;
    el.innerHTML =
      '<div class="stat-tile good"><span class="stat-value">' + present + '</span><span class="stat-label">Present</span></div>' +
      '<div class="stat-tile critical"><span class="stat-value">' + absent + '</span><span class="stat-label">Absent</span></div>' +
      '<div class="stat-tile"><span class="stat-value">' + unmarked + '</span><span class="stat-label">Not marked</span></div>' +
      '<div class="stat-tile accent"><span class="stat-value">' + rate + '%</span><span class="stat-label">Attendance</span></div>';
  }

  // ---------------- present / absent / clear ----------------
  document.addEventListener('click', function(e){
    var pBtn = e.target.closest('.btn-mark-present');
    if (pBtn){ startPresentFlow(pBtn.getAttribute('data-id')); return; }
    var aBtn = e.target.closest('.btn-mark-absent');
    if (aBtn){ markAbsent(aBtn.getAttribute('data-id')); return; }
    var cBtn = e.target.closest('.btn-mark-clear');
    if (cBtn){ clearMark(cBtn.getAttribute('data-id')); return; }
  });

  function markAbsent(candidateId){
    if (!selectedSessionId) return;
    apiJSON('/attendance/absent', 'POST', { sessionId: selectedSessionId, candidateId: candidateId })
      .then(function(){ showToast('Marked absent.'); return refreshAttendanceOnly(); })
      .catch(function(err){ showToast('Could not save: ' + err.message, 'error'); });
  }
  function clearMark(candidateId){
    if (!selectedSessionId) return;
    showConfirm('Clear mark?', 'This candidate will go back to "Not marked" for this session.').then(function(ok){
      if (!ok) return;
      api('/attendance/' + selectedSessionId + '/' + candidateId, { method: 'DELETE' })
        .then(function(){ showToast('Cleared.'); return refreshAttendanceOnly(); })
        .catch(function(err){ showToast('Could not clear: ' + err.message, 'error'); });
    });
  }

  function startPresentFlow(candidateId){
    if (!selectedSessionId){ showToast('No session available today.', 'error'); return; }
    var c = candidates.find(function(x){ return x._id === candidateId; });
    window.openCamera('Photo — ' + (c ? c.name : ''), function(blob){
      pendingMark = { candidateId: candidateId, sessionId: selectedSessionId, photoBlob: blob, location: null };
      openLocationStep(c);
    });
  }

  // -------- location step: loading → captured (read-only) → confirm --------
  function openLocationStep(candidate){
    $('locationModalName').textContent = 'Confirm present — ' + (candidate ? candidate.name : '');
    var previewUrl = URL.createObjectURL(pendingMark.photoBlob);
    $('locPhotoPreview').innerHTML = '<img src="' + previewUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">';
    $('locationOverlay').hidden = false;
    attemptLocation();
  }
  function closeLocationStep(){
    $('locationOverlay').hidden = true;
    pendingMark = null;
  }
  function setLocationUI(state){
    // Purely informational — location is optional, so none of these states
    // gate the "Mark present" button. Attendance can be marked from
    // anywhere, with or without a captured location.
    $('locLoading').hidden = state !== 'loading';
    $('locResult').hidden = state !== 'result';
    $('locError').hidden = state !== 'error';
  }
  function attemptLocation(){
    if (!pendingMark) return;
    setLocationUI('loading');
    getLocationDetailed(9000).then(function(res){
      if (!pendingMark) return; // modal was closed while we were waiting
      if (res.ok){
        pendingMark.location = { lat: res.lat, lng: res.lng, accuracy: res.accuracy };
        $('locCoords').textContent = res.lat.toFixed(6) + ', ' + res.lng.toFixed(6);
        $('locAccuracy').textContent = isNum(res.accuracy) ? ('Accuracy ±' + Math.round(res.accuracy) + ' m') : '';
        setLocationUI('result');
      } else {
        pendingMark.location = null;
        $('locErrorMsg').textContent = locationErrorMessage(res.reason);
        setLocationUI('error');
      }
    });
  }
  $('locationModalClose').addEventListener('click', closeLocationStep);
  $('locCancel').addEventListener('click', closeLocationStep);
  $('locRetryLoc').addEventListener('click', attemptLocation);
  $('locConfirm').addEventListener('click', function(){
    if (!pendingMark) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    var mark = pendingMark;
    var fd = new FormData();
    fd.append('sessionId', mark.sessionId);
    fd.append('candidateId', mark.candidateId);
    // Location is optional — only sent when it was actually captured, so
    // attendance can still be marked present from anywhere.
    if (mark.location){
      fd.append('locLat', mark.location.lat);
      fd.append('locLng', mark.location.lng);
    }
    fd.append('photo', mark.photoBlob, 'attendance.jpg');

    apiForm('/attendance/present', 'POST', fd).then(function(){
      showToast('Marked present.');
      closeLocationStep();
      return refreshAttendanceOnly().then(function(){
        return maybeAskFeedback(mark.sessionId, mark.candidateId);
      });
    }).catch(function(err){
      showToast('Could not save: ' + err.message, 'error');
    }).then(function(){
      btn.disabled = false;
      btn.textContent = 'Mark present';
    });
  });

  // -------- feedback step: shown once, right after a successful present mark --------
  function maybeAskFeedback(sessionId, candidateId){
    return api('/feedback/status/' + sessionId + '/' + candidateId).then(function(d){
      if (d && !d.submitted) openFeedbackStep(sessionId, candidateId);
    }).catch(function(){ /* non-fatal — attendance is already saved either way */ });
  }
  function resetFeedbackForm(){
    document.querySelectorAll('#fb-overall button, #fb-interaction button, #fb-recommend button').forEach(function(b){
      b.classList.remove('active');
    });
    $('fb-learned').value = '';
    $('fb-topic').value = '';
    $('fb-improve').value = '';
  }
  function openFeedbackStep(sessionId, candidateId){
    pendingFeedback = { sessionId: sessionId, candidateId: candidateId };
    resetFeedbackForm();
    $('feedbackOverlay').hidden = false;
  }
  function closeFeedbackStep(){
    $('feedbackOverlay').hidden = true;
    pendingFeedback = null;
  }
  document.querySelectorAll('.rate-picker, .choice-picker').forEach(function(group){
    group.addEventListener('click', function(e){
      var btn = e.target.closest('button');
      if (!btn) return;
      group.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b === btn); });
    });
  });
  $('feedbackModalClose').addEventListener('click', closeFeedbackStep);
  $('feedbackSkip').addEventListener('click', closeFeedbackStep);
  $('feedbackSubmit').addEventListener('click', function(){
    if (!pendingFeedback) return;
    var overallBtn = document.querySelector('#fb-overall button.active');
    var interactionBtn = document.querySelector('#fb-interaction button.active');
    var recommendBtn = document.querySelector('#fb-recommend button.active');
    var learned = $('fb-learned').value.trim();
    if (!overallBtn || !interactionBtn){ showToast('Please answer both rating questions.', 'error'); return; }
    if (!learned){ showToast('Please share what you learned.', 'error'); return; }
    if (!recommendBtn){ showToast('Please answer the recommend question.', 'error'); return; }

    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    apiJSON('/feedback', 'POST', {
      sessionId: pendingFeedback.sessionId,
      candidateId: pendingFeedback.candidateId,
      overall: overallBtn.getAttribute('data-value'),
      interaction: interactionBtn.getAttribute('data-value'),
      learned: learned,
      topic: $('fb-topic').value.trim(),
      improve: $('fb-improve').value.trim(),
      recommend: recommendBtn.getAttribute('data-value')
    }).then(function(){
      showToast('Thanks for the feedback!');
      closeFeedbackStep();
    }).catch(function(err){
      showToast('Could not submit: ' + err.message, 'error');
    }).then(function(){
      btn.disabled = false;
      btn.textContent = 'Submit feedback';
    });
  });

  // ---------------- confirm modal wiring ----------------
  $('confirmYes').addEventListener('click', function(){ resolveConfirm(true); });
  $('confirmNo').addEventListener('click', function(){ resolveConfirm(false); });

  // ---------------- boot ----------------
  $('dbStatus').textContent = 'Loading…';
  refreshAll().then(function(){
    $('dbStatus').textContent = 'Ready';
    $('dbStatus').className = 'brand-sub ok';
  });
})();
