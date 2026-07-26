// Lore GIS auth surface — runs Google Identity Services, hands the resulting
// token to the main process via the one-way bridge (auth-gis-preload.js), then
// the main process closes this window. Two modes, chosen by ?mode=:
//   login → google.accounts.id (rendered button + One Tap) → a `credential`
//           (ID token / JWT) → POSTed to /auth/google
//   gmail → google.accounts.oauth2.initTokenClient → an access token (gmail.readonly)
//           → POSTed to /connectors/gmail/sync
//
// Both use GIS's popup UX (a real accounts.google.com window the main process
// allow-lists), which is Google's supported path — unlike the OAuth authorization
// endpoint, which is blocked inside embedded app windows (disallowed_useragent).
/* global google */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') === 'gmail' ? 'gmail' : 'login';
  var embedded = params.get('embed') === '1';
  var cid = params.get('cid') || '';
  var scope = params.get('scope') || 'openid email profile';
  if (embedded) document.body.classList.add('embed');

  var statusEl = document.getElementById('status');
  var btnEl = document.getElementById('btn');
  var fallbackEl = document.getElementById('fallback');
  var titleEl = document.getElementById('title');
  var subEl = document.getElementById('sub');

  if (mode === 'gmail') {
    titleEl.textContent = 'Connect Gmail';
    subEl.textContent = 'Grant read-only access to turn emails into to-dos. This window closes when you’re done.';
  }

  var done = false;
  function relay(payload) {
    if (done) return;
    done = true;
    try {
      if (embedded && window.parent !== window) {
        window.parent.postMessage({ type: 'lore-google-auth', payload: payload }, '*');
      } else {
        window.__authBridge.result(payload);
      }
    } catch (e) { /* frame/window is closing */ }
  }
  function fail(msg) {
    // A real failure (not a user cancel): tell main so it can fall back to the
    // system-browser loopback flow, which always works even if this origin
    // isn't yet registered in the Google console.
    relay({ ok: false, error: msg || 'Google sign-in failed.' });
  }
  function showError(msg) {
    statusEl.className = 'err';
    statusEl.textContent = msg;
    if (fallbackEl) fallbackEl.hidden = embedded;
  }

  // The user's escape hatch: bail to the browser flow. Distinct from a plain
  // window-close (which main treats as "cancelled", no fallback).
  if (fallbackEl) {
    fallbackEl.addEventListener('click', function () { relay({ ok: false, error: 'fallback' }); });
  }

  // Wait for the async GIS client to load, then wire the chosen mode.
  var waited = 0;
  var poll = setInterval(function () {
    if (window.google && google.accounts) {
      clearInterval(poll);
      try { init(); } catch (e) { showError('Could not start Google sign-in.'); }
    } else if ((waited += 100) > 8000) {
      clearInterval(poll);
      showError('Couldn’t reach Google. Check your connection.');
    }
  }, 100);

  function init() {
    if (!cid) { showError('Google client id is missing.'); return; }
    statusEl.textContent = '';
    statusEl.className = '';
    if (fallbackEl) fallbackEl.hidden = embedded;   // no browser escape hatch in the embedded button
    if (mode === 'gmail') initGmail();
    else initLogin();
  }

  // --- Login: ID token via GIS (exactly WatchParty's <GoogleLogin>) -----------
  // Google's OWN rendered button + One Tap. Why not auto-open a popup on load?
  // Chromium blocks a programmatic window.open without a user gesture, so an
  // auto-launched chooser silently fails and you're left at a dead button. The
  // rendered button's click IS that gesture, so it reliably opens the chooser;
  // One Tap surfaces already-signed-in accounts with zero clicks. Either way GIS
  // returns a `credential` (ID token) straight to /auth/google — no code
  // exchange, no client_secret in this window.
  function initLogin() {
    google.accounts.id.initialize({
      client_id: cid,
      ux_mode: 'popup',
      auto_select: false,
      callback: function (resp) {
        if (resp && resp.credential) relay({ ok: true, mode: 'login', idToken: resp.credential });
        else fail('Google did not return a credential.');
      },
    });
    // The real Google button — the primary control, clicked once → account chooser.
    btnEl.innerHTML = '';
    google.accounts.id.renderButton(btnEl, {
      theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 360,
    });
    // One Tap: if this window already holds a Google session, show the account(s)
    // immediately — no button click. Harmless (no-op) when there's no session.
    if (!embedded) {
      try { google.accounts.id.prompt(); } catch (e) { /* One Tap unavailable; button still works */ }
    }
  }

  // --- Gmail: access token via the OAuth token client (popup UX) --------------
  function initGmail() {
    var tc = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: scope,
      ux_mode: 'popup',
      callback: function (resp) {
        if (resp && resp.access_token) relay({ ok: true, mode: 'gmail', accessToken: resp.access_token });
        else fail('Google did not return an access token.');
      },
      error_callback: function (err) {
        // A user-dismissed popup shouldn't nag with a browser fallback.
        if (err && (err.type === 'popup_closed' || err.type === 'popup_failed_to_open')) {
          relay({ ok: false, error: 'cancelled' });
        } else {
          fail((err && err.type) || 'Google sign-in failed.');
        }
      },
    });
    var b = document.createElement('button');
    b.id = 'connect';
    b.textContent = 'Connect Gmail';
    b.onclick = function () { statusEl.textContent = ''; statusEl.className = ''; tc.requestAccessToken(); };
    btnEl.innerHTML = '';
    btnEl.appendChild(b);
    // Kick it off immediately so the account chooser appears without an extra click.
    tc.requestAccessToken();
  }
})();
