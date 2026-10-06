// Sign in / Create account: links from the website to the Sentinel8 platform.
//
// APP_URL is where the platform runs. Each link marked data-app-path opens that
// page of it (/signin, /signup). The page first asks the platform's health check
// whether it is really Sentinel8 and accepting accounts. Only a clear yes sends
// people there; anything else (not deployed yet, an outage, a 404 page or a
// parked domain at that address) shows how to get access instead, so nobody
// lands on an error page.
var APP_URL = 'https://exciting-inferior-axis.replit.app';

(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-app-path]'));
  if (!links.length) return;
  links.forEach(function (a) { a.href = APP_URL + a.getAttribute('data-app-path'); });

  var state = 'checking';
  var done = function (s) { state = s; document.documentElement.setAttribute('data-app', s); return s; };
  var timeout = new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 5000); });
  var checked = !window.fetch ? Promise.resolve(done('down')) :
    Promise.race([fetch(APP_URL + '/api/healthz', { mode: 'cors', cache: 'no-store', credentials: 'omit' }), timeout])
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (h) { return done(h && h.service === 'sentinel8' && h.status === 'ok' && h.accounts !== false ? 'up' : 'down'); },
            function () { return done('down'); });

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
        '<p>For early access, email <a href="mailto:customer@sentinel8.ai">customer@sentinel8.ai</a> or <a href="' + (document.getElementById('contact') ? '#contact' : 'https://www.sentinel8.ai/#contact') + '" data-close>book a call</a>.</p>' +
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
      if (state === 'up') return;
      e.preventDefault();
      if (state === 'down') return explain(a);
      // Still checking: go as soon as the answer is in.
      checked.then(function (s) { if (s === 'up') window.location.href = a.href; else explain(a); });
    });
  });
})();
