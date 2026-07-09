/* global React */
// Lore desktop — in-app sign-in / sign-up page. Replaces the bare browser launch:
// the user gets a real surface with clear state (idle → waiting for the browser →
// signed in / error), and on success the name + session propagate through onSignedIn.
const auNS = window.VaultDesignSystem_ffbf58;
const AuIcon = auNS.Icon;

function AuthModal({ onClose, onSignedIn }) {
  const [tab, setTab] = React.useState('signin'); // signin | signup (same Google flow, different copy)
  const [state, setState] = React.useState('idle'); // idle | connecting | success | error
  const [msg, setMsg] = React.useState('');
  const [who, setWho] = React.useState('');

  const go = async () => {
    if (!(window.lore && window.lore.auth && window.lore.auth.login)) {
      setState('error');setMsg('Sign-in isn’t configured in this build.');return;
    }
    setState('connecting');setMsg('');
    try {
      const r = await window.lore.auth.login();
      if (r && r.ok) {
        setWho(r.name || (r.email ? String(r.email).split('@')[0] : 'you'));
        setState('success');
        setTimeout(() => {if (onSignedIn) onSignedIn(r);}, 1200);
      } else {
        setState('error');
        setMsg(r && (r.detail || r.reason) || 'Sign-in didn’t complete.');
      }
    } catch {setState('error');setMsg('Sign-in failed — check your connection and try again.');}
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
    React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' } }, "Finish in your browser"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 12, color: 'var(--text-subtle)', marginTop: 1, lineHeight: 1.45 } }, "We opened Google sign-in \u2014 approve it there, then come back here.")
    )
    ) :
    state === 'success' ? /*#__PURE__*/
    React.createElement("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px', color: 'var(--success-fg)' } }, /*#__PURE__*/
    React.createElement(AuIcon, { name: "check-circle-2", size: 22 }), /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 14, fontWeight: 600 } }, "Signed in")
    ) : /*#__PURE__*/

    React.createElement(React.Fragment, null, /*#__PURE__*/
    React.createElement("button", { onClick: go,
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: 44, borderRadius: 10, border: '1px solid var(--border-strong)', background: 'var(--surface-base)', color: 'var(--text-strong)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600 },
      onMouseEnter: (e) => e.currentTarget.style.background = 'var(--surface-hover)',
      onMouseLeave: (e) => e.currentTarget.style.background = 'var(--surface-base)' }, /*#__PURE__*/
    React.createElement("svg", { width: "18", height: "18", viewBox: "0 0 48 48", "aria-hidden": "true" }, /*#__PURE__*/React.createElement("path", { fill: "#EA4335", d: "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" }), /*#__PURE__*/React.createElement("path", { fill: "#4285F4", d: "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" }), /*#__PURE__*/React.createElement("path", { fill: "#FBBC05", d: "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" }), /*#__PURE__*/React.createElement("path", { fill: "#34A853", d: "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" })), "Continue with Google"

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