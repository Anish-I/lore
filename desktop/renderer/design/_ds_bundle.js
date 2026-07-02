/* @ds-bundle: {"format":3,"namespace":"VaultDesignSystem_ffbf58","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Checkbox","sourcePath":"components/core/Checkbox.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Kbd","sourcePath":"components/core/Kbd.jsx"},{"name":"Select","sourcePath":"components/core/Select.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"Avatar","sourcePath":"components/data/Avatar.jsx"},{"name":"Badge","sourcePath":"components/data/Badge.jsx"},{"name":"Card","sourcePath":"components/data/Card.jsx"},{"name":"ScopeTag","sourcePath":"components/data/ScopeTag.jsx"},{"name":"Tabs","sourcePath":"components/data/Tabs.jsx"},{"name":"Tooltip","sourcePath":"components/data/Tooltip.jsx"},{"name":"AskMessage","sourcePath":"components/knowledge/AskMessage.jsx"},{"name":"CitationChip","sourcePath":"components/knowledge/CitationChip.jsx"},{"name":"EvidenceRow","sourcePath":"components/knowledge/EvidenceRow.jsx"},{"name":"FileTreeItem","sourcePath":"components/knowledge/FileTreeItem.jsx"},{"name":"NoteCard","sourcePath":"components/knowledge/NoteCard.jsx"},{"name":"ScopePicker","sourcePath":"components/knowledge/ScopePicker.jsx"},{"name":"WikiLink","sourcePath":"components/knowledge/WikiLink.jsx"}],"sourceHashes":{"components/core/Button.jsx":"af276ad56688","components/core/Checkbox.jsx":"10b48cd858b1","components/core/Icon.jsx":"242514ba6bd4","components/core/IconButton.jsx":"1085e7de20f7","components/core/Input.jsx":"6e2470f6253b","components/core/Kbd.jsx":"000b4dd0a986","components/core/Select.jsx":"bb2738ef0ee2","components/core/Switch.jsx":"e0570945ddc5","components/data/Avatar.jsx":"68b9dcac4b8a","components/data/Badge.jsx":"33d739332f9b","components/data/Card.jsx":"cbb8c676e054","components/data/ScopeTag.jsx":"9e6fa57e26dd","components/data/Tabs.jsx":"b7362838f41a","components/data/Tooltip.jsx":"7291ce6bd9f3","components/knowledge/AskMessage.jsx":"f075913c4e13","components/knowledge/CitationChip.jsx":"2a45b8f29f14","components/knowledge/EvidenceRow.jsx":"7675a18d1056","components/knowledge/FileTreeItem.jsx":"65dccc1d5403","components/knowledge/NoteCard.jsx":"5786369c8be5","components/knowledge/ScopePicker.jsx":"725954759733","components/knowledge/WikiLink.jsx":"26c6b578182c","ui_kits/lore-desktop/app.jsx":"f94568e6dd72","ui_kits/lore-desktop/ask.jsx":"391ab5446f11","ui_kits/lore-desktop/buckets.jsx":"7d854e59454c","ui_kits/lore-desktop/data.js":"f5a76ef3f6e3","ui_kits/lore-desktop/editor.jsx":"84dcf0451ed6","ui_kits/lore-desktop/projects.jsx":"ad74557f4a9b","ui_kits/lore-desktop/settings.jsx":"20892bdc48b1","ui_kits/lore-desktop/shell.jsx":"86f6a5b26069"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.VaultDesignSystem_ffbf58 = window.VaultDesignSystem_ffbf58 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Checkbox.jsx
try { (() => {
/** Checkbox — square, amber when checked. */
function Checkbox({
  checked = false,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 9,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontSize: 14,
      color: 'var(--text-body)',
      userSelect: 'none',
      ...style
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 17,
      height: 17,
      borderRadius: 'var(--radius-xs)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: on ? 'var(--brand-bg)' : 'var(--surface-inset)',
      border: `1px solid ${on ? 'var(--brand-bg)' : hover ? 'var(--border-strong)' : 'var(--border-field)'}`,
      transition: 'var(--transition-surface)',
      flexShrink: 0
    }
  }, checked && !indeterminate && /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6.2l2.3 2.3 4.7-5",
    stroke: "var(--text-onbrand)",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), indeterminate && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 2,
      borderRadius: 1,
      background: 'var(--text-onbrand)'
    }
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/**
 * Icon — thin wrapper over Lucide (the icon set Lore uses).
 * Requires the Lucide UMD global to be present on the page
 * (<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js">).
 */
function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  color,
  className,
  style,
  title
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    host.appendChild(i);
    try {
      window.lucide.createIcons({
        attrs: {
          'stroke-width': strokeWidth,
          width: size,
          height: size
        }
      });
    } catch (e) {/* lucide not ready */}
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    role: title ? 'img' : undefined,
    "aria-label": title,
    "aria-hidden": title ? undefined : true,
    className: className,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      color: color || 'currentColor',
      flexShrink: 0,
      lineHeight: 0,
      ...style
    }
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — Lore's primary action control.
 * Sentence-case labels. Amber primary; quiet secondary/ghost; clay danger.
 */
function Button({
  children,
  variant = 'secondary',
  // 'primary' | 'secondary' | 'ghost' | 'danger'
  size = 'md',
  // 'sm' | 'md' | 'lg'
  icon,
  // lucide name, leading
  iconTrailing,
  // lucide name, trailing
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  onClick,
  style,
  ...rest
}) {
  const heights = {
    sm: 28,
    md: 34,
    lg: 40
  };
  const pads = {
    sm: '0 10px',
    md: '0 14px',
    lg: '0 18px'
  };
  const fonts = {
    sm: 13,
    md: 14,
    lg: 15
  };
  const iconSizes = {
    sm: 15,
    md: 16,
    lg: 18
  };
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: size === 'sm' ? 6 : 8,
    height: heights[size],
    padding: pads[size],
    width: fullWidth ? '100%' : undefined,
    fontFamily: 'var(--font-sans)',
    fontSize: fonts[size],
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: '-0.005em',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    whiteSpace: 'nowrap',
    transition: 'var(--transition-surface), color var(--dur-fast) var(--ease-out)',
    userSelect: 'none',
    WebkitUserSelect: 'none'
  };
  const variants = {
    primary: {
      background: 'var(--brand-bg)',
      color: 'var(--text-onbrand)',
      borderColor: 'transparent'
    },
    secondary: {
      background: 'var(--surface-raised)',
      color: 'var(--text-strong)',
      borderColor: 'var(--border)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-muted)',
      borderColor: 'transparent'
    },
    danger: {
      background: 'var(--danger-bg)',
      color: 'var(--danger-fg)',
      borderColor: 'var(--danger-border)'
    }
  };
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const hoverStyle = !disabled && !loading && hover ? {
    primary: {
      background: 'var(--brand-bg-hover)'
    },
    secondary: {
      background: 'var(--surface-overlay)',
      borderColor: 'var(--border-strong)'
    },
    ghost: {
      background: 'var(--surface-hover)',
      color: 'var(--text-strong)'
    },
    danger: {
      background: 'color-mix(in srgb, var(--danger-bg) 70%, var(--clay-500) 18%)'
    }
  }[variant] : null;
  const activeStyle = active && !disabled && !loading ? {
    transform: 'translateY(0.5px)'
  } : null;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled || loading,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      ...base,
      ...variants[variant],
      ...hoverStyle,
      ...activeStyle,
      ...style
    }
  }, rest), loading && /*#__PURE__*/React.createElement(Spinner, {
    size: iconSizes[size]
  }), !loading && icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: iconSizes[size]
  }), children && /*#__PURE__*/React.createElement("span", null, children), !loading && iconTrailing && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconTrailing,
    size: iconSizes[size]
  }));
}
function Spinner({
  size = 16
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      opacity: 0.7,
      animation: 'lore-spin 0.7s linear infinite',
      flexShrink: 0
    }
  });
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * IconButton — square, icon-only control for toolbars and dense chrome.
 */
function IconButton({
  icon,
  label,
  // accessible label (required-ish)
  size = 'md',
  // 'sm' | 'md' | 'lg'
  variant = 'ghost',
  // 'ghost' | 'subtle' | 'primary'
  active = false,
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const dims = {
    sm: 28,
    md: 32,
    lg: 38
  };
  const iconSizes = {
    sm: 16,
    md: 18,
    lg: 20
  };
  const [hover, setHover] = React.useState(false);
  const variants = {
    ghost: {
      background: active ? 'var(--surface-active)' : 'transparent',
      color: active ? 'var(--brand-fg)' : 'var(--text-muted)'
    },
    subtle: {
      background: 'var(--surface-raised)',
      color: 'var(--text-strong)',
      border: '1px solid var(--border)'
    },
    primary: {
      background: 'var(--brand-bg)',
      color: 'var(--text-onbrand)'
    }
  };
  const hoverBg = hover && !disabled ? variant === 'primary' ? {
    background: 'var(--brand-bg-hover)'
  } : {
    background: 'var(--surface-hover)',
    color: 'var(--text-strong)'
  } : null;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dims[size],
      height: dims[size],
      borderRadius: 'var(--radius-sm)',
      border: '1px solid transparent',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'var(--transition-surface)',
      ...variants[variant],
      ...hoverBg,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: iconSizes[size]
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Input — single-line text field. Supports leading icon, prefix/suffix, sizes, error.
 */
function Input({
  value,
  defaultValue,
  placeholder,
  type = 'text',
  size = 'md',
  // 'sm' | 'md' | 'lg'
  icon,
  // leading lucide name
  suffix,
  // node rendered at the end (e.g. Kbd)
  invalid = false,
  disabled = false,
  fullWidth = false,
  onChange,
  style,
  ...rest
}) {
  const heights = {
    sm: 28,
    md: 34,
    lg: 40
  };
  const fonts = {
    sm: 13,
    md: 14,
    lg: 15
  };
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      width: fullWidth ? '100%' : undefined,
      height: heights[size],
      padding: '0 10px',
      background: 'var(--surface-inset)',
      border: `1px solid ${invalid ? 'var(--danger-border)' : focus ? 'var(--ring)' : 'var(--border-field)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focus ? 'var(--glow-brand)' : 'none',
      opacity: disabled ? 0.55 : 1,
      transition: 'var(--transition-surface)',
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: fonts[size] + 2,
    style: {
      color: 'var(--text-subtle)'
    }
  }), /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    value: value,
    defaultValue: defaultValue,
    placeholder: placeholder,
    disabled: disabled,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize: fonts[size],
      color: 'var(--text-strong)'
    }
  }, rest)), suffix);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Kbd.jsx
try { (() => {
/** Kbd — keyboard shortcut key, mono. */
function Kbd({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("kbd", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 18,
      height: 19,
      padding: '0 5px',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      lineHeight: 1,
      color: 'var(--text-muted)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-strong)',
      borderBottomWidth: 2,
      borderRadius: 'var(--radius-sm)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Kbd });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Kbd.jsx", error: String((e && e.message) || e) }); }

// components/core/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Select — native-backed dropdown styled to match Input. */
function Select({
  value,
  defaultValue,
  options = [],
  size = 'md',
  disabled = false,
  fullWidth = false,
  onChange,
  style,
  ...rest
}) {
  const heights = {
    sm: 28,
    md: 34,
    lg: 40
  };
  const fonts = {
    sm: 13,
    md: 14,
    lg: 15
  };
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      width: fullWidth ? '100%' : undefined,
      height: heights[size],
      background: 'var(--surface-inset)',
      border: `1px solid ${focus ? 'var(--ring)' : 'var(--border-field)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focus ? 'var(--glow-brand)' : 'none',
      opacity: disabled ? 0.55 : 1,
      transition: 'var(--transition-surface)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    defaultValue: defaultValue,
    disabled: disabled,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      width: fullWidth ? '100%' : undefined,
      height: '100%',
      padding: '0 30px 0 10px',
      fontFamily: 'var(--font-sans)',
      fontSize: fonts[size],
      color: 'var(--text-strong)',
      cursor: disabled ? 'not-allowed' : 'pointer'
    }
  }, rest), options.map(o => {
    const opt = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 15,
    style: {
      position: 'absolute',
      right: 9,
      pointerEvents: 'none',
      color: 'var(--text-subtle)'
    }
  }));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Select.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
/** Switch — toggle for settings; amber track when on. */
function Switch({
  checked = false,
  disabled = false,
  label,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontSize: 14,
      color: 'var(--text-body)',
      userSelect: 'none',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 34,
      height: 20,
      borderRadius: 'var(--radius-full)',
      padding: 2,
      background: checked ? 'var(--brand-bg)' : 'var(--surface-overlay)',
      border: `1px solid ${checked ? 'var(--brand-bg)' : 'var(--border-field)'}`,
      display: 'inline-flex',
      alignItems: 'center',
      transition: 'var(--transition-surface)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      borderRadius: '50%',
      background: checked ? 'var(--text-onbrand)' : 'var(--obsidian-200)',
      transform: checked ? 'translateX(14px)' : 'translateX(0)',
      transition: 'transform var(--dur-base) var(--ease-out)',
      boxShadow: 'var(--shadow-xs)'
    }
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/data/Avatar.jsx
try { (() => {
const PALETTE = [{
  bg: 'var(--amber-600)',
  fg: '#1c1408'
}, {
  bg: 'var(--azure-600)',
  fg: '#fff'
}, {
  bg: 'var(--jade-600)',
  fg: '#fff'
}, {
  bg: 'var(--clay-500)',
  fg: '#fff'
}, {
  bg: 'var(--obsidian-500)',
  fg: '#fff'
}];
function hashIndex(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = h * 31 + str.charCodeAt(i) >>> 0;
  return h % PALETTE.length;
}

/** Avatar — initials or image, circular. Color derived from name. */
function Avatar({
  name = '',
  src,
  size = 28,
  scope,
  style
}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const c = PALETTE[hashIndex(name)];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      flexShrink: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: src ? 'transparent' : c.bg,
      color: c.fg,
      overflow: 'hidden',
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      fontSize: size * 0.4,
      lineHeight: 1,
      border: '1px solid var(--border-subtle)'
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials), scope && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: size * 0.34,
      height: size * 0.34,
      borderRadius: '50%',
      border: '2px solid var(--surface-panel)',
      background: scope === 'team' ? 'var(--jade-400)' : scope === 'enterprise' ? 'var(--azure-400)' : 'var(--obsidian-300)'
    }
  }));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/data/Badge.jsx
try { (() => {
/** Badge — small status/label pill. */
function Badge({
  children,
  tone = 'neutral',
  icon,
  dot = false,
  style
}) {
  const tones = {
    neutral: {
      bg: 'var(--surface-raised)',
      fg: 'var(--text-muted)',
      bd: 'var(--border)'
    },
    brand: {
      bg: 'var(--brand-soft-bg)',
      fg: 'var(--brand-fg)',
      bd: 'var(--brand-soft-border)'
    },
    success: {
      bg: 'var(--success-bg)',
      fg: 'var(--success-fg)',
      bd: 'var(--success-border)'
    },
    danger: {
      bg: 'var(--danger-bg)',
      fg: 'var(--danger-fg)',
      bd: 'var(--danger-border)'
    },
    info: {
      bg: 'var(--info-bg)',
      fg: 'var(--info-fg)',
      bd: 'var(--info-border)'
    },
    warning: {
      bg: 'var(--warning-bg)',
      fg: 'var(--warning-fg)',
      bd: 'var(--warning-border)'
    }
  };
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      height: 20,
      padding: '0 8px',
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      fontWeight: 500,
      lineHeight: 1,
      color: t.fg,
      background: t.bg,
      border: `1px solid ${t.bd}`,
      borderRadius: 'var(--radius-full)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: t.fg
    }
  }), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 12
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Badge.jsx", error: String((e && e.message) || e) }); }

// components/data/Card.jsx
try { (() => {
/** Card — bordered surface container. Border-first; optional raise. */
function Card({
  children,
  raised = false,
  interactive = false,
  padding = 16,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: raised ? 'var(--surface-raised)' : 'var(--surface-panel)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: raised ? 'var(--shadow-sm)' : 'none',
      padding,
      cursor: interactive ? 'pointer' : 'default',
      transition: 'var(--transition-surface)',
      ...(interactive && hover ? {
        borderColor: 'var(--border-strong)',
        background: 'var(--surface-raised)'
      } : null),
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Card.jsx", error: String((e && e.message) || e) }); }

// components/data/ScopeTag.jsx
try { (() => {
/**
 * ScopeTag — the permission chip. private / team / enterprise.
 * Central to Lore: every note carries exactly one scope.
 */
function ScopeTag({
  scope = null,
  size = 'md',
  showLabel = true,
  style
}) {
  const clean = scope == null ? null : String(scope).trim();
  if (!clean) return null;
  const map = {
    private: {
      icon: 'lock',
      label: 'private',
      fg: 'var(--scope-private-fg)',
      bg: 'var(--scope-private-bg)',
      dot: 'var(--obsidian-200)'
    },
    team: {
      icon: 'users',
      label: 'team',
      fg: 'var(--scope-team-fg)',
      bg: 'var(--scope-team-bg)',
      dot: 'var(--jade-400)'
    },
    enterprise: {
      icon: 'building-2',
      label: 'enterprise',
      fg: 'var(--scope-ent-fg)',
      bg: 'var(--scope-ent-bg)',
      dot: 'var(--azure-400)'
    }
  };
  const s = map[clean] || {
    icon: 'tag',
    label: clean,
    fg: 'var(--brand-fg)',
    bg: 'var(--surface-inset)',
    dot: 'var(--brand-fg)'
  };
  const sm = size === 'sm';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: sm ? 4 : 5,
      height: sm ? 18 : 22,
      padding: sm ? '0 7px' : '0 9px',
      fontFamily: 'var(--font-mono)',
      fontSize: sm ? 11 : 12,
      lineHeight: 1,
      color: s.fg,
      background: s.bg,
      borderRadius: 'var(--radius-full)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: s.icon,
    size: sm ? 11 : 13
  }), showLabel && s.label);
}
Object.assign(__ds_scope, { ScopeTag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ScopeTag.jsx", error: String((e && e.message) || e) }); }

// components/data/Tabs.jsx
try { (() => {
/** Tabs — underline style, sentence case. */
function Tabs({
  tabs = [],
  value,
  onChange,
  style
}) {
  const [internal, setInternal] = React.useState(value || tabs[0] && (tabs[0].value || tabs[0]));
  const active = value !== undefined ? value : internal;
  const set = v => {
    setInternal(v);
    onChange && onChange(v);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 2,
      borderBottom: '1px solid var(--divider)',
      ...style
    }
  }, tabs.map(t => {
    const tab = typeof t === 'string' ? {
      value: t,
      label: t
    } : t;
    const on = tab.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: tab.value,
      type: "button",
      onClick: () => set(tab.value),
      style: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: on ? 600 : 500,
        color: on ? 'var(--text-strong)' : 'var(--text-subtle)',
        transition: 'var(--transition-color)'
      }
    }, tab.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: on ? 'var(--brand-fg)' : 'var(--text-faint)'
      }
    }, tab.count), tab.label, /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        left: 6,
        right: 6,
        bottom: -1,
        height: 2,
        borderRadius: 2,
        background: on ? 'var(--brand-bg)' : 'transparent',
        transition: 'var(--transition-color)'
      }
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/data/Tooltip.jsx
try { (() => {
/** Tooltip — hover label. Dark popover, mono-ish small text. */
function Tooltip({
  children,
  label,
  side = 'top',
  kbd,
  style
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translate(-50%, -6px)'
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translate(-50%, 6px)'
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translate(-6px, -50%)'
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translate(6px, -50%)'
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false)
  }, children, show && label && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      ...pos[side],
      zIndex: 50,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      padding: '5px 9px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--border-strong)',
      boxShadow: 'var(--shadow-md)',
      whiteSpace: 'nowrap',
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      color: 'var(--text-strong)',
      animation: 'lore-fade-in var(--dur-fast) var(--ease-out)',
      ...style
    }
  }, label, kbd && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, kbd)));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/knowledge/AskMessage.jsx
try { (() => {
/**
 * AskMessage — a turn in the Ask panel.
 * `role="user"` = the question. `role="answer"` = Lore's cited reply
 * (pass the answer text as children; embed <CitationChip> inline).
 */
function AskMessage({
  role = 'answer',
  children,
  sources,
  scopes,
  streaming = false,
  style
}) {
  if (role === 'user') {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'flex-end',
        margin: '4px 0',
        ...style
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '82%',
        padding: '9px 13px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        fontSize: 14,
        lineHeight: 1.5,
        color: 'var(--text-strong)'
      }
    }, children));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      margin: '10px 0',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      width: 26,
      height: 26,
      borderRadius: 'var(--radius-sm)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--brand-soft-bg)',
      border: '1px solid var(--brand-soft-border)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "sparkles",
    size: 15,
    style: {
      color: 'var(--brand-fg)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 15,
      lineHeight: 1.62,
      color: 'var(--text-body)'
    }
  }, children, streaming && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      width: 7,
      height: 16,
      marginLeft: 2,
      background: 'var(--brand-bg)',
      verticalAlign: 'text-bottom',
      animation: 'lore-caret 1s step-end infinite'
    }
  })), (sources != null || scopes) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 9,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "quote",
    size: 12,
    style: {
      color: 'var(--text-subtle)'
    }
  }), sources != null && /*#__PURE__*/React.createElement("span", null, sources, " sources"), scopes && /*#__PURE__*/React.createElement("span", null, "\xB7 ", scopes))));
}
Object.assign(__ds_scope, { AskMessage });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/knowledge/AskMessage.jsx", error: String((e && e.message) || e) }); }

// components/knowledge/CitationChip.jsx
try { (() => {
/**
 * CitationChip — a numbered, inline reference to a source note.
 * The amber number ties back to the evidence list; hover reveals provenance.
 */
function CitationChip({
  index = 1,
  note,
  heading,
  scope,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, /*#__PURE__*/React.createElement("sup", {
    onClick: onClick,
    style: {
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1,
      color: 'var(--text-onbrand)',
      background: 'var(--brand-bg)',
      borderRadius: 'var(--radius-xs)',
      padding: '1px 4px',
      margin: '0 1px',
      verticalAlign: 'super',
      ...style
    }
  }, index), hover && note && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translate(-50%, -6px)',
      zIndex: 50,
      minWidth: 200,
      maxWidth: 280,
      padding: '8px 10px',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)',
      animation: 'lore-fade-in var(--dur-fast) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      color: 'var(--brand-fg)'
    }
  }, "[", index, "]"), note), heading && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      marginTop: 3,
      fontSize: 11,
      color: 'var(--text-subtle)'
    }
  }, heading), scope && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      marginTop: 5,
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, "scope \xB7 ", scope)));
}
Object.assign(__ds_scope, { CitationChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/knowledge/CitationChip.jsx", error: String((e && e.message) || e) }); }

// components/knowledge/EvidenceRow.jsx
try { (() => {
/**
 * EvidenceRow — one line of the "why this was retrieved" trail.
 * Shows the citation index, source note, retrieval lane, and score.
 * Mirrors the engine's `why_retrieved` output (recall.py).
 */
function EvidenceRow({
  index = 1,
  note,
  heading,
  scope = null,
  lane = 'hybrid',
  score = 0.0,
  owner,
  onOpen,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const laneColor = {
    dense: 'var(--azure-300)',
    sparse: 'var(--brand-fg)',
    bm25: 'var(--brand-fg)',
    hybrid: 'var(--jade-300)',
    graph: 'var(--azure-300)',
    rerank: 'var(--text-muted)'
  }[lane] || 'var(--text-muted)';
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: onOpen,
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '9px 10px',
      borderRadius: 'var(--radius-sm)',
      cursor: onOpen ? 'pointer' : 'default',
      background: hover && onOpen ? 'var(--surface-hover)' : 'transparent',
      transition: 'var(--transition-surface)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      marginTop: 1,
      width: 18,
      height: 18,
      borderRadius: 'var(--radius-xs)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-onbrand)',
      background: 'var(--brand-bg)'
    }
  }, index), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "file-text",
    size: 13,
    style: {
      color: 'var(--text-subtle)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-strong)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, note), heading && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-faint)'
    }
  }, "\u203A ", heading)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 5,
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: laneColor
    }
  }, lane), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "score ", Number(score).toFixed(3)), owner && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "\xB7 ", owner), scope && /*#__PURE__*/React.createElement(__ds_scope.ScopeTag, {
    scope: scope,
    size: "sm",
    showLabel: false,
    style: {
      marginLeft: 'auto'
    }
  }))));
}
Object.assign(__ds_scope, { EvidenceRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/knowledge/EvidenceRow.jsx", error: String((e && e.message) || e) }); }

// components/knowledge/FileTreeItem.jsx
try { (() => {
/** FileTreeItem — a row in the vault file tree (folder or note). */
function FileTreeItem({
  name,
  kind = 'note',
  depth = 0,
  open = false,
  active = false,
  scope,
  indexed,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const isFolder = kind === 'folder';
  const icon = isFolder ? open ? 'folder-open' : 'folder' : 'file-text';
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      paddingRight: 8,
      paddingLeft: 8 + depth * 14,
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: active ? 'var(--surface-selected)' : hover ? 'var(--surface-hover)' : 'transparent',
      transition: 'background var(--dur-fast) var(--ease-out)',
      ...style
    }
  }, isFolder && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 13,
    style: {
      color: 'var(--text-faint)',
      transform: open ? 'rotate(90deg)' : 'none',
      transition: 'transform var(--dur-fast) var(--ease-out)'
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14,
    style: {
      color: active ? 'var(--brand-fg)' : isFolder ? 'var(--text-subtle)' : 'var(--text-faint)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      lineHeight: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: active ? 'var(--text-strong)' : 'var(--text-body)',
      fontWeight: active ? 600 : 400
    }
  }, name), indexed && /*#__PURE__*/React.createElement("span", {
    title: "indexed",
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--jade-400)',
      flexShrink: 0
    }
  }), scope === 'private' && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "lock",
    size: 11,
    style: {
      color: 'var(--text-faint)'
    }
  }), scope === 'team' && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "users",
    size: 11,
    style: {
      color: 'var(--scope-team-fg)'
    }
  }), scope === 'enterprise' && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "building-2",
    size: 11,
    style: {
      color: 'var(--scope-ent-fg)'
    }
  }), scope && !['private', 'team', 'enterprise'].includes(scope) && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "tag",
    size: 11,
    title: String(scope),
    style: {
      color: 'var(--brand-fg)'
    }
  }));
}
Object.assign(__ds_scope, { FileTreeItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/knowledge/FileTreeItem.jsx", error: String((e && e.message) || e) }); }

// components/knowledge/NoteCard.jsx
try { (() => {
/** NoteCard — a note preview: title, snippet, scope, owner, updated, link count. */
function NoteCard({
  title,
  snippet,
  scope = null,
  owner,
  updated,
  links,
  tags = [],
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: hover ? 'var(--surface-raised)' : 'var(--surface-panel)',
      border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-md)',
      padding: 14,
      cursor: onClick ? 'pointer' : 'default',
      transition: 'var(--transition-surface)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "file-text",
    size: 15,
    style: {
      color: 'var(--brand-fg)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-strong)',
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, title), scope && /*#__PURE__*/React.createElement(__ds_scope.ScopeTag, {
    scope: scope,
    size: "sm"
  })), snippet && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 13,
      lineHeight: 1.5,
      color: 'var(--text-muted)',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden'
    }
  }, snippet), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginTop: 10,
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--text-faint)'
    }
  }, owner && /*#__PURE__*/React.createElement("span", null, owner), updated && /*#__PURE__*/React.createElement("span", null, "\xB7 ", updated), links != null && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "link-2",
    size: 11
  }), links), tags.length > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      color: 'var(--link-fg)'
    }
  }, tags.map(t => '#' + t).join(' '))));
}
Object.assign(__ds_scope, { NoteCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/knowledge/NoteCard.jsx", error: String((e && e.message) || e) }); }

// components/knowledge/ScopePicker.jsx
try { (() => {
/** ScopePicker — segmented control for choosing a note's scope. */
function ScopePicker({
  value = null,
  onChange,
  options,
  style
}) {
  const defaults = [{
    v: 'private',
    icon: 'lock',
    label: 'private'
  }, {
    v: 'team',
    icon: 'users',
    label: 'team'
  }, {
    v: 'enterprise',
    icon: 'building-2',
    label: 'enterprise'
  }];
  const clean = Array.isArray(options) && options.length ? options.map(o => typeof o === 'string' ? {
    v: o,
    icon: 'tag',
    label: o
  } : {
    v: o.value || o.v,
    icon: o.icon || 'tag',
    label: o.label || o.value || o.v
  }).filter(o => o.v) : defaults;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      padding: 3,
      gap: 2,
      background: 'var(--surface-inset)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      ...style
    }
  }, clean.map(o => {
    const on = o.v === value;
    return /*#__PURE__*/React.createElement("button", {
      key: o.v,
      type: "button",
      onClick: () => onChange && onChange(o.v),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        background: on ? 'var(--surface-selected)' : 'transparent',
        color: on ? 'var(--brand-fg)' : 'var(--text-subtle)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontWeight: on ? 600 : 400,
        transition: 'var(--transition-surface)'
      }
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: o.icon,
      size: 13
    }), o.label);
  }));
}
Object.assign(__ds_scope, { ScopePicker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/knowledge/ScopePicker.jsx", error: String((e && e.message) || e) }); }

// components/knowledge/WikiLink.jsx
try { (() => {
/** WikiLink — inline [[link]] in azure (the connection color). */
function WikiLink({
  children,
  exists = true,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      cursor: 'pointer',
      color: exists ? 'var(--link-fg)' : 'var(--text-faint)',
      background: hover ? 'var(--link-soft-bg)' : 'transparent',
      borderRadius: 'var(--radius-xs)',
      padding: '0 3px',
      textDecoration: exists ? 'none' : 'underline dotted',
      textUnderlineOffset: 2,
      transition: 'var(--transition-surface)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { WikiLink });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/knowledge/WikiLink.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/app.jsx
try { (() => {
/* global React */
// Lore desktop — root app: state, navigation, streaming Ask
const D = window.LoreData;
function toggleFolder(tree, id) {
  return tree.map(n => n.id === id ? {
    ...n,
    open: !n.open
  } : n.children ? {
    ...n,
    children: toggleFolder(n.children, id)
  } : n);
}
function App() {
  const [theme, setTheme] = React.useState('dark');
  const [view, setView] = React.useState('workspace');
  const [activeNote, setActiveNote] = React.useState(null);
  const [askOpen, setAskOpen] = React.useState(false);
  const [tree, setTree] = React.useState(D.tree);
  const [mode, setMode] = React.useState('read');
  const [scope, setScope] = React.useState(null);
  const [messages, setMessages] = React.useState([]);
  const [asking, setAsking] = React.useState(false);
  const timer = React.useRef(null);
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const note = activeNote ? D.notes[activeNote] : null;
  const openNote = id => {
    if (D.notes[id]) setActiveNote(id);
    setView('workspace');
  };
  const onView = v => {
    setView(v === 'search' ? 'workspace' : v);
  };
  const ask = q => {
    setAsking(true);
    const a = D.ask;
    setMessages(m => [...m, {
      role: 'user',
      text: q
    }, {
      role: 'answer',
      runs: a.answerRuns,
      shown: [],
      streaming: true
    }]);
    let i = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      i += 1;
      setMessages(m => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (!last || last.role !== 'answer') return m;
        const shown = a.answerRuns.slice(0, i);
        if (i >= a.answerRuns.length) {
          clearInterval(timer.current);
          copy[copy.length - 1] = {
            ...last,
            shown,
            streaming: false,
            sources: a.sources,
            scopes: a.scopes,
            evidence: a.evidence
          };
          setAsking(false);
        } else {
          copy[copy.length - 1] = {
            ...last,
            shown
          };
        }
        return copy;
      });
    }, 240);
  };
  React.useEffect(() => () => clearInterval(timer.current), []);
  const Titlebar = window.LoreTitlebar,
    Rail = window.LoreActivityRail,
    Sidebar = window.LoreSidebar,
    StatusBar = window.LoreStatusBar,
    Editor = window.LoreEditor,
    ContextPane = window.LoreContextPane,
    AskPanel = window.LoreAskPanel,
    ProjectsView = window.LoreProjectsView,
    GraphView = window.LoreGraphView,
    BucketsView = window.LoreBucketsView,
    SettingsView = window.LoreSettingsView;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-sunken)'
    }
  }, /*#__PURE__*/React.createElement(Titlebar, {
    theme: theme,
    onToggleTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
    onAsk: () => setAskOpen(true),
    onSettings: () => setView('settings')
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(Rail, {
    view: view,
    askOpen: askOpen,
    onView: onView,
    onAsk: () => setAskOpen(o => !o)
  }), view === 'workspace' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Sidebar, {
    tree: tree,
    activeNote: activeNote,
    workspace: D.workspace,
    onOpen: openNote,
    onToggle: id => setTree(t => toggleFolder(t, id))
  }), /*#__PURE__*/React.createElement(Editor, {
    note: note,
    mode: mode,
    onMode: setMode,
    onOpen: openNote,
    scope: scope,
    onScope: setScope
  }), askOpen ? /*#__PURE__*/React.createElement(AskPanel, {
    messages: messages,
    asking: asking,
    suggestions: D.ask.suggestions,
    onSend: ask,
    onClose: () => setAskOpen(false)
  }) : /*#__PURE__*/React.createElement(ContextPane, {
    note: note,
    onAsk: () => setAskOpen(true)
  })), view === 'projects' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ProjectsView, {
    projects: D.projects,
    groups: D.groups,
    onOpen: () => {
      setView('workspace');
    }
  }), askOpen && /*#__PURE__*/React.createElement(AskPanel, {
    messages: messages,
    asking: asking,
    suggestions: D.ask.suggestions,
    onSend: ask,
    onClose: () => setAskOpen(false)
  })), view === 'graph' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(GraphView, {
    graph: D.graph,
    onOpen: openNote
  }), askOpen && /*#__PURE__*/React.createElement(AskPanel, {
    messages: messages,
    asking: asking,
    suggestions: D.ask.suggestions,
    onSend: ask,
    onClose: () => setAskOpen(false)
  })), view === 'buckets' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(BucketsView, {
    buckets: D.buckets,
    onAsk: () => setAskOpen(true)
  }), askOpen && /*#__PURE__*/React.createElement(AskPanel, {
    messages: messages,
    asking: asking,
    suggestions: D.ask.suggestions,
    onSend: ask,
    onClose: () => setAskOpen(false)
  })), view === 'settings' && /*#__PURE__*/React.createElement(SettingsView, {
    settings: D.settings
  })), /*#__PURE__*/React.createElement(StatusBar, null));
}
window.LoreApp = App;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/ask.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* global React */
// Lore desktop — Ask panel (cited recall chatbot + evidence trail)
const akNS = window.VaultDesignSystem_ffbf58;
const {
  Icon: AkIcon,
  IconButton: AkIconBtn,
  AskMessage,
  CitationChip,
  EvidenceRow,
  Kbd: AkKbd,
  ScopeTag: AkScope
} = akNS;
const akS = {
  panel: {
    width: 'var(--ask-width)',
    flexShrink: 0,
    background: 'var(--surface-panel)',
    borderLeft: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid var(--divider)',
    flexShrink: 0
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 14px 10px'
  },
  composerWrap: {
    position: 'relative',
    flexShrink: 0,
    padding: '12px 14px 14px'
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -22,
    height: 22,
    background: 'var(--scrim-to-panel)',
    pointerEvents: 'none'
  },
  composer: {
    border: '1px solid var(--border-field)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-inset)',
    padding: 10
  }
};
function AnswerRuns({
  runs,
  onCite
}) {
  return runs.map((r, i) => {
    if (r.mark) return /*#__PURE__*/React.createElement("mark", {
      key: i,
      style: {
        background: 'var(--highlight-bg)',
        color: 'var(--text-strong)',
        borderRadius: 2,
        padding: '0 2px'
      }
    }, r.x);
    if (r.cite) return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, r.x, /*#__PURE__*/React.createElement(CitationChip, {
      index: r.cite,
      note: "source",
      onClick: () => onCite && onCite(r.cite)
    }));
    return /*#__PURE__*/React.createElement("span", {
      key: i
    }, r.x);
  });
}
function Evidence({
  rows
}) {
  const [open, setOpen] = React.useState(true);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '6px 0 4px 36px',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      background: 'var(--surface-base)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(!open),
    style: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 10px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-subtle)'
    }
  }, /*#__PURE__*/React.createElement(AkIcon, {
    name: "git-commit-horizontal",
    size: 13
  }), /*#__PURE__*/React.createElement("span", null, "why retrieved \xB7 ", rows.length, " chunks"), /*#__PURE__*/React.createElement(AkIcon, {
    name: "chevron-down",
    size: 13,
    style: {
      marginLeft: 'auto',
      transform: open ? 'none' : 'rotate(-90deg)',
      transition: 'transform var(--dur-fast) var(--ease-out)'
    }
  })), open && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '2px 4px 6px'
    }
  }, rows.map(r => /*#__PURE__*/React.createElement(EvidenceRow, _extends({
    key: r.index
  }, r, {
    onOpen: () => {}
  })))));
}
function AskPanel({
  messages,
  asking,
  suggestions,
  onSend,
  onClose
}) {
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, asking]);
  const send = q => {
    const v = (q ?? draft).trim();
    if (!v || asking) return;
    setDraft('');
    onSend(v);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: akS.panel
  }, /*#__PURE__*/React.createElement("div", {
    style: akS.header
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 24,
      borderRadius: 'var(--radius-sm)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--brand-soft-bg)',
      border: '1px solid var(--brand-soft-border)'
    }
  }, /*#__PURE__*/React.createElement(AkIcon, {
    name: "sparkles",
    size: 14,
    style: {
      color: 'var(--brand-fg)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "Ask Lore"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--text-faint)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-full)',
      padding: '3px 8px'
    }
  }, /*#__PURE__*/React.createElement(AkIcon, {
    name: "filter",
    size: 11
  }), "team + enterprise"), /*#__PURE__*/React.createElement(AkIconBtn, {
    icon: "x",
    label: "Close Ask",
    size: "sm",
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    style: akS.scroll,
    ref: scrollRef
  }, messages.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px 6px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 17,
      color: 'var(--text-body)',
      margin: '0 0 4px'
    }
  }, "Ask across your libraries."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--text-subtle)',
      margin: '0 0 16px',
      lineHeight: 1.5
    }
  }, "Answers are drawn only from notes in your scope, and every claim is cited."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 7
    }
  }, suggestions.map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    onClick: () => send(s),
    style: {
      textAlign: 'left',
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: '9px 11px',
      border: '1px solid var(--border)',
      background: 'var(--surface-base)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-body)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(AkIcon, {
    name: "corner-down-right",
    size: 14,
    style: {
      color: 'var(--text-faint)'
    }
  }), s)))), messages.map((m, i) => m.role === 'user' ? /*#__PURE__*/React.createElement(AskMessage, {
    key: i,
    role: "user"
  }, m.text) : /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement(AskMessage, {
    role: "answer",
    sources: m.streaming ? undefined : m.sources,
    scopes: m.streaming ? undefined : m.scopes,
    streaming: m.streaming
  }, /*#__PURE__*/React.createElement(AnswerRuns, {
    runs: m.shown || m.runs
  })), !m.streaming && m.evidence && /*#__PURE__*/React.createElement(Evidence, {
    rows: m.evidence
  })))), /*#__PURE__*/React.createElement("div", {
    style: akS.composerWrap
  }, /*#__PURE__*/React.createElement("div", {
    style: akS.scrim
  }), /*#__PURE__*/React.createElement("div", {
    style: akS.composer
  }, /*#__PURE__*/React.createElement("textarea", {
    value: draft,
    onChange: e => setDraft(e.target.value),
    rows: 2,
    onKeyDown: e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    placeholder: "Ask anything about your knowledge\u2026",
    style: {
      width: '100%',
      resize: 'none',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      lineHeight: 1.5,
      color: 'var(--text-strong)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement(AkScope, {
    scope: "team",
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--text-faint)'
    }
  }, "cites sources"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(AkKbd, null, "\u21B5"), " send"), /*#__PURE__*/React.createElement("button", {
    onClick: () => send(),
    disabled: asking,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30,
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      cursor: asking ? 'default' : 'pointer',
      background: 'var(--brand-bg)',
      color: 'var(--text-onbrand)',
      opacity: asking ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement(AkIcon, {
    name: "arrow-up",
    size: 16
  }))))));
}
window.LoreAskPanel = AskPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/ask.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/buckets.jsx
try { (() => {
/* global React */
// Lore desktop - Buckets: shared knowledge collections pooled across libraries
const bkNS = window.VaultDesignSystem_ffbf58;
const {
  Icon: BkIcon,
  Card: BkCard,
  ScopeTag: BkScope,
  Avatar: BkAvatar,
  Badge: BkBadge,
  Button: BkButton,
  Tabs: BkTabs
} = bkNS;
const bkS = {
  wrap: {
    flex: 1,
    minWidth: 0,
    overflowY: 'auto',
    background: 'var(--surface-canvas)'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '22px 28px 0'
  },
  body: {
    padding: '18px 28px 60px',
    maxWidth: 1040,
    margin: '0 auto'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 14
  }
};
function Recall({
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 54,
      height: 5,
      borderRadius: 'var(--radius-full)',
      background: 'var(--surface-inset)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: value * 100 + '%',
      height: '100%',
      background: 'var(--jade-500)',
      borderRadius: 'var(--radius-full)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--text-faint)'
    }
  }, "recall ", value.toFixed(2)));
}
function BucketCard({
  b,
  onOpen
}) {
  return /*#__PURE__*/React.createElement(BkCard, {
    interactive: true,
    onClick: () => onOpen && onOpen(b),
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 11
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 'var(--radius-md)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--brand-soft-bg)',
      border: '1px solid var(--brand-soft-border)'
    }
  }, /*#__PURE__*/React.createElement(BkIcon, {
    name: "library",
    size: 17,
    style: {
      color: 'var(--brand-fg)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, b.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--text-faint)',
      marginTop: 1
    }
  }, b.group, " \xB7 ", b.notes, " notes")), /*#__PURE__*/React.createElement(BkScope, {
    scope: b.scope,
    size: "sm",
    showLabel: false
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 13,
      lineHeight: 1.5,
      color: 'var(--text-muted)',
      minHeight: 38
    }
  }, b.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5
    }
  }, b.topics.map(t => /*#__PURE__*/React.createElement(BkBadge, {
    key: t,
    tone: "info"
  }, "#", t))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex'
    }
  }, b.contributors.slice(0, 4).map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m,
    style: {
      marginLeft: i ? -7 : 0,
      border: '2px solid var(--surface-panel)',
      borderRadius: '50%'
    }
  }, /*#__PURE__*/React.createElement(BkAvatar, {
    name: m,
    size: 22
  }))), b.contributors.length > 4 && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 4,
      alignSelf: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, "+", b.contributors.length - 4)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Recall, {
    value: b.recall
  })));
}
function BucketsView({
  buckets,
  onAsk
}) {
  const [tab, setTab] = React.useState('all');
  const shown = tab === 'all' ? buckets : buckets.filter(b => tab === 'mine' ? b.scope === 'private' : b.scope === tab);
  return /*#__PURE__*/React.createElement("div", {
    style: bkS.wrap
  }, /*#__PURE__*/React.createElement("div", {
    style: bkS.head
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-3xl)',
      fontWeight: 600,
      color: 'var(--text-strong)',
      margin: 0
    }
  }, "Buckets"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--text-subtle)',
      margin: '4px 0 0'
    }
  }, "Shared knowledge collections your team pools and asks across.")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(BkButton, {
    variant: "secondary",
    icon: "sparkles",
    onClick: onAsk
  }, "Ask all buckets"), /*#__PURE__*/React.createElement(BkButton, {
    variant: "primary",
    icon: "plus"
  }, "New bucket")), /*#__PURE__*/React.createElement("div", {
    style: bkS.body
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(BkTabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: 'all',
      label: 'All',
      count: buckets.length
    }, {
      value: 'team',
      label: 'Team'
    }, {
      value: 'enterprise',
      label: 'Enterprise'
    }, {
      value: 'mine',
      label: 'Private'
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: bkS.grid
  }, shown.map(b => /*#__PURE__*/React.createElement(BucketCard, {
    key: b.id,
    b: b,
    onOpen: () => {}
  })))));
}
window.LoreBucketsView = BucketsView;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/buckets.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/data.js
try { (() => {
// Lore desktop - live surfaces start with no seeded/demo values.
window.LoreData = {
  workspace: { name: null, scope: null, members: 0 },
  tree: [],
  notes: {},
  ask: { suggestions: [], question: null, answerRuns: [], sources: 0, scopes: null, evidence: [] },
  projects: [],
  groups: [],
  buckets: [],
  settings: {
    account: { name: null, email: null, role: null, team: null, avatar: null },
    indexing: { embedder: null, reranker: null, autoIndex: false, contextual: false, localFallback: false },
    sync: { provider: null, lastSync: null, encrypted: false },
    connections: [],
  },
  graph: { nodes: [], edges: [] },
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/data.js", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/editor.jsx
try { (() => {
/* global React */
// Lore desktop — center editor (reading view) + right context pane
const edNS = window.VaultDesignSystem_ffbf58;
const {
  Icon: EdIcon,
  IconButton: EdIconBtn,
  WikiLink,
  ScopeTag: EdScope,
  Tabs: EdTabs,
  Avatar: EdAvatar,
  Badge: EdBadge,
  ScopePicker,
  Tooltip: EdTip
} = edNS;
const edS = {
  center: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface-canvas)'
  },
  tabbar: {
    display: 'flex',
    alignItems: 'center',
    height: 38,
    background: 'var(--surface-base)',
    borderBottom: '1px solid var(--border-subtle)',
    paddingRight: 8,
    flexShrink: 0
  },
  tab: on => ({
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    height: '100%',
    padding: '0 14px',
    borderRight: '1px solid var(--border-subtle)',
    cursor: 'pointer',
    background: on ? 'var(--surface-canvas)' : 'transparent',
    color: on ? 'var(--text-strong)' : 'var(--text-subtle)',
    fontSize: 13,
    boxShadow: on ? 'inset 0 2px 0 var(--brand-bg)' : 'none'
  }),
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 18px',
    borderBottom: '1px solid var(--divider)',
    flexShrink: 0
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '28px 0 80px'
  },
  col: {
    maxWidth: '64ch',
    margin: '0 auto',
    padding: '0 32px'
  },
  context: {
    width: 'var(--context-width)',
    flexShrink: 0,
    background: 'var(--surface-panel)',
    borderLeft: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column'
  }
};
function Runs({
  runs,
  onOpen
}) {
  return runs.map((r, i) => {
    if (r.link) return /*#__PURE__*/React.createElement(WikiLink, {
      key: i,
      onClick: () => onOpen && onOpen(r.link)
    }, r.x);
    if (r.mark) return /*#__PURE__*/React.createElement("mark", {
      key: i,
      style: {
        background: 'var(--highlight-bg)',
        color: 'var(--text-strong)',
        borderRadius: 2,
        padding: '0 2px'
      }
    }, r.x);
    if (r.code) return /*#__PURE__*/React.createElement("code", {
      key: i,
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: '0.86em',
        background: 'var(--surface-inset)',
        padding: '0.1em 0.35em',
        borderRadius: 'var(--radius-sm)'
      }
    }, r.x);
    return /*#__PURE__*/React.createElement("span", {
      key: i
    }, r.x);
  });
}
function Block({
  b,
  note,
  onOpen
}) {
  if (b.t === 'h1') return /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-4xl)',
      fontWeight: 600,
      lineHeight: 1.15,
      letterSpacing: '-0.01em',
      margin: '0 0 14px',
      color: 'var(--text-strong)'
    }
  }, b.s);
  if (b.t === 'meta') return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      margin: '0 0 26px',
      fontFamily: 'var(--font-mono)',
      fontSize: 11.5,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(EdScope, {
    scope: note.scope,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", null, note.owner), /*#__PURE__*/React.createElement("span", null, "\xB7 updated ", note.updated), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--link-fg)'
    }
  }, note.tags.map(t => '#' + t).join('  ')));
  if (b.t === 'h2') return /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      margin: '30px 0 12px',
      color: 'var(--text-strong)'
    }
  }, b.s);
  if (b.t === 'quote') return /*#__PURE__*/React.createElement("blockquote", {
    style: {
      margin: '20px 0',
      padding: '4px 18px',
      borderLeft: '3px solid var(--brand-soft-border)',
      color: 'var(--text-muted)',
      fontStyle: 'italic',
      fontFamily: 'var(--font-serif)'
    }
  }, b.s);
  if (b.t === 'li') return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      margin: '6px 0',
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-lg)',
      lineHeight: 1.6,
      color: 'var(--text-body)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--brand-fg)',
      marginTop: 1
    }
  }, "\u2014"), /*#__PURE__*/React.createElement("span", null, b.runs ? /*#__PURE__*/React.createElement(Runs, {
    runs: b.runs,
    onOpen: onOpen
  }) : b.s));
  return /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-lg)',
      lineHeight: 1.65,
      margin: '0 0 16px',
      color: 'var(--text-body)'
    }
  }, b.runs ? /*#__PURE__*/React.createElement(Runs, {
    runs: b.runs,
    onOpen: onOpen
  }) : b.s);
}
function Editor({
  note,
  mode,
  onMode,
  onOpen,
  scope,
  onScope
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: edS.center
  }, /*#__PURE__*/React.createElement("div", {
    style: edS.tabbar
  }, /*#__PURE__*/React.createElement("div", {
    style: edS.tab(true)
  }, /*#__PURE__*/React.createElement(EdIcon, {
    name: "file-text",
    size: 13,
    style: {
      color: 'var(--brand-fg)'
    }
  }), note.title, /*#__PURE__*/React.createElement(EdIcon, {
    name: "x",
    size: 12,
    style: {
      color: 'var(--text-faint)',
      marginLeft: 4
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: edS.tab(false)
  }, /*#__PURE__*/React.createElement(EdIcon, {
    name: "file-text",
    size: 13
  }), "Renewals Playbook"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(EdIconBtn, {
    icon: "panel-right-close",
    label: "Toggle pane",
    size: "sm"
  })), /*#__PURE__*/React.createElement("div", {
    style: edS.toolbar
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, "Accounts / ", note.title, ".md"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(ScopePicker, {
    value: scope,
    onChange: onScope
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      background: 'var(--surface-inset)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: 2,
      gap: 2
    }
  }, ['read', 'edit'].map(m => /*#__PURE__*/React.createElement("button", {
    key: m,
    onClick: () => onMode(m),
    style: {
      border: 'none',
      cursor: 'pointer',
      padding: '4px 11px',
      borderRadius: 'var(--radius-xs)',
      background: mode === m ? 'var(--surface-raised)' : 'transparent',
      color: mode === m ? 'var(--text-strong)' : 'var(--text-subtle)',
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      fontWeight: mode === m ? 600 : 400,
      textTransform: 'capitalize'
    }
  }, m)))), /*#__PURE__*/React.createElement("div", {
    style: edS.scroll
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...edS.col,
      opacity: mode === 'edit' ? 0.96 : 1
    }
  }, note.body.map((b, i) => /*#__PURE__*/React.createElement(Block, {
    key: i,
    b: b,
    note: note,
    onOpen: onOpen
  })))));
}
function ContextPane({
  note,
  onAsk
}) {
  const [tab, setTab] = React.useState('backlinks');
  return /*#__PURE__*/React.createElement("div", {
    style: edS.context
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 12px'
    }
  }, /*#__PURE__*/React.createElement(EdTabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: 'backlinks',
      label: 'Backlinks',
      count: note.backlinks.length
    }, {
      value: 'outline',
      label: 'Outline'
    }, {
      value: 'tags',
      label: 'Tags',
      count: note.tags.length
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: 12
    }
  }, tab === 'backlinks' && note.backlinks.map((bl, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: 9,
      padding: '9px 8px',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--surface-hover)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement(EdIcon, {
    name: "link-2",
    size: 14,
    style: {
      color: 'var(--link-fg)',
      marginTop: 2
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, bl.note), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--text-faint)',
      marginTop: 2
    }
  }, "\u203A ", bl.heading, " \xB7 ", bl.owner)))), tab === 'outline' && note.outline.map((h, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: '6px 8px',
      paddingLeft: 8 + (i === 0 ? 0 : 14),
      fontSize: 13,
      color: i === 0 ? 'var(--text-strong)' : 'var(--text-muted)',
      fontWeight: i === 0 ? 600 : 400,
      cursor: 'pointer'
    }
  }, h)), tab === 'tags' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6
    }
  }, note.tags.map(t => /*#__PURE__*/React.createElement(EdBadge, {
    key: t,
    tone: "info"
  }, "#", t)))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderTop: '1px solid var(--divider)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onAsk,
    style: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 34,
      border: '1px solid var(--brand-soft-border)',
      background: 'var(--brand-soft-bg)',
      color: 'var(--brand-fg)',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(EdIcon, {
    name: "sparkles",
    size: 15
  }), "Ask about this note")));
}
Object.assign(window, {
  LoreEditor: Editor,
  LoreContextPane: ContextPane
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/editor.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/projects.jsx
try { (() => {
/* global React */
// Lore desktop — Projects & Groups browser + knowledge graph
const prNS = window.VaultDesignSystem_ffbf58;
const {
  Icon: PrIcon,
  IconButton: PrIconBtn,
  Card,
  ScopeTag: PrScope,
  Avatar: PrAvatar,
  Badge: PrBadge,
  Button: PrButton,
  Tabs: PrTabs
} = prNS;
const prS = {
  wrap: {
    flex: 1,
    minWidth: 0,
    overflowY: 'auto',
    background: 'var(--surface-canvas)'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '22px 28px 0'
  },
  body: {
    padding: '18px 28px 60px',
    maxWidth: 1040,
    margin: '0 auto'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 14
  }
};
function MemberStack({
  members
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex'
    }
  }, members.slice(0, 3).map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m,
    style: {
      marginLeft: i ? -7 : 0,
      border: '2px solid var(--surface-panel)',
      borderRadius: '50%'
    }
  }, /*#__PURE__*/React.createElement(PrAvatar, {
    name: m,
    size: 22
  }))), members.length > 3 && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 4,
      alignSelf: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, "+", members.length - 3));
}
function ProjectsView({
  projects,
  groups,
  onOpen
}) {
  const [tab, setTab] = React.useState('projects');
  return /*#__PURE__*/React.createElement("div", {
    style: prS.wrap
  }, /*#__PURE__*/React.createElement("div", {
    style: prS.head
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-3xl)',
      fontWeight: 600,
      color: 'var(--text-strong)',
      margin: 0
    }
  }, "Projects"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--text-subtle)',
      margin: '4px 0 0'
    }
  }, "Focused workspaces that gather notes, people, and an Ask thread.")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(PrButton, {
    variant: "primary",
    icon: "plus"
  }, "New project")), /*#__PURE__*/React.createElement("div", {
    style: prS.body
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(PrTabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: 'projects',
      label: 'Projects',
      count: projects.length
    }, {
      value: 'groups',
      label: 'Groups',
      count: groups.length
    }]
  })), tab === 'projects' && /*#__PURE__*/React.createElement("div", {
    style: prS.grid
  }, projects.map(p => /*#__PURE__*/React.createElement(Card, {
    key: p.id,
    interactive: true,
    onClick: () => onOpen && onOpen(p),
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 'var(--radius-sm)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--brand-soft-bg)'
    }
  }, /*#__PURE__*/React.createElement(PrIcon, {
    name: "layout-grid",
    size: 16,
    style: {
      color: 'var(--brand-fg)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14.5,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, p.name), /*#__PURE__*/React.createElement(PrScope, {
    scope: p.scope,
    size: "sm",
    showLabel: false
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 13,
      lineHeight: 1.5,
      color: 'var(--text-muted)',
      minHeight: 38
    }
  }, p.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement(MemberStack, {
    members: p.members
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(PrIcon, {
    name: "file-text",
    size: 12
  }), p.notes), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, p.updated))))), tab === 'groups' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, groups.map(g => /*#__PURE__*/React.createElement(Card, {
    key: g.id,
    interactive: true,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 'var(--radius-md)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: g.scope === 'enterprise' ? 'var(--scope-ent-bg)' : 'var(--scope-team-bg)'
    }
  }, /*#__PURE__*/React.createElement(PrIcon, {
    name: g.scope === 'enterprise' ? 'building-2' : 'users',
    size: 18,
    style: {
      color: g.scope === 'enterprise' ? 'var(--scope-ent-fg)' : 'var(--scope-team-fg)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, g.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)',
      marginTop: 2
    }
  }, g.members, " members \xB7 ", g.vaults, " libraries")), /*#__PURE__*/React.createElement(PrScope, {
    scope: g.scope
  }), /*#__PURE__*/React.createElement(PrButton, {
    variant: "ghost",
    iconTrailing: "chevron-right"
  }, "Open"))))));
}
const SCOPE_FILL = {
  team: 'var(--jade-500)',
  enterprise: 'var(--azure-500)',
  private: 'var(--obsidian-400)'
};
function GraphView({
  graph,
  onOpen
}) {
  const [hover, setHover] = React.useState(null);
  const [sel, setSel] = React.useState(null);
  const [filters, setFilters] = React.useState({
    team: true,
    enterprise: true,
    private: true
  });
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const neighbors = React.useMemo(() => {
    const s = new Set();
    if (sel) graph.edges.forEach(([a, b]) => {
      if (a === sel) s.add(b);
      if (b === sel) s.add(a);
    });
    return s;
  }, [sel, graph]);
  const visible = id => filters[byId[id].scope];
  const focus = hover || sel;
  const selNode = sel && byId[sel];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      position: 'relative',
      background: 'var(--surface-canvas)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 18,
      left: 22,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      color: 'var(--text-strong)',
      margin: 0
    }
  }, "Knowledge graph"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12.5,
      color: 'var(--text-subtle)',
      margin: '3px 0 0'
    }
  }, graph.nodes.length, " notes \xB7 ", graph.edges.length, " links in your scope")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 18,
      right: 22,
      zIndex: 2,
      display: 'flex',
      gap: 8
    }
  }, ['team', 'enterprise', 'private'].map(k => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setFilters(f => ({
      ...f,
      [k]: !f[k]
    })),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-full)',
      background: filters[k] ? 'var(--surface-raised)' : 'transparent',
      opacity: filters[k] ? 1 : 0.45,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 9,
      borderRadius: '50%',
      background: SCOPE_FILL[k]
    }
  }), k))), /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 100 100",
    preserveAspectRatio: "xMidYMid meet",
    style: {
      width: '100%',
      height: '100%'
    }
  }, graph.edges.map(([a, b], i) => {
    if (!visible(a) || !visible(b)) return null;
    const na = byId[a],
      nb = byId[b];
    const lit = focus && (focus === a || focus === b);
    return /*#__PURE__*/React.createElement("line", {
      key: i,
      x1: na.x,
      y1: na.y,
      x2: nb.x,
      y2: nb.y,
      stroke: lit ? 'var(--graph-edge)' : 'var(--border-strong)',
      strokeWidth: lit ? 0.6 : 0.3,
      opacity: focus && !lit ? 0.4 : 1
    });
  }), graph.nodes.map(n => {
    if (!visible(n.id)) return null;
    const lit = focus === n.id;
    const near = focus && (neighbors.has(n.id) || focus === n.id);
    const dim = focus && !near;
    return /*#__PURE__*/React.createElement("g", {
      key: n.id,
      style: {
        cursor: 'pointer'
      },
      onMouseEnter: () => setHover(n.id),
      onMouseLeave: () => setHover(null),
      onClick: () => setSel(n.id),
      onDoubleClick: () => onOpen && onOpen(n.id)
    }, sel === n.id && /*#__PURE__*/React.createElement("circle", {
      cx: n.x,
      cy: n.y,
      r: n.r / 4 + 3.4,
      fill: "none",
      stroke: "var(--brand-bg)",
      strokeWidth: 0.6
    }), /*#__PURE__*/React.createElement("circle", {
      cx: n.x,
      cy: n.y,
      r: n.r / 4 + 1.6,
      fill: SCOPE_FILL[n.scope],
      stroke: "var(--surface-canvas)",
      strokeWidth: 0.5,
      opacity: dim ? 0.4 : 1
    }), /*#__PURE__*/React.createElement("text", {
      x: n.x,
      y: n.y + n.r / 4 + 4.6,
      textAnchor: "middle",
      style: {
        fontFamily: 'var(--font-sans)',
        fontSize: 2.5,
        fontWeight: lit ? 600 : 500,
        fill: lit ? 'var(--text-strong)' : 'var(--text-muted)',
        opacity: dim ? 0.5 : 1
      }
    }, n.label));
  })), selNode && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      right: 18,
      bottom: 18,
      width: 240,
      padding: 14,
      background: 'var(--surface-overlay)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(PrIcon, {
    name: "file-text",
    size: 15,
    style: {
      color: 'var(--brand-fg)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, selNode.label), /*#__PURE__*/React.createElement(PrScope, {
    scope: selNode.scope,
    size: "sm",
    showLabel: false
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 12px',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", null, selNode.owner), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement(PrIcon, {
    name: "link-2",
    size: 11
  }), selNode.links, " links"), /*#__PURE__*/React.createElement("span", null, selNode.updated)), /*#__PURE__*/React.createElement(PrButton, {
    variant: "secondary",
    size: "sm",
    icon: "arrow-up-right",
    fullWidth: true,
    onClick: () => onOpen && onOpen(selNode.id)
  }, "Open note")));
}
Object.assign(window, {
  LoreProjectsView: ProjectsView,
  LoreGraphView: GraphView
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/projects.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/settings.jsx
try { (() => {
/* global React */
// Lore desktop — Account settings
const stNS = window.VaultDesignSystem_ffbf58;
const {
  Icon: StIcon,
  Avatar: StAvatar,
  Switch: StSwitch,
  Select: StSelect,
  Button: StButton,
  Badge: StBadge,
  ScopeTag: StScope,
  Input: StInput
} = stNS;
const stS = {
  wrap: {
    flex: 1,
    minWidth: 0,
    overflowY: 'auto',
    background: 'var(--surface-canvas)'
  },
  body: {
    maxWidth: 760,
    margin: '0 auto',
    padding: '28px 28px 80px'
  },
  section: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-panel)',
    marginBottom: 18,
    overflow: 'hidden'
  },
  secHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '12px 16px',
    borderBottom: '1px solid var(--divider)'
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '13px 16px',
    borderBottom: '1px solid var(--divider)'
  },
  label: {
    fontSize: 13.5,
    color: 'var(--text-strong)',
    fontWeight: 500
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-subtle)',
    marginTop: 2
  }
};
function Section({
  icon,
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: stS.section
  }, /*#__PURE__*/React.createElement("div", {
    style: stS.secHead
  }, /*#__PURE__*/React.createElement(StIcon, {
    name: icon,
    size: 15,
    style: {
      color: 'var(--brand-fg)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-strong)',
      textTransform: 'none'
    }
  }, title)), children);
}
function Row({
  label,
  hint,
  children,
  last
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...stS.row,
      borderBottom: last ? 'none' : stS.row.borderBottom
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: stS.label
  }, label), hint && /*#__PURE__*/React.createElement("div", {
    style: stS.hint
  }, hint)), children);
}
function SettingsView({
  settings
}) {
  const s = settings;
  const [auto, setAuto] = React.useState(s.indexing.autoIndex);
  const [ctx, setCtx] = React.useState(s.indexing.contextual);
  const [local, setLocal] = React.useState(s.indexing.localFallback);
  const [defScope, setDefScope] = React.useState('');
  return /*#__PURE__*/React.createElement("div", {
    style: stS.wrap
  }, /*#__PURE__*/React.createElement("div", {
    style: stS.body
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-3xl)',
      fontWeight: 600,
      color: 'var(--text-strong)',
      margin: '0 0 4px'
    }
  }, "Settings"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--text-subtle)',
      margin: '0 0 24px'
    }
  }, "Manage your account, indexing, and the sources Lore reads."), /*#__PURE__*/React.createElement(Section, {
    icon: "user",
    title: "Account"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...stS.row
    }
  }, /*#__PURE__*/React.createElement(StAvatar, {
    name: s.account.avatar,
    size: 48,
    scope: "team"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, s.account.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11.5,
      color: 'var(--text-faint)',
      marginTop: 2
    }
  }, s.account.email)), /*#__PURE__*/React.createElement(StBadge, {
    tone: "neutral"
  }, s.account.role), /*#__PURE__*/React.createElement(StButton, {
    variant: "secondary",
    size: "sm"
  }, "Edit profile"))), /*#__PURE__*/React.createElement(Section, {
    icon: "lock",
    title: "Visibility"
  }, /*#__PURE__*/React.createElement(Row, {
    label: "Default visibility",
    hint: "New notes use this visibility when configured.",
    last: true
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, ['private', 'team', 'enterprise'].map(sc => /*#__PURE__*/React.createElement("button", {
    key: sc,
    onClick: () => setDefScope(sc),
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: defScope === sc ? 1 : 0.45,
      outline: defScope === sc ? '1px solid var(--brand-soft-border)' : 'none',
      borderRadius: 'var(--radius-full)',
      display: 'inline-block'
    }
  }, /*#__PURE__*/React.createElement(StScope, {
    scope: sc,
    size: "sm"
  }))))))), /*#__PURE__*/React.createElement(Section, {
    icon: "cpu",
    title: "Indexing & recall"
  }, /*#__PURE__*/React.createElement(Row, {
    label: "Auto-index on save",
    hint: "Re-index notes a couple of seconds after each edit."
  }, /*#__PURE__*/React.createElement(StSwitch, {
    checked: auto,
    onChange: setAuto
  })), /*#__PURE__*/React.createElement(Row, {
    label: "Contextual retrieval",
    hint: "Prepend a situating blurb to each chunk before embedding. Lifts recall."
  }, /*#__PURE__*/React.createElement(StSwitch, {
    checked: ctx,
    onChange: setCtx
  })), /*#__PURE__*/React.createElement(Row, {
    label: "Embedding model"
  }, /*#__PURE__*/React.createElement(StSelect, {
    defaultValue: s.indexing.embedder,
    options: ['voyage-4-large', 'voyage-4', 'BGE-M3 (local)']
  })), /*#__PURE__*/React.createElement(Row, {
    label: "Reranker"
  }, /*#__PURE__*/React.createElement(StSelect, {
    defaultValue: s.indexing.reranker,
    options: ['rerank-2.5', 'cohere rerank-v4']
  })), /*#__PURE__*/React.createElement(Row, {
    label: "Local fallback",
    hint: "Keep a local embedder for data-residency. Off by default.",
    last: true
  }, /*#__PURE__*/React.createElement(StSwitch, {
    checked: local,
    onChange: setLocal
  }))), /*#__PURE__*/React.createElement(Section, {
    icon: "refresh-cw",
    title: "Sync & storage"
  }, /*#__PURE__*/React.createElement(Row, {
    label: "Provider"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, s.sync.provider)), /*#__PURE__*/React.createElement(Row, {
    label: "Encryption",
    hint: "Libraries are encrypted at rest."
  }, /*#__PURE__*/React.createElement(StBadge, {
    tone: "success",
    dot: true
  }, s.sync.encrypted ? 'enabled' : 'off')), /*#__PURE__*/React.createElement(Row, {
    label: "Last sync",
    last: true
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-faint)'
    }
  }, s.sync.lastSync))), /*#__PURE__*/React.createElement(Section, {
    icon: "plug",
    title: "Connected sources"
  }, s.connections.map((c, i) => /*#__PURE__*/React.createElement(Row, {
    key: c.id,
    label: c.name,
    hint: c.detail,
    last: i === s.connections.length - 1
  }, c.status === 'connected' ? /*#__PURE__*/React.createElement(StBadge, {
    tone: "success",
    dot: true
  }, "connected") : /*#__PURE__*/React.createElement(StButton, {
    variant: "secondary",
    size: "sm",
    icon: "plus"
  }, "Connect")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(StButton, {
    variant: "danger",
    icon: "log-out"
  }, "Sign out"))));
}
window.LoreSettingsView = SettingsView;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/settings.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lore-desktop/shell.jsx
try { (() => {
/* global React */
// Lore desktop — shell: titlebar, activity rail, sidebar, status bar
const NS = window.VaultDesignSystem_ffbf58;
const {
  Icon,
  IconButton,
  Tooltip,
  Avatar,
  FileTreeItem,
  ScopeTag,
  Input,
  Kbd,
  Badge
} = NS;
const shellS = {
  titlebar: {
    height: 'var(--topbar-height)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    background: 'var(--surface-base)',
    borderBottom: '1px solid var(--border-subtle)',
    flexShrink: 0,
    WebkitUserSelect: 'none'
  },
  rail: {
    width: 'var(--rail-width)',
    flexShrink: 0,
    background: 'var(--surface-base)',
    borderRight: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px 0',
    gap: 4
  },
  sidebar: {
    width: 'var(--sidebar-width)',
    flexShrink: 0,
    background: 'var(--surface-panel)',
    borderRight: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column'
  },
  status: {
    height: 'var(--statusbar-height)',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '0 12px',
    background: 'var(--surface-base)',
    borderTop: '1px solid var(--border-subtle)',
    flexShrink: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-faint)'
  }
};
function Titlebar({
  theme,
  onToggleTheme,
  onAsk,
  onSettings
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: shellS.titlebar
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 7,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: '50%',
      background: 'var(--clay-400)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: '50%',
      background: 'var(--amber-400)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: '50%',
      background: 'var(--jade-400)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginLeft: 8
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/logomark.svg",
    alt: "Lore",
    style: {
      width: 20,
      height: 20
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 15,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "Lore")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: 360,
      height: 28,
      padding: '0 10px',
      background: 'var(--surface-inset)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-subtle)',
      fontSize: 13,
      cursor: 'text'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 14
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, "Search or jump to\u2026"), /*#__PURE__*/React.createElement(Kbd, null, "\u2318K"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Tooltip, {
    label: "Ask Lore",
    kbd: "\u2318\u21B5",
    side: "bottom"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "sparkles",
    label: "Ask Lore",
    onClick: onAsk
  })), /*#__PURE__*/React.createElement(Tooltip, {
    label: theme === 'dark' ? 'Paper theme' : 'Workbench theme',
    side: "bottom"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: theme === 'dark' ? 'sun' : 'moon',
    label: "Toggle theme",
    onClick: onToggleTheme
  })), /*#__PURE__*/React.createElement(IconButton, {
    icon: "settings",
    label: "Settings",
    onClick: onSettings
  }), /*#__PURE__*/React.createElement(Avatar, {
    name: "Alice Ng",
    size: 24,
    scope: "team",
    style: {
      marginLeft: 4
    }
  })));
}
function ActivityRail({
  view,
  askOpen,
  onView,
  onAsk
}) {
  const items = [{
    id: 'workspace',
    icon: 'files',
    label: 'Files'
  }, {
    id: 'search',
    icon: 'search',
    label: 'Search'
  }, {
    id: 'graph',
    icon: 'network',
    label: 'Graph'
  }, {
    id: 'projects',
    icon: 'layout-grid',
    label: 'Projects'
  }, {
    id: 'buckets',
    icon: 'library',
    label: 'Buckets'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: shellS.rail
  }, items.map(it => /*#__PURE__*/React.createElement(Tooltip, {
    key: it.id,
    label: it.label,
    side: "right"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: it.icon,
    label: it.label,
    size: "lg",
    active: view === it.id,
    onClick: () => onView(it.id)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      width: 26,
      background: 'var(--divider)',
      margin: '6px 0'
    }
  }), /*#__PURE__*/React.createElement(Tooltip, {
    label: "Ask Lore",
    side: "right"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "sparkles",
    label: "Ask",
    size: "lg",
    variant: askOpen ? 'primary' : 'ghost',
    onClick: onAsk
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Tooltip, {
    label: "Groups",
    side: "right"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "users",
    label: "Groups",
    size: "lg",
    onClick: () => onView('projects')
  })), /*#__PURE__*/React.createElement(Tooltip, {
    label: "Settings",
    side: "right"
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "settings",
    label: "Settings",
    size: "lg",
    active: view === 'settings',
    onClick: () => onView('settings')
  })));
}
function TreeNode({
  node,
  activeNote,
  onOpen,
  onToggle
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(FileTreeItem, {
    name: node.name,
    kind: node.kind,
    depth: node.depth,
    open: node.open,
    active: node.kind === 'note' && node.id === activeNote,
    scope: node.scope,
    indexed: node.indexed,
    onClick: () => node.kind === 'folder' ? onToggle(node.id) : onOpen(node.id)
  }), node.kind === 'folder' && node.open && node.children && node.children.map(c => /*#__PURE__*/React.createElement(TreeNode, {
    key: c.id,
    node: c,
    activeNote: activeNote,
    onOpen: onOpen,
    onToggle: onToggle
  })));
}
function Sidebar({
  tree,
  activeNote,
  onOpen,
  onToggle,
  workspace
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: shellS.sidebar
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 12px',
      borderBottom: '1px solid var(--divider)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "folder-open",
    size: 16,
    style: {
      color: 'var(--brand-fg)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, workspace.name), /*#__PURE__*/React.createElement(ScopeTag, {
    scope: workspace.scope,
    size: "sm",
    showLabel: false
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "plus",
    label: "New note",
    size: "sm"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '6px 8px'
    }
  }, tree.map(n => /*#__PURE__*/React.createElement(TreeNode, {
    key: n.id,
    node: n,
    activeNote: activeNote,
    onOpen: onOpen,
    onToggle: onToggle
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px',
      borderTop: '1px solid var(--divider)',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: 'var(--jade-400)',
      animation: 'lore-pulse 2.4s var(--ease-out) infinite'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, "9 notes indexed")));
}
function StatusBar() {
  return /*#__PURE__*/React.createElement("div", {
    style: shellS.status
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle-dot",
    size: 12
  }), "status unavailable"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh-cw",
    size: 12
  }), "not synced"), /*#__PURE__*/React.createElement("span", null, "Markdown"));
}
Object.assign(window, {
  LoreTitlebar: Titlebar,
  LoreActivityRail: ActivityRail,
  LoreSidebar: Sidebar,
  LoreStatusBar: StatusBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lore-desktop/shell.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Kbd = __ds_scope.Kbd;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.ScopeTag = __ds_scope.ScopeTag;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.AskMessage = __ds_scope.AskMessage;

__ds_ns.CitationChip = __ds_scope.CitationChip;

__ds_ns.EvidenceRow = __ds_scope.EvidenceRow;

__ds_ns.FileTreeItem = __ds_scope.FileTreeItem;

__ds_ns.NoteCard = __ds_scope.NoteCard;

__ds_ns.ScopePicker = __ds_scope.ScopePicker;

__ds_ns.WikiLink = __ds_scope.WikiLink;

})();
