(function(){
  'use strict';

  // ---------------- state ----------------
  var candidates = [];
  var sessions = [];
  var activeTab = 'sessions';
  var pendingEnrollPhotoBlob = null;
  var selectedReportSessionId = null;
  var sessionMode = 'range';
  var pickedDates = [];

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
  function pad2(n){ return n < 10 ? '0' + n : '' + n; }
  function dateToISO(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtDate(iso){
    try{
      var dt = new Date(iso + 'T00:00:00');
      return dt.toLocaleDateString(undefined, {day:'2-digit', month:'short', year:'numeric'});
    }catch(e){ return iso; }
  }
  function fmtDateTime(iso){
    if (!iso) return '—';
    try{
      var dt = new Date(iso);
      return dt.toLocaleString(undefined, {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
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

  // ---------------- API helpers ----------------
  function api(path, opts){
    opts = opts || {};
    return fetch('/api' + path, opts).then(function(res){
      if (res.status === 401){
        window.location.href = '/login.html';
        return Promise.reject(new Error('Not signed in'));
      }
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
    return api('/candidates').then(function(data){ candidates = data || []; });
  }
  function loadSessions(){
    return api('/sessions').then(function(data){ sessions = data || []; });
  }
  function refreshAll(){
    return Promise.all([loadCandidates(), loadSessions()])
      .then(function(){
        renderSessionsList();
        renderCandidatesList();
        return loadReportsSummary();
      })
      .catch(function(err){ showToast(err.message, 'error'); });
  }

  // ---------------- tabs ----------------
  function setActiveTab(tab){
    activeTab = tab;
    document.querySelectorAll('.tab').forEach(function(btn){
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    ['sessions','roster','reports'].forEach(function(name){
      $('panel-' + name).classList.toggle('hidden', name !== tab);
    });
    if (tab === 'reports') loadReportsSummary();
  }
  $('tabs').addEventListener('click', function(e){
    var btn = e.target.closest('.tab');
    if (!btn) return;
    setActiveTab(btn.getAttribute('data-tab'));
  });

  // ---------------- share link ----------------
  function initShareLink(){
    var url = window.location.origin + '/mark.html';
    $('shareUrl').textContent = url;
    $('copyShareUrl').addEventListener('click', function(){
      var done = function(){ showToast('Link copied.'); };
      var fallback = function(){
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { showToast('Could not copy — select and copy the link manually.', 'error'); }
        document.body.removeChild(ta);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  // ---------------- sessions ----------------
  function renderSessionsList(){
    var batchWrap = $('sessionBatches');
    var wrap = $('sessionsList');

    var batches = {};
    var batchOrder = [];
    sessions.forEach(function(s){
      if (!s.batchId) return;
      if (!batches[s.batchId]){ batches[s.batchId] = { label: s.batchLabel, items: [] }; batchOrder.push(s.batchId); }
      batches[s.batchId].items.push(s);
    });

    if (!batchOrder.length){
      batchWrap.innerHTML = '';
    } else {
      batchWrap.innerHTML = batchOrder.map(function(bid){
        var b = batches[bid];
        var items = b.items.slice().sort(function(a, c){ return a.date < c.date ? -1 : 1; });
        var first = items[0], last = items[items.length - 1];
        var range = items.length > 1 ? fmtDate(first.date) + ' – ' + fmtDate(last.date) : fmtDate(first.date);
        return (
          '<div class="row-card batch-card" data-batch-id="' + bid + '">' +
            '<div class="row-main">' +
              '<div class="row-title">' + escapeHtml(b.label || 'Class') + '</div>' +
              '<div class="row-sub">' + items.length + ' sessions · ' + escapeHtml(range) + ' · ' + escapeHtml(fmtTimeRange(first.startTime, first.endTime)) + ' · ' + escapeHtml(first.venueName || 'Venue TBC') + '</div>' +
            '</div>' +
            '<div class="row-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm btn-del-batch" data-batch-id="' + bid + '">Delete class</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    if (!sessions.length){
      wrap.innerHTML = '<div class="empty-state">No sessions yet — create the first class above.</div>';
      return;
    }
    var sorted = sessions.slice().sort(function(a, b){ return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    wrap.innerHTML = sorted.map(function(s){
      var loc = isNum(s.venueLat) && isNum(s.venueLng)
        ? '<span class="mono">' + s.venueLat.toFixed(4) + ', ' + s.venueLng.toFixed(4) + '</span>'
        : '<span>No coordinates set</span>';
      return (
        '<div class="row-card session-row" data-session-id="' + s._id + '">' +
          '<div class="session-top">' +
            '<div>' +
              '<div class="session-title">' + escapeHtml(sessionLabel(s)) +
                (s.batchId ? ' <span class="badge">' + escapeHtml(s.batchLabel || 'Class') + '</span>' : '') +
              '</div>' +
              '<div class="session-meta">' +
                (s.venueAddress ? '<span>' + escapeHtml(s.venueAddress) + '</span>' : '') +
                '<span>' + loc + '</span>' +
                '<span>Radius ' + (s.radiusM != null ? s.radiusM : 300) + ' m</span>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="icon-btn btn-del-session" data-id="' + s._id + '" aria-label="Delete session">&times;</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  // -------- class-creation form: range / specific-dates modes --------
  function computeRangeDates(){
    var startStr = $('sf-range-start').value;
    var endStr = $('sf-range-end').value;
    if (!startStr || !endStr) return [];
    var start = new Date(startStr + 'T00:00:00');
    var end = new Date(endStr + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || end < start) return [];
    var allowed = {};
    document.querySelectorAll('#sf-weekdays input[type=checkbox]').forEach(function(cb){ if (cb.checked) allowed[cb.value] = true; });
    var out = [];
    var cur = new Date(start);
    var guard = 0;
    while (cur <= end && guard < 3660){
      guard++;
      if (allowed[String(cur.getDay())]) out.push(dateToISO(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }
  function selectedDates(){
    return sessionMode === 'range' ? computeRangeDates() : pickedDates.slice().sort();
  }
  function updateSessionPreview(){
    var dates = selectedDates();
    var el = $('sf-preview');
    if (!dates.length){ el.textContent = 'Pick at least one date.'; return; }
    if (dates.length === 1){ el.textContent = 'This creates 1 session, on ' + fmtDate(dates[0]) + '.'; return; }
    var shown = dates.slice(0, 6).map(fmtDate).join(', ');
    var more = dates.length > 6 ? ' and ' + (dates.length - 6) + ' more' : '';
    el.textContent = 'This creates ' + dates.length + ' sessions: ' + shown + more + '.';
  }
  function renderDateChips(){
    var wrap = $('sf-date-chips');
    var sorted = pickedDates.slice().sort();
    if (!sorted.length){ wrap.innerHTML = '<span class="hint">No dates added yet.</span>'; return; }
    wrap.innerHTML = sorted.map(function(d){
      return '<span class="date-chip">' + escapeHtml(fmtDate(d)) + '<button type="button" class="chip-remove" data-date="' + d + '" aria-label="Remove date">&times;</button></span>';
    }).join('');
  }

  $('sf-range-start').value = todayISO();
  $('sf-range-end').value = todayISO();
  renderDateChips();
  updateSessionPreview();

  $('sf-mode-toggle').addEventListener('click', function(e){
    var btn = e.target.closest('.mode-btn');
    if (!btn) return;
    sessionMode = btn.getAttribute('data-mode');
    document.querySelectorAll('#sf-mode-toggle .mode-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
    $('sf-mode-range').hidden = sessionMode !== 'range';
    $('sf-mode-specific').hidden = sessionMode !== 'specific';
    updateSessionPreview();
  });
  $('sf-range-start').addEventListener('change', updateSessionPreview);
  $('sf-range-end').addEventListener('change', updateSessionPreview);
  $('sf-weekdays').addEventListener('change', updateSessionPreview);
  $('sf-pick-add').addEventListener('click', function(){
    var v = $('sf-pick-date').value;
    if (!v) return;
    if (pickedDates.indexOf(v) === -1) pickedDates.push(v);
    $('sf-pick-date').value = '';
    renderDateChips();
    updateSessionPreview();
  });
  $('sf-date-chips').addEventListener('click', function(e){
    var btn = e.target.closest('.chip-remove');
    if (!btn) return;
    var d = btn.getAttribute('data-date');
    pickedDates = pickedDates.filter(function(x){ return x !== d; });
    renderDateChips();
    updateSessionPreview();
  });

  $('sf-uselocation').addEventListener('click', function(){
    var btn = this;
    var status = $('sf-locstatus');
    btn.disabled = true;
    status.textContent = 'Detecting…';
    getLocationWithTimeout(9000).then(function(loc){
      btn.disabled = false;
      if (loc){
        $('sf-lat').value = loc.lat.toFixed(6);
        $('sf-lng').value = loc.lng.toFixed(6);
        status.textContent = 'Location captured.';
      } else {
        status.textContent = "Couldn't detect automatically — enter coordinates manually, or allow location access for this site.";
      }
    });
  });
  $('sessionForm').addEventListener('submit', function(e){
    e.preventDefault();
    var dates = selectedDates();
    if (!dates.length){ showToast('Pick at least one date.', 'error'); return; }
    var submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    apiJSON('/sessions/batch', 'POST', {
      label: $('sf-label').value.trim(),
      dates: dates,
      startTime: $('sf-start').value,
      endTime: $('sf-end').value,
      venueName: $('sf-venue').value.trim(),
      venueAddress: $('sf-address').value.trim(),
      venueLat: $('sf-lat').value,
      venueLng: $('sf-lng').value,
      radiusM: $('sf-radius').value
    }).then(function(result){
      var createdCount = (result.created || []).length;
      var skippedCount = (result.skippedDates || []).length;
      var msg = createdCount === 1 ? '1 session created.' : createdCount + ' sessions created.';
      if (skippedCount) msg += ' ' + skippedCount + ' date' + (skippedCount === 1 ? '' : 's') + ' skipped (already had a session at that time/venue).';
      showToast(msg, createdCount ? undefined : 'error');
      $('sf-label').value = '';
      $('sf-venue').value = '';
      $('sf-address').value = '';
      $('sf-lat').value = '';
      $('sf-lng').value = '';
      $('sf-start').value = '';
      $('sf-end').value = '';
      $('sf-radius').value = 300;
      $('sf-locstatus').textContent = '';
      pickedDates = [];
      renderDateChips();
      $('sf-range-start').value = todayISO();
      $('sf-range-end').value = todayISO();
      updateSessionPreview();
      return refreshAll();
    }).catch(function(err){
      showToast('Could not create class: ' + err.message, 'error');
    }).then(function(){ submitBtn.disabled = false; });
  });

  document.addEventListener('click', function(e){
    var delBtn = e.target.closest('.btn-del-session');
    if (delBtn){
      var sid = delBtn.getAttribute('data-id');
      var s = sessions.find(function(x){ return x._id === sid; });
      showConfirm('Delete session?', 'This removes "' + (s ? sessionLabel(s) : 'this session') + '" and its attendance records.').then(function(ok){
        if (!ok) return;
        api('/sessions/' + sid, { method: 'DELETE' }).then(function(){
          showToast('Session deleted.');
          if (selectedReportSessionId === sid) selectedReportSessionId = null;
          return refreshAll();
        }).catch(function(err){ showToast('Could not delete session: ' + err.message, 'error'); });
      });
      return;
    }
    var delBatch = e.target.closest('.btn-del-batch');
    if (delBatch){
      var bid = delBatch.getAttribute('data-batch-id');
      var count = sessions.filter(function(x){ return x.batchId === bid; }).length;
      showConfirm('Delete this class?', 'This removes all ' + count + ' sessions in this class and their attendance records.').then(function(ok){
        if (!ok) return;
        api('/sessions/batch/' + bid, { method: 'DELETE' }).then(function(){
          showToast('Class deleted.');
          selectedReportSessionId = null;
          return refreshAll();
        }).catch(function(err){ showToast('Could not delete class: ' + err.message, 'error'); });
      });
      return;
    }
    var delCand = e.target.closest('.btn-del-candidate');
    if (delCand){
      var cid = delCand.getAttribute('data-id');
      var c = candidates.find(function(x){ return x._id === cid; });
      showConfirm('Remove candidate?', 'This removes "' + (c ? c.name : 'this candidate') + '" from the roster and their attendance records.').then(function(ok){
        if (!ok) return;
        api('/candidates/' + cid, { method: 'DELETE' }).then(function(){
          showToast('Candidate removed.');
          return refreshAll();
        }).catch(function(err){ showToast('Could not remove candidate: ' + err.message, 'error'); });
      });
      return;
    }
    var reportRow = e.target.closest('.report-row');
    if (reportRow){
      selectedReportSessionId = reportRow.getAttribute('data-id');
      renderReportSummaryTable();
      loadReportDetail(selectedReportSessionId);
      return;
    }
  });

  // ---------------- roster ----------------
  function renderCandidatesList(){
    var wrap = $('candidatesList');
    if (!candidates.length){
      wrap.innerHTML = '<div class="empty-state">No candidates yet — add the first one above.</div>';
      return;
    }
    wrap.innerHTML = candidates.map(function(c){
      var av = c.photoUrl
        ? '<img class="avatar" src="' + c.photoUrl + '" alt="">'
        : '<span class="avatar">' + escapeHtml(initials(c.name)) + '</span>';
      return (
        '<div class="row-card">' +
          av +
          '<div class="row-main">' +
            '<div class="row-title">' + escapeHtml(c.name) + '</div>' +
            (c.phone ? '<div class="row-sub">' + escapeHtml(c.phone) + '</div>' : '') +
          '</div>' +
          '<div class="row-actions">' +
            '<button type="button" class="icon-btn btn-del-candidate" data-id="' + c._id + '" aria-label="Remove candidate">&times;</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  $('cf-photo-btn').addEventListener('click', function(){
    window.openCamera('Enrollment photo', function(blob){
      pendingEnrollPhotoBlob = blob;
      var url = URL.createObjectURL(blob);
      $('cf-photo-img').src = url;
      $('cf-photo-preview').hidden = false;
    });
  });
  $('cf-photo-remove').addEventListener('click', function(){
    pendingEnrollPhotoBlob = null;
    $('cf-photo-preview').hidden = true;
  });
  $('candidateForm').addEventListener('submit', function(e){
    e.preventDefault();
    var name = $('cf-name').value.trim();
    if (!name) return;
    var fd = new FormData();
    fd.append('name', name);
    fd.append('phone', $('cf-phone').value.trim());
    if (pendingEnrollPhotoBlob) fd.append('photo', pendingEnrollPhotoBlob, 'enrollment.jpg');

    var submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    apiForm('/candidates', 'POST', fd).then(function(){
      showToast('Candidate added.');
      $('candidateForm').reset();
      pendingEnrollPhotoBlob = null;
      $('cf-photo-preview').hidden = true;
      return refreshAll();
    }).catch(function(err){
      showToast('Could not add candidate: ' + err.message, 'error');
    }).then(function(){ submitBtn.disabled = false; });
  });

  // ---------------- reports ----------------
  var reportSummary = [];

  function loadReportsSummary(){
    return api('/reports/sessions').then(function(rows){
      reportSummary = rows || [];
      if (!selectedReportSessionId && reportSummary.length) selectedReportSessionId = reportSummary[0]._id;
      if (selectedReportSessionId && !reportSummary.some(function(r){ return r._id === selectedReportSessionId; })){
        selectedReportSessionId = reportSummary.length ? reportSummary[0]._id : null;
      }
      renderReportSummaryTable();
      if (selectedReportSessionId) loadReportDetail(selectedReportSessionId);
      else {
        $('report-stats').innerHTML = '';
        $('historyTbody').innerHTML = '<tr><td colspan="6" class="hint" style="padding:16px;">Nothing to show yet.</td></tr>';
        $('feedback-stats').innerHTML = '';
        $('feedbackList').innerHTML = '';
      }
    }).catch(function(err){ showToast('Could not load reports: ' + err.message, 'error'); });
  }

  function renderReportSummaryTable(){
    var tbody = $('reportSummaryTbody');
    if (!reportSummary.length){
      tbody.innerHTML = '<tr><td colspan="5" class="hint" style="padding:16px;">No sessions yet.</td></tr>';
      return;
    }
    tbody.innerHTML = reportSummary.map(function(r){
      var selected = r._id === selectedReportSessionId;
      return (
        '<tr class="report-row selectable' + (selected ? ' selected' : '') + '" data-id="' + r._id + '">' +
          '<td>' + escapeHtml(sessionLabel(r)) + (r.batchId ? ' <span class="badge">' + escapeHtml(r.batchLabel || 'Class') + '</span>' : '') + '</td>' +
          '<td class="mono"><span class="pill pill-good">' + r.present + '</span></td>' +
          '<td class="mono"><span class="pill pill-critical">' + r.absent + '</span></td>' +
          '<td class="mono"><span class="pill pill-muted">' + r.unmarked + '</span></td>' +
          '<td class="mono">' + r.rate + '%</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadReportDetail(sessionId){
    return Promise.all([
      api('/reports/session/' + sessionId).then(function(data){
        renderReportStats(data.counts);
        renderReportTable(data.rows);
      }),
      api('/feedback/session/' + sessionId).then(renderFeedback).catch(function(err){
        $('feedback-stats').innerHTML = '';
        $('feedbackList').innerHTML = '<div class="empty-state">Could not load feedback: ' + escapeHtml(err.message) + '</div>';
      })
    ]).catch(function(err){ showToast('Could not load report: ' + err.message, 'error'); });
  }

  function renderFeedback(rows){
    rows = rows || [];
    var statsEl = $('feedback-stats');
    var listEl = $('feedbackList');
    if (!rows.length){
      statsEl.innerHTML = '';
      listEl.innerHTML = '<div class="empty-state">No feedback submitted for this session yet.</div>';
      return;
    }
    var avgOverall = rows.reduce(function(sum, r){ return sum + r.overall; }, 0) / rows.length;
    var avgInteraction = rows.reduce(function(sum, r){ return sum + r.interaction; }, 0) / rows.length;
    var recommendYes = rows.filter(function(r){ return r.recommend === 'Yes'; }).length;
    statsEl.innerHTML =
      '<div class="stat-tile"><span class="stat-value">' + rows.length + '</span><span class="stat-label">Responses</span></div>' +
      '<div class="stat-tile accent"><span class="stat-value">' + avgOverall.toFixed(1) + '</span><span class="stat-label">Avg. overall</span></div>' +
      '<div class="stat-tile accent"><span class="stat-value">' + avgInteraction.toFixed(1) + '</span><span class="stat-label">Avg. interaction</span></div>' +
      '<div class="stat-tile good"><span class="stat-value">' + recommendYes + '/' + rows.length + '</span><span class="stat-label">Would recommend</span></div>';

    listEl.innerHTML = rows.map(function(r){
      var recommendPill = r.recommend === 'Yes'
        ? '<span class="pill pill-good">Recommend: Yes</span>'
        : r.recommend === 'No'
          ? '<span class="pill pill-critical">Recommend: No</span>'
          : '<span class="pill pill-warning">Recommend: Maybe</span>';
      var extra = '';
      if (r.topic) extra += '<div class="feedback-qa"><div class="section-label">Topic wanted in more detail</div><p class="feedback-answer">' + escapeHtml(r.topic) + '</p></div>';
      if (r.improve) extra += '<div class="feedback-qa"><div class="section-label">How to improve future sessions</div><p class="feedback-answer">' + escapeHtml(r.improve) + '</p></div>';
      return (
        '<div class="card feedback-card">' +
          '<div class="feedback-head">' +
            '<div class="row-title">' + escapeHtml(r.candidateName) + '</div>' +
            '<div class="hint mono">' + fmtDateTime(r.submittedAt) + '</div>' +
          '</div>' +
          '<div class="feedback-ratings">' +
            '<span class="pill pill-muted">Overall ' + r.overall + '/5</span>' +
            '<span class="pill pill-muted">Interaction ' + r.interaction + '/5</span>' +
            recommendPill +
          '</div>' +
          '<div class="feedback-qa">' +
            '<div class="section-label">Most valuable thing learned</div>' +
            '<p class="feedback-answer">' + escapeHtml(r.learned) + '</p>' +
          '</div>' +
          extra +
        '</div>'
      );
    }).join('');
  }

  function renderReportStats(counts){
    var el = $('report-stats');
    el.innerHTML =
      '<div class="stat-tile good"><span class="stat-value">' + counts.present + '</span><span class="stat-label">Present</span></div>' +
      '<div class="stat-tile critical"><span class="stat-value">' + counts.absent + '</span><span class="stat-label">Absent</span></div>' +
      '<div class="stat-tile"><span class="stat-value">' + counts.unmarked + '</span><span class="stat-label">Not marked</span></div>' +
      '<div class="stat-tile accent"><span class="stat-value">' + counts.rate + '%</span><span class="stat-label">Attendance</span></div>';
  }

  function renderReportTable(rows){
    var tbody = $('historyTbody');
    if (!rows || !rows.length){
      tbody.innerHTML = '<tr><td colspan="6" class="hint" style="padding:16px;">No candidates in the roster yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(r){
      var pill = '<span class="pill pill-muted">Not marked</span>';
      if (r.status === 'present') pill = '<span class="pill pill-good">Present</span>';
      else if (r.status === 'absent') pill = '<span class="pill pill-critical">Absent</span>';
      var photo = r.photoUrl ? '<img class="hist-photo" src="' + r.photoUrl + '" alt="">' : '—';
      var loc = '—';
      if (r.locText && isNum(r.locLat) && isNum(r.locLng)) loc = escapeHtml(r.locText) + ' <span class="mono">(' + r.locLat.toFixed(4) + ', ' + r.locLng.toFixed(4) + ')</span>';
      else if (r.locText) loc = escapeHtml(r.locText);
      else if (isNum(r.locLat) && isNum(r.locLng)) loc = '<span class="mono">' + r.locLat.toFixed(4) + ', ' + r.locLng.toFixed(4) + '</span>';
      var dist = '—';
      if (isNum(r.distanceM)){
        dist = '<span class="mono">' + Math.round(r.distanceM) + ' m</span> ' +
          (r.withinRadius ? '<span class="pill pill-good">On-site</span>' : '<span class="pill pill-warning">Off-site</span>');
      }
      return (
        '<tr>' +
          '<td>' + escapeHtml(r.name) + '</td>' +
          '<td>' + pill + '</td>' +
          '<td class="mono">' + fmtDateTime(r.markedAt) + '</td>' +
          '<td>' + photo + '</td>' +
          '<td>' + loc + '</td>' +
          '<td>' + dist + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  $('exportExcelBtn').addEventListener('click', function(){
    var btn = this;
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    fetch('/api/reports/export').then(function(res){
      if (res.status === 401){ window.location.href = '/login.html'; return null; }
      if (!res.ok){
        return res.json().catch(function(){ return {}; }).then(function(d){
          throw new Error((d && d.error) || ('Export failed (' + res.status + ')'));
        });
      }
      return res.blob();
    }).then(function(blob){
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'wmpsc-attendance-' + todayISO() + '.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
      showToast('Export ready.');
    }).catch(function(err){
      showToast('Could not export: ' + err.message, 'error');
    }).then(function(){
      btn.disabled = false;
      btn.textContent = original;
    });
  });

  // ---------------- confirm modal wiring ----------------
  $('confirmYes').addEventListener('click', function(){ resolveConfirm(true); });
  $('confirmNo').addEventListener('click', function(){ resolveConfirm(false); });

  // ---------------- auth / boot ----------------
  $('logoutBtn').addEventListener('click', function(){
    api('/auth/logout', { method: 'POST' }).catch(function(){}).then(function(){
      window.location.href = '/login.html';
    });
  });

  function boot(){
    fetch('/api/auth/me').then(function(r){ return r.json(); }).then(function(d){
      if (!d || !d.authenticated){
        window.location.href = '/login.html';
        return;
      }
      $('whoami').textContent = 'Signed in as ' + d.username;
      $('dbStatus').textContent = 'Synced';
      $('dbStatus').className = 'brand-sub ok';
      initShareLink();
      refreshAll();
    }).catch(function(){
      $('dbStatus').textContent = 'Could not reach the server';
      $('dbStatus').className = 'brand-sub err';
    });
  }
  boot();
})();
