// BadCast - synchronisation d'une présentation remark.js / xaringan entre plusieurs écrans.
// Script ajouté automatiquement par le serveur aux pages HTML du dossier presentation/.
//
//   /pres/ma-presentation.html?role=master -> PC maître : chaque changement de diapo est diffusé
//   /pres/ma-presentation.html             -> écran : suit le PC maître (ou ouvrez simplement /screen)
(function () {
  'use strict';

  var master = new URLSearchParams(location.search).get('role') === 'master';
  var url = location.pathname;

  function whenReady(cb) {
    if (window.slideshow && window.slideshow.gotoSlide) return cb(window.slideshow);
    setTimeout(function () { whenReady(cb); }, 100);
  }

  function badge(text, ok) {
    var el = document.getElementById('badcast-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'badcast-badge';
      el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;padding:4px 10px;border-radius:6px;' +
        'font:13px system-ui,sans-serif;color:#fff;pointer-events:none;transition:opacity .5s';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.background = ok ? 'rgba(20,83,45,.85)' : 'rgba(176,0,32,.9)';
    el.style.opacity = '1';
    clearTimeout(el._t);
    if (ok) el._t = setTimeout(function () { el.style.opacity = '0'; }, 2500);
  }

  if (master) {
    whenReady(function (slideshow) {
      var screens = 0;
      function publish(index) {
        fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'deck', url: url, slide: index }),
        }).then(function (r) {
          badge('Diapo ' + (index + 1) + ' diffusée sur ' + screens + ' écran(s)', r.ok);
        }).catch(function () { badge('Serveur BadCast injoignable', false); });
      }
      slideshow.on('showSlide', function (slide) { publish(slide.getSlideIndex()); });

      // (Re)connexion : on renvoie la diapo courante (utile si le serveur a redémarré)
      var es = new EventSource('/events?role=control');
      es.onopen = function () { publish(slideshow.getCurrentSlideIndex()); };
      es.onmessage = function (e) { screens = JSON.parse(e.data).screens; };
      es.onerror = function () { badge('Serveur BadCast injoignable', false); };
    });
    return;
  }

  // ----- Écran suiveur -----
  document.documentElement.style.cursor = 'none';
  document.addEventListener('click', function () {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () {});
    }
  });
  try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(function () {}); } catch (e) {}

  whenReady(function (slideshow) {
    var es = new EventSource('/events?role=screen');
    es.onopen = function () { var b = document.getElementById('badcast-badge'); if (b) b.style.opacity = '0'; };
    es.onerror = function () { badge('Connexion au PC maître perdue… reconnexion', false); };
    es.addEventListener('reload', function () { location.reload(); });
    es.onmessage = function (e) {
      var s = JSON.parse(e.data);
      if (s.mode !== 'deck' || !s.deck) return location.replace('/screen');
      if (s.deck.url !== url) return location.replace(s.deck.url);
      if (slideshow.getCurrentSlideIndex() !== s.deck.slide) slideshow.gotoSlide(s.deck.slide + 1);
    };
  });
})();
