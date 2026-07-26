// Lore GIS auth surface — runs Google Identity Services, hands the resulting
// token to the main process via the one-way bridge (auth-gis-preload.js), then
// the main process closes this window. Two modes, chosen by ?mode=:
//   login → google.accounts.oauth2.initCodeClient → an auth code → main exchanges
//           it for an ID token (JWT) → POSTed to /auth/google
//   gmail → google.accounts.oauth2.initTokenClient → an access token (gmail.readonly)
//           → POSTed to /connectors/gmail/sync
//
// Both use GIS's popup UX (a real accounts.google.com window the main process
// allow-lists), which is Google's supported path — unlike the OAuth authorization
// endpoint, which is blocked inside embedded app windows (disallowed_useragent).
//
// Crucially, BOTH auto-launch the account chooser the moment this window loads —
// no "click a second Google button" step. The user already chose Google in the
// app; this window jumps straight to picking an account.
/* global google */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') === 'gmail' ? 'gmail' : 'login';
  var cid = params.get('cid') || '';
  var scope = params.get('scope') || 'openid email profile';

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
    try { window.__authBridge.result(payload); } catch (e) { /* window is closing */ }
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
    if (fallbackEl) fallbackEl.hidden = false;
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
    if (fallbackEl) fallbackEl.hidden = false;   // always offer the browser escape hatch
    if (mode === 'gmail') initGmail();
    else initLogin();
  }

  // --- Login: auth code via the OAuth code client (popup UX) -----------------
  // We use the *code* client (not the id button) because requestCode() opens the
  // account chooser popup immediately — no second button to click. Popup mode
  // returns an authorization code to the callback; the main process exchanges it
  // (with the web client_secret, redirect_uri='postmessage') for the Google
  // ID token that /auth/google verifies. The secret never reaches this window.
  function initLogin() {
    var cc = google.accounts.oauth2.initCodeClient({
      client_id: cid,
      scope: scope,
      ux_mode: 'popup',
      select_account: true,
      callback: function (resp) {
        if (resp && resp.code) relay({ ok: true, mode: 'login', code: resp.code });
        else fail('Google did not return an authorization code.');
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
    // A visible button as the fallback if the auto-launched chooser is dismissed,
    // then kick the chooser off straight away.
    var b = document.createElement('button');
    b.id = 'connect';
    b.textContent = 'Choose a Google account';
    b.onclick = function () { statusEl.textContent = ''; statusEl.className = ''; cc.requestCode(); };
    btnEl.innerHTML = '';
    btnEl.appendChild(b);
    cc.requestCode();
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
