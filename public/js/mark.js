(function(){
  'use strict';

  // Public, unauthenticated page — this is the link shared with whoever is
  // marking attendance on-site. No admin login involved here.

  // ---------------- state ----------------
  var candidates = [];
  var sessions = [];
  var attendanceForSession = []; // trimmed: {candidateId, status, markedAt, withinRadius}
  var selectedSessionId = null;
  var pendingMark = null; // {candidateId, sessionId, photoBlob}

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

  function getLocationWithTimeout(timeoutMs){
    return new Promise(function(resolve){
      if (!('geolocation' in navigator)){ resolve(null); return; }
      var settled = false;
      var timer = setTimeout(function(){
        if (!settled){ settled = true; resolve(null); }
      }, timeoutMs);
      try{
        navigator.geolocation.getCurrentPosition(
          function(pos){
            if (settled) return;
            settled = true; clearTimeout(timer);
            resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          },
          function(){
            if (settled) return;
            settled = true; clearTimeout(timer);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
        );
      }catch(e){
        if (!settled){ settled = true; clearTimeout(timer); resolve(null); }
      }
    });
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
      sessions = data || [];
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
    var sel = $('mark-session-select');
    if (!sessions.length){
      sel.innerHTML = '<option value="">No sessions yet</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
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
    if (!s){ el.innerHTML = ''; return; }
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
      wrap.innerHTML = '<div class="empty-state">No sessions have been set up yet — check back once one is added.</div>';
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
    if (!selectedSessionId){ showToast('Select a session first.', 'error'); return; }
    var c = candidates.find(function(x){ return x._id === candidateId; });
    window.openCamera('Photo — ' + (c ? c.name : ''), function(blob){
      pendingMark = { candidateId: candidateId, sessionId: selectedSessionId, photoBlob: blob };
      openLocationStep(c);
    });
  }

  function openLocationStep(candidate){
    $('locationModalName').textContent = 'Confirm present — ' + (candidate ? candidate.name : '');
    var previewUrl = URL.createObjectURL(pendingMark.photoBlob);
    $('locPhotoPreview').innerHTML = '<img src="' + previewUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">';
    $('locLocText').value = '';
    $('locLat').value = '';
    $('locLng').value = '';
    $('locLocStatus').textContent = 'Detecting your location…';
    $('locationOverlay').hidden = false;
    attemptLocation();
  }
  function closeLocationStep(){
    $('locationOverlay').hidden = true;
    pendingMark = null;
  }
  function attemptLocation(){
    $('locLocStatus').textContent = 'Detecting your location…';
    getLocationWithTimeout(9000).then(function(loc){
      if (!pendingMark) return;
      if (loc){
        $('locLat').value = loc.lat.toFixed(6);
        $('locLng').value = loc.lng.toFixed(6);
        $('locLocStatus').textContent = 'Location captured automatically. You can adjust it below.';
      } else {
        $('locLocStatus').textContent = "Couldn't detect automatically — enter it below if you'd like to record it.";
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

    var fd = new FormData();
    fd.append('sessionId', pendingMark.sessionId);
    fd.append('candidateId', pendingMark.candidateId);
    fd.append('locLat', $('locLat').value);
    fd.append('locLng', $('locLng').value);
    fd.append('locText', $('locLocText').value.trim());
    fd.append('photo', pendingMark.photoBlob, 'attendance.jpg');

    apiForm('/attendance/present', 'POST', fd).then(function(){
      showToast('Marked present.');
      closeLocationStep();
      return refreshAttendanceOnly();
    }).catch(function(err){
      showToast('Could not save: ' + err.message, 'error');
    }).then(function(){
      btn.disabled = false;
      btn.textContent = 'Mark present';
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
