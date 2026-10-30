/* Nexus Live Media — site behaviour (no dependencies) */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  root.classList.add('js');

  /* ---------- Header: mobile menu ---------- */
  var toggle = doc.querySelector('.menu-toggle');
  var nav = doc.getElementById('nav');
  function setMenu(open) {
    if (!toggle || !nav) return;
    doc.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  if (toggle && nav) {
    toggle.addEventListener('click', function () { setMenu(!doc.body.classList.contains('nav-open')); });
    nav.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (a && !a.closest('.has-sub > a')) setMenu(false);
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    doc.querySelectorAll('.sub-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var li = btn.parentElement, open = !li.classList.contains('open');
        li.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    var mq = window.matchMedia('(min-width: 1025px)');
    (mq.addEventListener ? mq.addEventListener('change', function (e) { if (e.matches) setMenu(false); }) : null);
  }

  /* ---------- Header shadow on scroll ---------- */
  var header = doc.querySelector('.site-header');
  function onScroll() { if (header) header.classList.toggle('scrolled', window.scrollY > 8); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Reveal on scroll ---------- */
  var reveals = doc.querySelectorAll('.reveal');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || reduce) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Quote form ---------- */
  var form = doc.getElementById('quoteForm');
  if (form) {
    var alertBox = form.querySelector('.form-alert');
    var submitBtn = form.querySelector('button[type="submit"]');
    var params = new URLSearchParams(window.location.search);
    var pre = params.get('service');
    var sel = form.querySelector('select[name="service"]');
    if (pre && sel) {
      Array.prototype.some.call(sel.options, function (o) { if (o.value.toLowerCase() === pre.toLowerCase()) { sel.value = o.value; return true; } return false; });
    }
    function showAlert(msg, ok) {
      if (!alertBox) return;
      alertBox.textContent = msg;
      alertBox.className = 'form-alert show ' + (ok ? 'is-success' : 'is-error');
    }
    function mark(el, bad) { if (el) el.classList.toggle('field-error', bad); }
    form.addEventListener('submit', function (e) {
      var name = form.querySelector('[name="name"]');
      var email = form.querySelector('[name="email"]');
      var service = form.querySelector('[name="service"]');
      var message = form.querySelector('[name="message"]');
      var errs = [];
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email && email.value || '').trim());
      mark(name, !(name && name.value.trim()));
      mark(email, !emailOk);
      mark(service, !(service && service.value));
      if (!(name && name.value.trim())) errs.push('Please enter your name.');
      if (!emailOk) errs.push('Please enter a valid email address.');
      if (!(service && service.value)) errs.push('Please select a service.');
      if (message && /https?:\/\/|www\./i.test(message.value)) { mark(message, true); errs.push('Please remove web links from your message.'); }
      if (errs.length) { e.preventDefault(); showAlert(errs.join(' '), false); return; }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
    });
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.addEventListener('input', function () { el.classList.remove('field-error'); if (alertBox) alertBox.className = 'form-alert'; });
    });
  }

  /* ---------- Click tracking (GA4, only if loaded) ---------- */
  doc.addEventListener('click', function (e) {
    var a = e.target.closest('[data-track]');
    if (!a || typeof window.gtag !== 'function') return;
    window.gtag('event', 'contact_click', { method: a.getAttribute('data-track'), page_path: location.pathname });
  });

  /* ---------- Footer year ---------- */
  var y = doc.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
