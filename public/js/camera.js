// Shared live-camera capture modal — used by both the admin app (enrollment
// photos) and the public Mark Attendance page (proof-of-presence photos).
//
// Deliberately camera-only: this never falls back to a file/gallery picker.
// If the browser can't grant camera access, the person sees why and a way
// to retry — there is no other way to supply a photo here.
//
// Defaults to the front (selfie) camera, since every photo taken here is a
// headshot of the person holding the phone — with a flip button (shown only
// when the device actually has more than one camera) in case the back
// camera is ever needed instead.
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
  var currentFacing = 'user'; // 'user' = front/selfie camera, 'environment' = back camera
  var hasMultipleCameras = null; // null = not checked yet this page load

  function els() {
    return {
      overlay: $('cameraOverlay'),
      title: $('cameraModalTitle'),
      video: $('cameraVideo'),
      canvas: $('cameraCanvas'),
      msg: $('cameraMsg'),
      flip: $('cameraFlip'),
      shoot: $('cameraShoot'),
      retake: $('cameraRetake'),
      use: $('cameraUse'),
      cancel: $('cameraCancel'),
      close: $('cameraModalClose')
    };
  }

  function requestStream(facing) {
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
  }

  function armCaptureReady() {
    var e = els();
    e.shoot.disabled = true;
    // Wait for the stream to actually have frame data before allowing a
    // capture — enabling the button immediately can race ahead of the
    // video's first frame and draw a blank/0x0 canvas.
    var enable = function () { e.shoot.disabled = false; };
    if (e.video.readyState >= 2) enable();
    else e.video.addEventListener('loadeddata', enable, { once: true });
  }

  function detectMultiCamera() {
    if (!navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var videoInputs = devices.filter(function (d) { return d.kind === 'videoinput'; });
      hasMultipleCameras = videoInputs.length > 1;
      var e = els();
      if (e.flip) e.flip.hidden = !hasMultipleCameras;
    }).catch(function () { /* can't tell — leave the flip button hidden */ });
  }

  function showError(text) {
    var e = els();
    e.msg.innerHTML = escapeHtml(text) + '<div><button type="button" class="btn btn-secondary btn-sm" id="cameraTryAgain">Try again</button></div>';
    e.msg.hidden = false;
    e.video.hidden = true;
    e.shoot.disabled = true;
    if (e.flip) e.flip.hidden = true;
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
    if (e.flip) { e.flip.hidden = true; e.flip.disabled = false; }
    capturedBlob = null;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("This browser can't access the camera here. If you're opening this over Wi-Fi from a phone, camera access needs an https:// link (plain http:// only works on the same computer via localhost).");
      return;
    }

    stopStream();
    requestStream(currentFacing)
      .catch(function () {
        // The preferred facing mode isn't available on this device (e.g. a
        // laptop with only one camera) — fall back to whatever camera exists.
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      })
      .then(function (s) {
        stream = s;
        e.video.srcObject = s;
        armCaptureReady();
        if (hasMultipleCameras === null) detectMultiCamera();
        else if (e.flip) e.flip.hidden = !hasMultipleCameras;
      })
      .catch(function (err) {
        var msg = 'Camera access was blocked.';
        if (err && err.name === 'NotAllowedError') msg = "Camera permission was denied. Allow camera access for this page in your browser's site settings, then try again.";
        else if (err && err.name === 'NotFoundError') msg = 'No camera was found on this device.';
        else if (err && err.name === 'NotReadableError') msg = 'The camera is already in use by another app.';
        showError(msg);
      });
  }

  function flipCamera() {
    var e = els();
    var nextFacing = currentFacing === 'user' ? 'environment' : 'user';
    e.flip.disabled = true;
    e.shoot.disabled = true;
    requestStream(nextFacing).then(function (s) {
      stopStream();
      stream = s;
      currentFacing = nextFacing;
      e.video.srcObject = s;
      armCaptureReady();
      e.flip.disabled = false;
    }).catch(function () {
      // This device doesn't actually have the other camera (or it's busy
      // elsewhere) — keep the current, working stream running rather than
      // breaking the flow over it.
      e.shoot.disabled = false;
      e.flip.disabled = false;
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
      if (e.flip) e.flip.hidden = true;
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
    if (e.flip) e.flip.addEventListener('click', flipCamera);
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
