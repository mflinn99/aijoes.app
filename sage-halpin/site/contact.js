// Contact Us: book a call and send a message.
//
// The website is static (GitHub Pages), so out of the box both forms hand the
// visitor's details to their own email app, addressed to CONTACT.email, and the
// booking also gives them a calendar entry for the time they asked for.
// Two optional settings connect real services without changing the page:
//   endpoint    a form service that accepts a JSON POST (for example Formspree).
//               Messages and booking requests are sent there directly instead.
//   bookingUrl  a live scheduling page connected to a real calendar: a
//               Microsoft Bookings shared booking page (embedded in the panel),
//               a Microsoft "Bookings with me" personal page (opened from a
//               button, as Microsoft doesn't allow embedding it), or a Google
//               Calendar or Calendly page. It replaces the request calendar,
//               so visitors book live against real availability.
var CONTACT = {
  email: 'customer@sentinel8.ai',
  endpoint: '',
  bookingUrl: 'https://bookings.cloud.microsoft/bookwithme/user/34043a2e1522444297ea800ffcd00a8c%40aigogo.ai?anonymous',
  timeZone: 'Europe/London',  // the team's working hours are in this zone
  startHour: 9,               // first call starts 09:00
  endHour: 17,                // last call ends by 17:00
  minutes: 30,                // call length
  days: 15,                   // working days offered
  leadHours: 18               // earliest booking, hours from now
};

(function () {
  // England and Wales bank holidays: no calls offered on these days.
  var HOLIDAYS = [
    '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
    '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28'
  ];

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var localZone = '';
  try { localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // The wall-clock date and time in the team's zone for an instant.
  var teamParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONTACT.timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short'
  });
  function inTeamZone(ms) {
    var o = {};
    teamParts.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, wd: o.weekday };
  }
  // The instant at which the team's clock shows the given date and time.
  function teamTime(y, m, d, h, min) {
    var guess = Date.UTC(y, m - 1, d, h, min);
    var p = inTeamZone(guess);
    var offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
    var ms = guess - offset;
    var check = inTeamZone(ms);   // correct once more across a clock change
    return ms - (Date.UTC(check.y, check.m - 1, check.d, check.h, check.min) - Date.UTC(y, m - 1, d, h, min));
  }

  var dayFmt = { weekday: 'short', day: 'numeric', month: 'short' };
  var longFmt = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };
  function fmt(ms, opts) { return new Date(ms).toLocaleString(undefined, opts); }
  function time(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function localDayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

  // The working days on offer, each with its call times as instants.
  function schedule(now) {
    var earliest = now + CONTACT.leadHours * 3600e3;
    var days = [], t = inTeamZone(now), cursor = Date.UTC(t.y, t.m - 1, t.d);
    for (var guard = 0; days.length < CONTACT.days && guard < 60; guard++) {
      cursor += 864e5;
      var dt = new Date(cursor), y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      var wd = dt.getUTCDay(), key = y + '-' + pad(m) + '-' + pad(d);
      if (wd === 0 || wd === 6 || HOLIDAYS.indexOf(key) !== -1) continue;
      var slots = [];
      for (var mins = CONTACT.startHour * 60; mins + CONTACT.minutes <= CONTACT.endHour * 60; mins += CONTACT.minutes) {
        var ms = teamTime(y, m, d, Math.floor(mins / 60), mins % 60);
        if (ms >= earliest) slots.push(ms);
      }
      if (slots.length) days.push({ key: key, label: Date.UTC(y, m - 1, d, 12), slots: slots });
    }
    return days;
  }

  // Calendar entries ----------------------------------------------------------
  function stamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function icsText(v) { return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function ics(start, end, summary, description) {
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sentinel8//Call request//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + stamp(start) + '-' + Math.random().toString(36).slice(2) + '@sentinel8.ai',
      'DTSTAMP:' + stamp(Date.now()),
      'DTSTART:' + stamp(start),
      'DTEND:' + stamp(end),
      'SUMMARY:' + icsText(summary),
      'DESCRIPTION:' + icsText(description),
      'STATUS:TENTATIVE',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n') + '\r\n');
  }
  function googleLink(start, end, summary, description) {
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(summary) +
      '&dates=' + stamp(start) + '/' + stamp(end) +
      '&details=' + encodeURIComponent(description);
  }

  // Sending -------------------------------------------------------------------
  function mailto(subject, body) {
    return 'mailto:' + CONTACT.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  // Sends to the form service when one is set; otherwise opens the visitor's
  // email app. Resolves to 'sent' or 'email'.
  function deliver(payload, subject, body) {
    if (CONTACT.endpoint && window.fetch) {
      return fetch(CONTACT.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.assign({ _subject: subject }, payload))
      }).then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        return 'sent';
      }).catch(function () {
        window.location.href = mailto(subject, body);
        return 'email';
      });
    }
    window.location.href = mailto(subject, body);
    return Promise.resolve('email');
  }

  function read(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) data[el.name] = el.value.trim(); });
    return data;
  }
  function problem(form, data, required) {
    for (var i = 0; i < required.length; i++) {
      var name = required[i];
      if (!data[name]) return { field: name, text: 'Please add your ' + (name === 'email' ? 'work email' : name) + '.' };
    }
    if (!EMAIL_RE.test(data.email)) return { field: 'email', text: 'Please check your email address.' };
    return null;
  }
  function showError(form, issue) {
    var box = form.querySelector('[data-error]');
    box.textContent = issue ? issue.text : '';
    box.hidden = !issue;
    if (issue && form.elements[issue.field]) form.elements[issue.field].focus();
  }

  // Book a call ---------------------------------------------------------------
  var book = document.getElementById('book');
  if (book) {
    var tzLabel = book.querySelector('[data-tz]');
    if (tzLabel && localZone) tzLabel.textContent = localZone.replace(/_/g, ' ');

    if (CONTACT.bookingUrl) {
      // A live scheduling page replaces the request calendar: visitors see only
      // genuinely free times, and a booking goes straight into the calendar.
      var picker = book.querySelector('[data-booking-picker]');
      var src = CONTACT.bookingUrl;
      var hintEl = tzLabel && tzLabel.closest('.hint');
      if (/\/bookwithme\//i.test(src)) {
        // Microsoft's personal booking pages can't be embedded: open them instead.
        var go = document.createElement('div');
        go.className = 'form-actions';
        go.innerHTML = '<a class="btn btn-primary" target="_blank" rel="noopener">Choose a time in our calendar</a><span class="form-note">Opens our Microsoft booking page in a new tab. No account needed.</span>';
        go.querySelector('a').href = src;
        picker.replaceWith(go);
        if (hintEl) hintEl.textContent = 'Pick a time for a 30-minute introductory call on Microsoft Teams. It goes straight into our calendar, and you get the Teams invitation by email.';
      } else {
        // Google's appointment pages need gv=true to show inside another site.
        if (/calendar\.google\.com\/calendar\/appointments\//.test(src) && !/[?&]gv=true/.test(src)) src += (src.indexOf('?') === -1 ? '?' : '&') + 'gv=true';
        var frame = document.createElement('iframe');
        frame.className = 'booking-frame';
        frame.src = src;
        frame.title = 'Book a call with Sentinel8';
        frame.loading = 'lazy';
        var open = document.createElement('p');
        open.className = 'form-note';
        open.innerHTML = 'Calendar not showing? <a target="_blank" rel="noopener">Open the booking page in a new tab</a>.';
        open.querySelector('a').href = CONTACT.bookingUrl;
        picker.replaceWith(frame, open);
        if (hintEl) hintEl.textContent = 'Pick any free time below. It books straight into our calendar and you get a confirmation by email.';
      }
    } else {
      var daysEl = book.querySelector('[data-days]');
      var slotsEl = book.querySelector('[data-slots]');
      var form = book.querySelector('[data-book-form]');
      var done = book.querySelector('[data-book-done]');
      var chosenEl = book.querySelector('[data-chosen]');
      var days = schedule(Date.now()), day = null, slot = null;

      var renderSlots = function () {
        slotsEl.textContent = '';
        day.slots.forEach(function (ms) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'slot';
          // If the visitor's own date differs from the team's, say which day.
          b.textContent = time(ms) + (localDayKey(ms) === localDayKey(day.slots[0]) ? '' : ' ' + fmt(ms, { weekday: 'short' }));
          b.setAttribute('aria-pressed', String(ms === slot));
          b.setAttribute('aria-label', fmt(ms, longFmt));
          b.addEventListener('click', function () { pickSlot(ms); });
          slotsEl.appendChild(b);
        });
      };
      var pickDay = function (d) {
        day = d; slot = null;
        Array.prototype.forEach.call(daysEl.children, function (b, i) { b.setAttribute('aria-pressed', String(days[i] === d)); });
        renderSlots();
        form.hidden = true;
      };
      var pickSlot = function (ms) {
        slot = ms;
        Array.prototype.forEach.call(slotsEl.children, function (b, i) { b.setAttribute('aria-pressed', String(day.slots[i] === ms)); });
        chosenEl.textContent = fmt(ms, longFmt);
        form.hidden = false;
        done.hidden = true;
      };

      days.forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'day';
        var label = new Date(d.label);
        b.innerHTML = '<small></small><b></b><small></small>';
        b.children[0].textContent = label.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
        b.children[1].textContent = label.getUTCDate();
        b.children[2].textContent = label.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
        b.setAttribute('aria-label', label.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }));
        b.addEventListener('click', function () { pickDay(d); });
        daysEl.appendChild(b);
      });
      if (days.length) pickDay(days[0]);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var data = read(form);
        if (data.website) return;   // a bot filled the hidden field
        var issue = !slot ? { field: '', text: 'Please choose a time.' } : problem(form, data, ['name', 'email']);
        showError(form, issue);
        if (issue) return;

        var end = slot + CONTACT.minutes * 60e3;
        var when = fmt(slot, longFmt) + (localZone ? ' (' + localZone.replace(/_/g, ' ') + ')' : '');
        var teamWhen = fmt(slot, Object.assign({ timeZone: CONTACT.timeZone }, longFmt)) + ' UK time';
        var subject = 'Call request: ' + teamWhen + ' with ' + data.name;
        var body = [
          'I would like to book a ' + CONTACT.minutes + '-minute introductory call with Sentinel8.',
          '',
          'Requested time: ' + teamWhen,
          'In my time zone: ' + when,
          '',
          'Name: ' + data.name,
          'Email: ' + data.email,
          'Organisation: ' + (data.organisation || '-'),
          'Topic: ' + (data.topic || '-')
        ].join('\n');
        var summary = 'Sentinel8 introductory call (requested)';
        var details = 'A ' + CONTACT.minutes + '-minute call with the Sentinel8 team, requested by ' + data.name +
          '. The team confirms by email with the video link.' + (data.topic ? '\n\nTopic: ' + data.topic : '');

        deliver({ type: 'booking', start: new Date(slot).toISOString(), end: new Date(end).toISOString(), timeZone: localZone,
          name: data.name, email: data.email, organisation: data.organisation, topic: data.topic }, subject, body)
          .then(function (how) {
            book.querySelector('[data-done-when]').textContent = fmt(slot, longFmt);
            book.querySelector('[data-done-how]').textContent = how === 'sent'
              ? 'We have your request and will confirm by email to ' + data.email + ', usually within one working day.'
              : 'Your email app has opened with the request addressed to ' + CONTACT.email + '. Send it and we will confirm by email, usually within one working day.';
            book.querySelector('[data-ics]').href = ics(slot, end, summary, details);
            book.querySelector('[data-gcal]').href = googleLink(slot, end, summary, details);
            form.hidden = true;
            done.hidden = false;
            done.focus();
          });
      });

      book.querySelector('[data-book-again]').addEventListener('click', function () {
        done.hidden = true;
        form.hidden = false;
        var first = slotsEl.querySelector('[aria-pressed="true"]') || slotsEl.firstElementChild;
        if (first) first.focus();
      });
    }
  }

  // Send a message ------------------------------------------------------------
  var msgForm = document.querySelector('[data-message-form]');
  if (msgForm) {
    var link = msgForm.querySelector('[data-contact-email]');
    if (link) { link.href = 'mailto:' + CONTACT.email; link.textContent = CONTACT.email; }
    msgForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = read(msgForm);
      if (data.website) return;
      var issue = problem(msgForm, data, ['name', 'email', 'message']);
      showError(msgForm, issue);
      if (issue) return;
      var subject = 'Enquiry from ' + data.name + (data.organisation ? ', ' + data.organisation : '');
      var body = data.message + '\n\n' + data.name + '\n' + data.email + (data.organisation ? '\n' + data.organisation : '');
      deliver({ type: 'message', name: data.name, email: data.email, organisation: data.organisation, message: data.message }, subject, body)
        .then(function (how) {
          var done = msgForm.querySelector('[data-message-done]');
          msgForm.querySelector('[data-message-how]').textContent = how === 'sent'
            ? 'Thank you, ' + data.name + '. Your message is with the team and we will reply to ' + data.email + '.'
            : 'Your email app has opened with your message addressed to ' + CONTACT.email + '. Send it and we will reply to ' + data.email + '.';
          done.hidden = false;
          done.focus();
        });
    });
  }
})();
