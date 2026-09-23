// Shared live-camera capture modal — used by both the admin app (enrollment
// photos) and the public Mark Attendance page (proof-of-presence photos).
//
// Deliberately camera-only: this never falls back to a file/gallery picker.
// If the browser can't grant camera access, the person sees why and a way
// to retry — there is no other way to supply a photo here.
//
// Usage: window.openCamera('Take photo', function(blob){ ... use blob ... });
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  var stream = null;
  var capturedBlob = null;
  var onCaptureCb = null;
  var ready = false;

  function els() {
    return {
      overlay: $('cameraOverlay'),
      title: $('cameraModalTitle'),
      video: $('cameraVideo'),
      canvas: $('cameraCanvas'),
      msg: $('cameraMsg'),
      shoot: $('cameraShoot'),
      retake: $('cameraRetake'),
      use: $('cameraUse'),
      cancel: $('cameraCancel'),
      close: $('cameraModalClose')
    };
  }

  function showError(text) {
    var e = els();
    e.msg.innerHTML = escapeHtml(text) + '<div><button type="button" class="btn btn-secondary btn-sm" id="cameraTryAgain">Try again</button></div>';
    e.msg.hidden = false;
    e.video.hidden = true;
    e.shoot.disabled = true;
    var tryBtn = $('cameraTryAgain');
    if (tryBtn) tryBtn.addEventListener('click', startCamera);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
  }

  function startCamera() {
    var e = els();
    e.msg.hidden = true;
    e.video.hidden = false;
    e.canvas.style.display = 'none';
    e.video.style.display = 'block';
    e.shoot.hidden = false;
    e.shoot.disabled = true;
    e.retake.hidden = true;
    e.use.disabled = true;
    capturedBlob = null;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("This browser can't access the camera here. If you're opening this over Wi-Fi from a phone, camera access needs an https:// link (plain http:// only works on the same computer via localhost).");
      return;
    }

    stopStream();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .catch(function () {
        // Some devices (most laptops) have no "environment" camera — retry with any camera.
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      })
      .then(function (s) {
        stream = s;
        e.video.srcObject = s;
        // Wait for the stream to actually have frame data before allowing a
        // capture — enabling the button immediately can race ahead of the
        // video's first frame and draw a blank/0x0 canvas.
        var enable = function () { e.shoot.disabled = false; };
        if (e.video.readyState >= 2) enable();
        else e.video.addEventListener('loadeddata', enable, { once: true });
      })
      .catch(function (err) {
        var msg = 'Camera access was blocked.';
        if (err && err.name === 'NotAllowedError') msg = "Camera permission was denied. Allow camera access for this page in your browser's site settings, then try again.";
        else if (err && err.name === 'NotFoundError') msg = 'No camera was found on this device.';
        else if (err && err.name === 'NotReadableError') msg = 'The camera is already in use by another app.';
        showError(msg);
      });
  }

  function capture() {
    var e = els();
    var video = e.video;
    var canvas = e.canvas;
    var vw = video.videoWidth || 1280;
    var vh = video.videoHeight || 960;
    // Phone cameras can hand us frames several thousand pixels wide. A face/
    // proof-of-presence photo doesn't need that much detail, and every extra
    // pixel here is bandwidth on the upload and storage on Cloudinary's free
    // tier — so cap the longest side before it ever leaves the browser.
    var MAX_DIM = 1024;
    var scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
    var w = Math.round(vw * scale);
    var h = Math.round(vh * scale);
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(function (blob) {
      capturedBlob = blob;
      e.video.style.display = 'none';
      canvas.style.display = 'block';
      e.shoot.hidden = true;
      e.retake.hidden = false;
      e.use.disabled = !blob;
    }, 'image/jpeg', 0.8);
  }

  function close() {
    stopStream();
    var e = els();
    e.overlay.hidden = true;
    capturedBlob = null;
    onCaptureCb = null;
  }

  function wireOnce() {
    if (ready) return;
    ready = true;
    var e = els();
    if (!e.overlay) return; // this page doesn't include the camera modal markup
    e.shoot.addEventListener('click', capture);
    e.retake.addEventListener('click', startCamera);
    e.cancel.addEventListener('click', close);
    e.close.addEventListener('click', close);
    e.use.addEventListener('click', function () {
      var cb = onCaptureCb;
      var blob = capturedBlob;
      close();
      if (cb && blob) cb(blob);
    });
  }

  window.openCamera = function (title, onCapture) {
    wireOnce();
    var e = els();
    if (!e.overlay) {
      console.error('Camera modal markup is missing from this page.');
      return;
    }
    e.title.textContent = title || 'Take photo';
    onCaptureCb = onCapture;
    e.overlay.hidden = false;
    startCamera();
  };
})();
