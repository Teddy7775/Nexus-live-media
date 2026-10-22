/* My Corner of the World — tiny dependency-free script. Everything degrades gracefully without it. */
(function () {
  var d = document, root = d.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // theme + text size (also applied by a tiny inline script in <head> to avoid a flash)
  var theme = get("mcw:theme"); if (theme) root.setAttribute("data-theme", theme);
  var size = parseFloat(get("mcw:size")); if (size) root.style.setProperty("--reader-size", size + "rem");
  d.addEventListener("click", function (e) {
    var b = e.target.closest("[data-theme-set]"); if (b) { var t = b.getAttribute("data-theme-set"); if (t === "light") { root.removeAttribute("data-theme"); root.setAttribute("data-theme", "light"); } else root.setAttribute("data-theme", t); set("mcw:theme", t); }
    var s = e.target.closest("[data-size]"); if (s) { var cur = parseFloat(getComputedStyle(root).getPropertyValue("--reader-size")) || 1.2; var n = Math.min(1.8, Math.max(.95, cur + (s.getAttribute("data-size") === "up" ? .1 : -.1))); root.style.setProperty("--reader-size", n.toFixed(2) + "rem"); set("mcw:size", n.toFixed(2)); }
    var st = e.target.closest(".settings > button"); if (st) { st.parentNode.classList.toggle("open"); st.setAttribute("aria-expanded", st.parentNode.classList.contains("open")); }
    else if (!e.target.closest(".settings")) { var o = d.querySelector(".settings.open"); if (o) o.classList.remove("open"); }
  });

  // time-trap for forms (bots submit instantly)
  d.querySelectorAll('input[name=ts]').forEach(function (i) { i.value = Date.now(); });

  // mobile menu
  var mb = d.querySelector(".menu-btn"), nav = d.querySelector(".nav");
  if (mb && nav) mb.addEventListener("click", function () { var o = nav.classList.toggle("open"); mb.setAttribute("aria-expanded", o); });

  // reading progress + remember last chapter + arrow keys
  var prose = d.querySelector(".prose[data-book]");
  if (prose) {
    var bar = d.querySelector(".progress");
    function upd() { var h = root.scrollHeight - innerHeight; if (bar) bar.style.width = (h > 0 ? Math.min(100, scrollY / h * 100) : 0) + "%"; }
    addEventListener("scroll", upd, { passive: true }); upd();
    set("mcw:last:" + prose.getAttribute("data-book") + ":" + prose.getAttribute("data-lang"), location.pathname);
    d.addEventListener("keydown", function (e) {
      if (e.target.closest("input,textarea,select") || e.altKey || e.ctrlKey || e.metaKey) return;
      var a = e.key === "ArrowLeft" ? d.querySelector("[rel=prev]") : e.key === "ArrowRight" ? d.querySelector("[rel=next]") : null;
      if (a) location.href = a.href;
    });
  }
  // “continue reading”
  d.querySelectorAll("[data-continue]").forEach(function (a) {
    var p = get("mcw:last:" + a.getAttribute("data-continue")); if (p && p !== a.getAttribute("href")) { a.setAttribute("href", p); a.textContent = a.getAttribute("data-continue-label"); }
  });

  // lightbox
  var lb = d.querySelector("dialog.lb");
  if (lb) {
    d.querySelectorAll(".gallery button").forEach(function (b) {
      b.addEventListener("click", function () {
        lb.querySelector("img").src = b.getAttribute("data-full"); lb.querySelector("img").alt = b.querySelector("img").alt;
        lb.querySelector("p").textContent = b.getAttribute("data-cap"); lb.showModal();
      });
    });
    lb.addEventListener("click", function (e) { if (e.target === lb || e.target.closest(".x")) lb.close(); });
  }

  // forms: progressive enhancement (works as a normal POST without JS)
  d.querySelectorAll("form[data-ajax]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      if (!window.fetch) return; e.preventDefault();
      var m = f.querySelector(".msg"); if (m) m.remove();
      fetch(f.action, { method: "POST", body: new FormData(f), headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (j) { var n = d.createElement("p"); n.className = "msg " + (j.ok ? "ok" : "err"); n.setAttribute("role", "status"); n.textContent = j.ok ? f.getAttribute("data-ok") : f.getAttribute("data-err"); f.prepend(n); if (j.ok) f.reset(); })
        .catch(function () { var n = d.createElement("p"); n.className = "msg err"; n.textContent = f.getAttribute("data-err"); f.prepend(n); });
    });
  });

  // language chooser at the site root
  var ch = d.querySelector("[data-auto-lang]");
  if (ch && !get("mcw:chose")) {
    var langs = (ch.getAttribute("data-auto-lang") || "").split(","), pref = (navigator.languages || [navigator.language || "en"]);
    for (var i = 0; i < pref.length; i++) { var c = pref[i].slice(0, 2).toLowerCase(); if (langs.indexOf(c) > -1) { location.replace(ch.getAttribute("data-base") + c + "/"); break; } }
  }
  d.querySelectorAll(".lang-choice a").forEach(function (a) { a.addEventListener("click", function () { set("mcw:chose", "1"); }); });
})();
