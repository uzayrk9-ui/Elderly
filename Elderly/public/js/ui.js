// Site-wide UX behaviours (loaded on every page)
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1) Highlight the current section in the nav
  var path = location.pathname;
  document.querySelectorAll('header nav a, .landing-menu a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '/') return;
    var active = href === '/' ? path === '/' : (path === href || path.indexOf(href + '/') === 0);
    if (active) a.classList.add('nav-active');
  });

  // 2) Elevate the header slightly once the page is scrolled
  var nav = document.querySelector('.landing-nav') || document.querySelector('header');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // 3) Back-to-top button (created here so no view needs editing)
  var btt = document.createElement('button');
  btt.type = 'button';
  btt.className = 'back-to-top';
  btt.setAttribute('aria-label', 'Back to top');
  btt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(btt);
  btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
  var toggleBtt = function () { btt.classList.toggle('show', window.scrollY > 420); };
  toggleBtt();
  window.addEventListener('scroll', toggleBtt, { passive: true });

  // 4) Auto-dismiss flash messages after a few seconds
  document.querySelectorAll('.flash').forEach(function (f) {
    setTimeout(function () { f.classList.add('flash-hide'); }, 5000);
  });
})();
