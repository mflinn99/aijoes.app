// Startup: hide the app behind the loading mark until it has rendered (main.tsx
// reveals it), and never for more than four seconds. A file, not an inline
// script, so the Content Security Policy (script-src 'self') allows it.
document.documentElement.classList.add("booting");
setTimeout(function () {
  document.documentElement.classList.remove("booting");
  document.documentElement.classList.add("booted");
}, 4000);
