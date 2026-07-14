(function () {
  const { useEffect, useMemo, useState } = React;

  // Icons come from the shared design-system bundle like every other view
  // (buckets.jsx: window.VaultDesignSystem_ffbf58.Icon) — NOT raw lucide.
  function Icon({ name, size = 16, style }) {
    const DSIcon = (window.VaultDesignSystem_ffbf58 || {}).Icon;
    return DSIcon ? /*#__PURE__*/React.createElement(DSIcon, { name: name, size: size, style: style }) : null;
  }

  function api() {
    if (window.lore && window.lore.peopleList) return window.lore;
    return window.lorePeople || window.lore || {};
  }

  function formatDate(value) {
    if (!value) return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function sourceLabel(source) {
    if (source === "claude-session") return "Claude";
    if (source === "codex-session") return "Codex";
    if (source === "topic") return "Topic";
    return "Note";
  }

  function openNote(noteId, title, onOpenNote) {
    // Backend note ids are not renderer file paths — the host resolves by
    // title (openByRef); DB-only capture notes no-op gracefully.
    if (onOpenNote) onOpenNote(noteId, title);
  }

  function PeopleList({ people, selectedId, onSelect }) {
    if (!people.length) {
      return (/*#__PURE__*/
        React.createElement("div", { className: "people-empty" }, /*#__PURE__*/
        React.createElement(Icon, { name: "users", size: 22 }), /*#__PURE__*/
        React.createElement("div", null, "No people yet"), /*#__PURE__*/
        React.createElement("p", null, "People appear after names or email addresses are found in notes, captures, ingested content, or invite recipients.")
        ));

    }
    return (/*#__PURE__*/
      React.createElement("div", { className: "people-list" },
      people.map((person) => /*#__PURE__*/
      React.createElement("button", {
        key: person.id,
        type: "button",
        className: `people-row ${selectedId === person.id ? "is-active" : ""}`,
        onClick: () => onSelect(person) }, /*#__PURE__*/

      React.createElement("div", { className: "people-avatar" }, person.name.slice(0, 1).toUpperCase()), /*#__PURE__*/
      React.createElement("div", { className: "people-row-main" }, /*#__PURE__*/
      React.createElement("div", { className: "people-row-top" }, /*#__PURE__*/
      React.createElement("strong", null, person.name), /*#__PURE__*/
      React.createElement("span", null, person.mention_count)
      ), /*#__PURE__*/
      React.createElement("div", { className: "people-row-sub" }, /*#__PURE__*/
      React.createElement("span", null, formatDate(person.last_seen)),
      !!person.emails?.length && /*#__PURE__*/React.createElement("span", null, person.emails[0])
      ), /*#__PURE__*/
      React.createElement("div", { className: "people-source-chips" },
      Object.entries(person.sources || {}).map(([source, count]) => /*#__PURE__*/
      React.createElement("span", { key: source }, sourceLabel(source), " ", count)
      )
      )
      )
      )
      )
      ));

  }

  function Timeline({ detail, onOpenNote }) {
    if (!detail) {
      return (/*#__PURE__*/
        React.createElement("div", { className: "people-empty people-empty-panel" }, /*#__PURE__*/
        React.createElement(Icon, { name: "user-round-search", size: 24 }), /*#__PURE__*/
        React.createElement("div", null, "Select a person"), /*#__PURE__*/
        React.createElement("p", null, "Interactions are filtered to the scopes currently visible in Lore.")
        ));

    }
    const interactions = detail.interactions || [];
    return (/*#__PURE__*/
      React.createElement("div", { className: "people-detail" }, /*#__PURE__*/
      React.createElement("div", { className: "people-profile" }, /*#__PURE__*/
      React.createElement("div", { className: "people-profile-avatar" }, detail.person.name.slice(0, 1).toUpperCase()), /*#__PURE__*/
      React.createElement("div", null, /*#__PURE__*/
      React.createElement("h2", null, detail.person.name), /*#__PURE__*/
      React.createElement("div", { className: "people-profile-meta" }, /*#__PURE__*/
      React.createElement("span", null, detail.person.mention_count, " mentions"), /*#__PURE__*/
      React.createElement("span", null, "Last seen ", formatDate(detail.person.last_seen))
      ),
      !!detail.person.emails?.length && /*#__PURE__*/
      React.createElement("div", { className: "people-email-list" },
      detail.person.emails.map((email) => /*#__PURE__*/React.createElement("span", { key: email }, email))
      )

      )
      ), /*#__PURE__*/

      React.createElement("div", { className: "people-timeline" },
      interactions.map((item) => /*#__PURE__*/
      React.createElement("div", { className: "people-event", key: `${item.note_id}-${item.date}` }, /*#__PURE__*/
      React.createElement("div", { className: "people-event-dot" }), /*#__PURE__*/
      React.createElement("div", { className: "people-event-card" }, /*#__PURE__*/
      React.createElement("div", { className: "people-event-meta" }, /*#__PURE__*/
      React.createElement("span", null, formatDate(item.date)), /*#__PURE__*/
      React.createElement("span", null, sourceLabel(item.source_type))
      ), /*#__PURE__*/
      React.createElement("button", { type: "button", className: "people-note-link", onClick: () => openNote(item.note_id, item.title, onOpenNote) },
      item.title || item.note_id
      ),
      !!item.evidence && /*#__PURE__*/React.createElement("p", null, item.evidence)
      )
      )
      ),
      !interactions.length && /*#__PURE__*/
      React.createElement("div", { className: "people-empty people-empty-panel" }, /*#__PURE__*/
      React.createElement(Icon, { name: "list-tree", size: 22 }), /*#__PURE__*/
      React.createElement("div", null, "No in-scope interactions")
      )

      )
      ));

  }

  function MergeBar({ people, selected, onMerged, tenant, scopes }) {
    const [mergeMode, setMergeMode] = useState(false);
    const [mergeId, setMergeId] = useState("");
    const candidates = useMemo(() => people.filter((person) => person.id !== selected?.id), [people, selected]);
    async function merge() {
      if (!selected || !mergeId) return;
      await api().peopleMerge(tenant, selected.id, mergeId);
      setMergeMode(false);
      setMergeId("");
      onMerged();
    }
    async function hide() {
      if (!selected) return;
      await api().peopleHide(tenant, selected.id);
      onMerged();
    }
    return (/*#__PURE__*/
      React.createElement("div", { className: "people-actions" }, /*#__PURE__*/
      React.createElement("button", { type: "button", className: "people-icon-button", disabled: !selected, onClick: () => setMergeMode(!mergeMode), title: "Merge" }, /*#__PURE__*/
      React.createElement(Icon, { name: "git-merge" })
      ), /*#__PURE__*/
      React.createElement("button", { type: "button", className: "people-icon-button", disabled: !selected, onClick: hide, title: "Hide" }, /*#__PURE__*/
      React.createElement(Icon, { name: "eye-off" })
      ),
      mergeMode && /*#__PURE__*/
      React.createElement("div", { className: "people-merge-controls" }, /*#__PURE__*/
      React.createElement("select", { value: mergeId, onChange: (event) => setMergeId(event.target.value) }, /*#__PURE__*/
      React.createElement("option", { value: "" }, "Merge duplicate..."),
      candidates.map((person) => /*#__PURE__*/React.createElement("option", { key: person.id, value: person.id }, person.name))
      ), /*#__PURE__*/
      React.createElement("button", { type: "button", onClick: merge, disabled: !mergeId }, "Merge")
      )

      ));

  }

  function LorePeopleView({ tenant, scopes, onOpenNote }) {
    const [people, setPeople] = useState([]);
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const scopeKey = Array.isArray(scopes) ? scopes.join(",") : scopes;

    async function loadPeople(nextSelectedId) {
      if (!tenant || !scopeKey) return;
      setLoading(true);
      setError("");
      try {
        const result = await api().peopleList(tenant, scopeKey);
        const nextPeople = result.people || [];
        setPeople(nextPeople);
        const nextSelected = nextPeople.find((person) => person.id === nextSelectedId) || nextPeople[0] || null;
        setSelected(nextSelected);
        if (nextSelected) {
          const nextDetail = await api().peopleDetail(tenant, scopeKey, nextSelected.id);
          setDetail(nextDetail);
        } else {
          setDetail(null);
        }
      } catch (err) {
        setError(err?.message || "Unable to load people");
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      loadPeople(selected?.id);
    }, [tenant, scopeKey]);

    async function selectPerson(person) {
      setSelected(person);
      setDetail(await api().peopleDetail(tenant, scopeKey, person.id));
    }

    return (/*#__PURE__*/
      React.createElement("div", { className: "people-view" }, /*#__PURE__*/
      React.createElement("style", null, `
          .people-view { display: grid; grid-template-columns: minmax(260px, 34%) 1fr; gap: 1px; height: 100%; min-height: 0; background: rgba(148, 163, 184, 0.24); color: var(--text, #172033); }
          .people-sidebar, .people-panel { min-height: 0; background: var(--surface, #f8fafc); }
          .people-sidebar { display: flex; flex-direction: column; }
          .people-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid rgba(148, 163, 184, 0.24); }
          .people-header h1 { margin: 0; font-size: 17px; line-height: 1.2; }
          .people-header span { color: var(--muted, #64748b); font-size: 12px; }
          .people-actions { display: flex; align-items: center; gap: 8px; }
          .people-icon-button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid rgba(148, 163, 184, 0.35); background: #fff; border-radius: 7px; color: #334155; }
          .people-icon-button:disabled { opacity: 0.45; }
          .people-merge-controls { display: flex; align-items: center; gap: 6px; }
          .people-merge-controls select, .people-merge-controls button { height: 32px; border-radius: 7px; border: 1px solid rgba(148, 163, 184, 0.35); background: #fff; font-size: 12px; }
          .people-list { overflow: auto; padding: 8px; }
          .people-row { width: 100%; display: grid; grid-template-columns: 36px 1fr; gap: 10px; border: 0; background: transparent; text-align: left; padding: 10px; border-radius: 8px; color: inherit; }
          .people-row:hover, .people-row.is-active { background: #fff; box-shadow: inset 0 0 0 1px rgba(51, 65, 85, 0.08); }
          .people-avatar, .people-profile-avatar { display: grid; place-items: center; border-radius: 999px; background: #dbeafe; color: #1e3a8a; font-weight: 700; }
          .people-avatar { width: 36px; height: 36px; }
          .people-row-main { min-width: 0; }
          .people-row-top { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
          .people-row-top strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .people-row-top span { color: #475569; font-variant-numeric: tabular-nums; }
          .people-row-sub { display: flex; gap: 8px; color: #64748b; font-size: 12px; min-width: 0; }
          .people-row-sub span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .people-source-chips, .people-email-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
          .people-source-chips span, .people-email-list span, .people-event-meta span { border-radius: 999px; background: #eef2ff; color: #3730a3; padding: 2px 7px; font-size: 11px; line-height: 1.5; }
          .people-panel { overflow: auto; }
          .people-detail { padding: 18px; }
          .people-profile { display: flex; align-items: center; gap: 14px; padding-bottom: 18px; border-bottom: 1px solid rgba(148, 163, 184, 0.24); }
          .people-profile-avatar { width: 48px; height: 48px; font-size: 20px; }
          .people-profile h2 { margin: 0 0 5px; font-size: 21px; line-height: 1.2; }
          .people-profile-meta { display: flex; flex-wrap: wrap; gap: 10px; color: #64748b; font-size: 12px; }
          .people-timeline { padding: 18px 0 0; }
          .people-event { position: relative; display: grid; grid-template-columns: 18px 1fr; gap: 10px; }
          .people-event:not(:last-child)::before { content: ""; position: absolute; left: 8px; top: 16px; bottom: -4px; width: 1px; background: rgba(148, 163, 184, 0.42); }
          .people-event-dot { width: 9px; height: 9px; margin: 7px auto 0; border-radius: 999px; background: #2563eb; }
          .people-event-card { margin-bottom: 12px; padding: 12px; border-radius: 8px; background: #fff; border: 1px solid rgba(148, 163, 184, 0.22); }
          .people-event-meta { display: flex; gap: 6px; margin-bottom: 8px; }
          .people-note-link { border: 0; background: transparent; color: #1d4ed8; padding: 0; font-weight: 650; text-align: left; }
          .people-event-card p { margin: 8px 0 0; color: #475569; font-size: 13px; line-height: 1.45; }
          .people-empty { margin: 18px; min-height: 180px; display: grid; place-items: center; align-content: center; gap: 8px; text-align: center; color: #64748b; }
          .people-empty div { color: #334155; font-weight: 650; }
          .people-empty p { margin: 0; max-width: 320px; font-size: 13px; line-height: 1.45; }
          .people-empty-panel { height: calc(100% - 36px); }
          .people-error { margin: 12px; padding: 10px; border-radius: 8px; background: #fef2f2; color: #991b1b; font-size: 13px; }
          @media (max-width: 780px) { .people-view { grid-template-columns: 1fr; grid-template-rows: minmax(240px, 42%) 1fr; } }
        `), /*#__PURE__*/
      React.createElement("aside", { className: "people-sidebar" }, /*#__PURE__*/
      React.createElement("div", { className: "people-header" }, /*#__PURE__*/
      React.createElement("div", null, /*#__PURE__*/
      React.createElement("h1", null, "People"), /*#__PURE__*/
      React.createElement("span", null, loading ? "Loading" : `${people.length} visible`)
      )
      ),
      error && /*#__PURE__*/React.createElement("div", { className: "people-error" }, error), /*#__PURE__*/
      React.createElement(PeopleList, { people: people, selectedId: selected?.id, onSelect: selectPerson })
      ), /*#__PURE__*/
      React.createElement("main", { className: "people-panel" }, /*#__PURE__*/
      React.createElement("div", { className: "people-header" }, /*#__PURE__*/
      React.createElement("div", null, /*#__PURE__*/
      React.createElement("h1", null, selected ? selected.name : "Interactions"), /*#__PURE__*/
      React.createElement("span", null, "Filtered by current scopes")
      ), /*#__PURE__*/
      React.createElement(MergeBar, { people: people, selected: selected, tenant: tenant, scopes: scopeKey, onMerged: () => loadPeople(selected?.id) })
      ), /*#__PURE__*/
      React.createElement(Timeline, { detail: detail, onOpenNote: onOpenNote })
      )
      ));

  }

  window.LorePeopleView = LorePeopleView;
})();