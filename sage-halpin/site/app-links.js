// Sign in / Create account: links from the website to the Sentinel8 platform.
//
// APP_URL is where the platform runs. Each link marked data-app-path opens that
// page of it (/signin, /signup). The page checks the platform is reachable;
// until it is (before launch, or during an outage), a click explains how to get
// access instead of opening a page that won't load.
var APP_URL = 'https://app.sentinel8.ai';

(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-app-path]'));
  if (!links.length) return;
  links.forEach(function (a) { a.href = APP_URL + a.getAttribute('data-app-path'); });

  var state = 'checking';
  var done = function (s) { state = s; document.documentElement.setAttribute('data-app', s); };
  var timeout = new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 5000); });
  if (window.fetch) {
    Promise.race([fetch(APP_URL + '/api/healthz', { mode: 'no-cors', cache: 'no-store' }), timeout])
      .then(function () { done('up'); }, function () { done('down'); });
  } else {
    done('up');
  }

  var note = null;
  function explain(anchor) {
    if (!note) {
      note = document.createElement('div');
      note.className = 'app-note';
      note.setAttribute('role', 'dialog');
      note.setAttribute('aria-modal', 'false');
      note.setAttribute('aria-labelledby', 'app-note-title');
      note.innerHTML =
        '<p id="app-note-title"><b>Accounts open when the platform launches.</b></p>' +
        '<p>For early access, email <a href="mailto:customer@sentinel8.ai">customer@sentinel8.ai</a> or <a href="#contact" data-close>book a call</a>.</p>' +
        '<button type="button" class="app-note-close" data-close aria-label="Close">Close</button>';
      document.body.appendChild(note);
      note.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) hide(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    }
    note.hidden = false;
    var r = anchor.getBoundingClientRect();
    note.style.top = (window.scrollY + r.bottom + 10) + 'px';
    note.style.left = Math.max(16, Math.min(window.scrollX + r.right - 320, window.innerWidth - 336)) + 'px';
    note.querySelector('.app-note-close').focus();
  }
  function hide() { if (note) note.hidden = true; }

  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (state !== 'down') return;
      e.preventDefault();
      explain(a);
    });
  });
})();
