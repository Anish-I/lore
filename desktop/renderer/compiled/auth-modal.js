/* global React */
// Lore desktop in-app sign-in. Google's official button runs in a sandboxed
// localhost iframe; its attached GIS popup stays inside Electron, while Google's
// remote script remains isolated from Lore's vault/filesystem IPC bridge.
const auNS = window.VaultDesignSystem_ffbf58;
const AuIcon = auNS.Icon;

function AuthModal({ onClose, onSignedIn }) {
  const [tab, setTab] = React.useState('signin'); // signin | signup (same Google flow, different copy)
  const [state, setState] = React.useState('idle'); // idle | connecting | success | error
  const [msg, setMsg] = React.useState('');
  const [who, setWho] = React.useState('');
  const [googleCfg, setGoogleCfg] = React.useState(null);
  const [oktaAvailable, setOktaAvailable] = React.useState(false);
  const [googleFrameKey, setGoogleFrameKey] = React.useState(0);
  const googleFrameRef = React.useRef(null);
  const googleBusyRef = React.useRef(false);

  const finishAuth = React.useCallback((r) => {
    if (r && r.ok) {
      setWho(r.name || (r.email ? String(r.email).split('@')[0] : 'you'));
      setState('success');
      setTimeout(() => {if (onSignedIn) onSignedIn(r);}, 1200);
      return true;
    }
    googleBusyRef.current = false;
    setState('error');
    setMsg(r && (r.detail || r.reason) || 'Sign-in didn’t complete.');
    setGoogleFrameKey((n) => n + 1);
    return false;
  }, [onSignedIn]);

  React.useEffect(() => {
    let active = true;
    const fn = window.lore && window.lore.auth && window.lore.auth.googleConfig;
    if (!fn) {
      setGoogleCfg({ ok: false, reason: 'Google sign-in isn’t configured in this build.' });
      return undefined;
    }
    fn().
    then((cfg) => {if (active) setGoogleCfg(cfg && cfg.ok ? cfg : { ok: false, reason: cfg && cfg.reason || 'Google sign-in is unavailable.' });}).
    catch(() => {if (active) setGoogleCfg({ ok: false, reason: 'Could not start Google sign-in.' });});
    return () => {active = false;};
  }, []);

  React.useEffect(() => {
    let active = true;
    const fn = window.lore && window.lore.auth && window.lore.auth.oktaConfig;
    if (fn) {
      fn().
      then((cfg) => {if (active) setOktaAvailable(Boolean(cfg && cfg.ok));}).
      catch(() => {if (active) setOktaAvailable(false);});
    }
    return () => {active = false;};
  }, []);

  React.useEffect(() => {
    if (!googleCfg || !googleCfg.ok) return undefined;
    const onGoogleMessage = (event) => {
      if (event.origin !== googleCfg.origin) return;
      if (!googleFrameRef.current || event.source !== googleFrameRef.current.contentWindow) return;
      const message = event.data;
      if (!message || message.type !== 'lore-google-auth' || googleBusyRef.current) return;
      const payload = message.payload;
      if (!payload || !payload.ok || !payload.idToken) {
        setState('error');
        setMsg(payload && payload.error || 'Google sign-in didn’t complete.');
        setGoogleFrameKey((n) => n + 1);
        return;
      }
      const loginToken = window.lore && window.lore.auth && window.lore.auth.loginToken;
      if (!loginToken) {
        setState('error');
        setMsg('Google sign-in isn’t configured in this build.');
        return;
      }
      googleBusyRef.current = true;
      setState('connecting');
      setMsg('');
      loginToken(payload.idToken).
      then(finishAuth).
      catch(() => finishAuth({ ok: false, reason: 'Sign-in failed — check your connection and try again.' }));
    };
    window.addEventListener('message', onGoogleMessage);
    return () => window.removeEventListener('message', onGoogleMessage);
  }, [googleCfg, finishAuth]);

  // Okta remains a system-browser loopback because enterprise IdPs do not share
  // Google's GIS popup contract.
  const goOkta = async () => {
    const fn = window.lore && window.lore.auth && window.lore.auth.loginOkta;
    if (!fn) {
      setState('error');setMsg('Sign-in isn’t configured in this build.');return;
    }
    setState('connecting');setMsg('');
    try {
      const r = await fn();
      finishAuth(r);
    } catch {finishAuth({ ok: false, reason: 'Sign-in failed — check your connection and try again.' });}
  };

  React.useEffect(() => {
    const onKey = (e) => {if (e.key === 'Escape' && state !== 'connecting') onClose();};
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, state]);

  const isSignup = tab === 'signup';
  const tabBtn = (id, label) => /*#__PURE__*/
  React.createElement("button", { onClick: () => setTab(id), disabled: state === 'connecting',
    style: { flex: 1, height: 34, borderRadius: 8, border: '1px solid ' + (tab === id ? 'var(--brand-soft-border)' : 'transparent'),
      background: tab === id ? 'var(--brand-soft-bg)' : 'transparent', color: tab === id ? 'var(--brand-fg)' : 'var(--text-muted)',
      cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600 } }, label);


  return (/*#__PURE__*/
    React.createElement("div", { onClick: () => state !== 'connecting' && onClose(),
      style: { position: 'absolute', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--backdrop)', backdropFilter: 'blur(var(--backdrop-blur))' } }, /*#__PURE__*/
    React.createElement("div", { onClick: (e) => e.stopPropagation(),
      style: { width: 'min(440px, calc(100% - 48px))', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: 'var(--shadow-modal)', overflow: 'hidden', animation: 'lore-fade-in 150ms ease' } }, /*#__PURE__*/

    React.createElement("div", { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '26px 28px 8px', textAlign: 'center' } }, /*#__PURE__*/
    React.createElement("img", { src: "design/assets/logo/logomark.svg", alt: "", draggable: false, style: { width: 40, height: 40 } }), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' } },
    state === 'success' ? `Welcome, ${who}` : isSignup ? 'Create your Lore account' : 'Sign in to Lore'
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5, maxWidth: 340 } },
    state === 'success' ?
    'You’re signed in — your teams and shared pages will sync.' :
    'Sign in to enable Teams, sharing, and sync. Your notes stay on this computer until you move them.'
    )
    ),

    state !== 'success' && /*#__PURE__*/
    React.createElement("div", { style: { padding: '14px 24px 4px' } }, /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', gap: 6, padding: 4, background: 'var(--surface-inset)', borderRadius: 10 } },
    tabBtn('signin', 'Sign in'),
    tabBtn('signup', 'Sign up')
    )
    ), /*#__PURE__*/


    React.createElement("div", { style: { padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 } },
    state === 'connecting' ? /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-inset)' } }, /*#__PURE__*/
    React.createElement(AuIcon, { name: "loader", size: 18, style: { color: 'var(--brand-fg)', animation: 'lore-pulse 1s linear infinite', flexShrink: 0 } }), /*#__PURE__*/
    React.createElement("div", { style: { minWidth: 0 } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' } }, "Completing sign-in"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12, color: 'var(--text-subtle)', marginTop: 1, lineHeight: 1.45 } }, "Your identity provider verified your account. Lore is creating your session.")
    )
    ) :
    state === 'success' ? /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px', color: 'var(--success-fg)' } }, /*#__PURE__*/
    React.createElement(AuIcon, { name: "check-circle-2", size: 22 }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 14, fontWeight: 600 } }, "Signed in")
    ) : /*#__PURE__*/

    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("div", { style: { width: '100%', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
    googleCfg === null ? /*#__PURE__*/
    React.createElement(AuIcon, { name: "loader", size: 18, style: { color: 'var(--text-subtle)', animation: 'lore-pulse 1s linear infinite' } }) :
    googleCfg.ok ? /*#__PURE__*/
    React.createElement("iframe", {
      key: googleFrameKey,
      ref: googleFrameRef,
      src: googleCfg.url,
      title: "Continue with Google",
      sandbox: "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
      allow: "identity-credentials-get",
      style: { width: 360, maxWidth: '100%', height: 44, border: 0, background: 'transparent', overflow: 'hidden' } }
    ) : /*#__PURE__*/

    React.createElement("div", { style: { fontSize: 12, color: 'var(--danger-fg)', textAlign: 'center' } }, googleCfg.reason)

    ),


    !isSignup && oktaAvailable && /*#__PURE__*/
    React.createElement("button", { onClick: goOkta,
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 44, borderRadius: 10, border: '1px solid var(--border-strong)', background: 'var(--surface-base)', color: 'var(--text-strong)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600 },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
      onMouseLeave: (e) => e.currentTarget.style.background = 'var(--surface-base)' }, /*#__PURE__*/
    React.createElement("svg", { width: "17", height: "17", viewBox: "0 0 24 24", "aria-hidden": "true" }, /*#__PURE__*/React.createElement("circle", { cx: "12", cy: "12", r: "11", fill: "none", stroke: "var(--text-strong)", strokeWidth: "2.4" }), /*#__PURE__*/React.createElement("circle", { cx: "12", cy: "12", r: "4.4", fill: "var(--text-strong)" })), "Continue with Okta SSO"

    ),

    state === 'error' && /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--danger-fg)', lineHeight: 1.5 } }, /*#__PURE__*/
    React.createElement(AuIcon, { name: "alert-circle", size: 14, style: { flexShrink: 0, marginTop: 1 } }), msg
    ), /*#__PURE__*/

    React.createElement("div", { style: { fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', lineHeight: 1.5 } },
    isSignup ? 'Signing up with Google also signs you in.' : 'New to Lore? “Sign up” uses the same Google button.'
    )
    ),

    state !== 'connecting' && state !== 'success' && /*#__PURE__*/
    React.createElement("button", { onClick: onClose, style: { alignSelf: 'center', marginTop: 2, background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12 } }, "Not now")

    )
    )
    ));

}

window.LoreAuthModal = AuthModal;