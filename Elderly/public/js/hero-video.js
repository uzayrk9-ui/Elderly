// Cinematic hero: manual fade-in/out loop (ported from the React useEffect/useRef spec)
//  - requestAnimationFrame monitors currentTime/duration
//  - fade in over 0.5s at the start, fade out over 0.5s before the end
//  - on `ended`: opacity 0 -> wait 100ms -> reset to 0s -> play() again
(function () {
  var video = document.getElementById('hero-video');
  if (!video) return;

  // Respect users who prefer reduced motion: keep the video hidden & paused,
  // leaving the clean, readable hero text on its calm background.
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    video.removeAttribute('autoplay');
    video.style.opacity = '0';
    return;
  }

  var FADE = 0.5; // seconds
  var raf;

  function tick() {
    var d = video.duration;
    var t = video.currentTime;
    if (!isNaN(d) && d > 0) {
      var op = 1;
      if (t < FADE) op = t / FADE;                       // fade in
      else if (t > d - FADE) op = Math.max(0, (d - t) / FADE); // fade out
      video.style.opacity = op.toFixed(3);
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    var p = video.play();
    if (p && typeof p.catch === 'function') p.catch(function () {});
  }

  video.addEventListener('loadedmetadata', start);
  video.addEventListener('canplay', start);

  // Seamless manual loop with a brief blackout so the cut is never visible
  video.addEventListener('ended', function () {
    video.style.opacity = '0';
    setTimeout(function () {
      video.currentTime = 0;
      start();
    }, 100);
  });

  raf = requestAnimationFrame(tick);
  window.addEventListener('beforeunload', function () { cancelAnimationFrame(raf); });

  // Kick it off in case metadata is already available
  if (video.readyState >= 1) start();
})();
