(function () {
  const { useEffect, useMemo, useState } = React;

  // Icons come from the shared design-system bundle like every other view
  // (buckets.jsx: window.VaultDesignSystem_ffbf58.Icon) — NOT raw lucide.
  function Icon({ name, size = 16, style }) {
    const DSIcon = (window.VaultDesignSystem_ffbf58 || {}).Icon;
    return DSIcon ? <DSIcon name={name} size={size} style={style} /> : null;
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
      return (
        <div className="people-empty">
          <Icon name="users" size={22} />
          <div>No people yet</div>
          <p>People appear after names or email addresses are found in notes, captures, ingested content, or invite recipients.</p>
        </div>
      );
    }
    return (
      <div className="people-list">
        {people.map((person) => (
          <button
            key={person.id}
            type="button"
            className={`people-row ${selectedId === person.id ? "is-active" : ""}`}
            onClick={() => onSelect(person)}
          >
            <div className="people-avatar">{person.name.slice(0, 1).toUpperCase()}</div>
            <div className="people-row-main">
              <div className="people-row-top">
                <strong>{person.name}</strong>
                <span>{person.mention_count}</span>
              </div>
              <div className="people-row-sub">
                <span>{formatDate(person.last_seen)}</span>
                {!!person.emails?.length && <span>{person.emails[0]}</span>}
              </div>
              <div className="people-source-chips">
                {Object.entries(person.sources || {}).map(([source, count]) => (
                  <span key={source}>{sourceLabel(source)} {count}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
    );
  }

  function Timeline({ detail, onOpenNote }) {
    if (!detail) {
      return (
        <div className="people-empty people-empty-panel">
          <Icon name="user-round-search" size={24} />
          <div>Select a person</div>
          <p>Interactions are filtered to the scopes currently visible in Lore.</p>
        </div>
      );
    }
    const interactions = detail.interactions || [];
    return (
      <div className="people-detail">
        <div className="people-profile">
          <div className="people-profile-avatar">{detail.person.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <h2>{detail.person.name}</h2>
            <div className="people-profile-meta">
              <span>{detail.person.mention_count} mentions</span>
              <span>Last seen {formatDate(detail.person.last_seen)}</span>
            </div>
            {!!detail.person.emails?.length && (
              <div className="people-email-list">
                {detail.person.emails.map((email) => <span key={email}>{email}</span>)}
              </div>
            )}
          </div>
        </div>

        <div className="people-timeline">
          {interactions.map((item) => (
            <div className="people-event" key={`${item.note_id}-${item.date}`}>
              <div className="people-event-dot" />
              <div className="people-event-card">
                <div className="people-event-meta">
                  <span>{formatDate(item.date)}</span>
                  <span>{sourceLabel(item.source_type)}</span>
                </div>
                <button type="button" className="people-note-link" onClick={() => openNote(item.note_id, item.title, onOpenNote)}>
                  {item.title || item.note_id}
                </button>
                {!!item.evidence && <p>{item.evidence}</p>}
              </div>
            </div>
          ))}
          {!interactions.length && (
            <div className="people-empty people-empty-panel">
              <Icon name="list-tree" size={22} />
              <div>No in-scope interactions</div>
            </div>
          )}
        </div>
      </div>
    );
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
    return (
      <div className="people-actions">
        <button type="button" className="people-icon-button" disabled={!selected} onClick={() => setMergeMode(!mergeMode)} title="Merge">
          <Icon name="git-merge" />
        </button>
        <button type="button" className="people-icon-button" disabled={!selected} onClick={hide} title="Hide">
          <Icon name="eye-off" />
        </button>
        {mergeMode && (
          <div className="people-merge-controls">
            <select value={mergeId} onChange={(event) => setMergeId(event.target.value)}>
              <option value="">Merge duplicate...</option>
              {candidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <button type="button" onClick={merge} disabled={!mergeId}>Merge</button>
          </div>
        )}
      </div>
    );
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

    return (
      <div className="people-view">
        {/* Theme vars only — hardcoded light hexes made this view ignore dark mode. */}
        <style>{`
          .people-view { display: grid; grid-template-columns: minmax(260px, 34%) 1fr; gap: 1px; height: 100%; min-height: 0; flex: 1; background: var(--border-subtle); color: var(--text-body); }
          .people-sidebar, .people-panel { min-height: 0; background: var(--surface-panel); }
          .people-sidebar { display: flex; flex-direction: column; }
          .people-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border-subtle); }
          .people-header h1 { margin: 0; font-size: 17px; line-height: 1.2; color: var(--text-strong); }
          .people-header span { color: var(--text-subtle); font-size: 12px; }
          .people-actions { display: flex; align-items: center; gap: 8px; }
          .people-icon-button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--surface-raised); border-radius: var(--radius-sm); color: var(--text-body); cursor: pointer; }
          .people-icon-button:disabled { opacity: 0.45; cursor: default; }
          .people-merge-controls { display: flex; align-items: center; gap: 6px; }
          .people-merge-controls select, .people-merge-controls button { height: 32px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-raised); color: var(--text-body); font-size: 12px; }
          .people-list { overflow: auto; padding: 8px; }
          .people-row { width: 100%; display: grid; grid-template-columns: 36px 1fr; gap: 10px; border: 0; background: transparent; text-align: left; padding: 10px; border-radius: var(--radius-md); color: inherit; cursor: pointer; }
          .people-row:hover, .people-row.is-active { background: var(--surface-inset); box-shadow: inset 0 0 0 1px var(--border-subtle); }
          .people-avatar, .people-profile-avatar { display: grid; place-items: center; border-radius: 999px; background: var(--brand-soft-bg); color: var(--brand-fg); font-weight: 700; }
          .people-avatar { width: 36px; height: 36px; }
          .people-row-main { min-width: 0; }
          .people-row-top { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--text-strong); }
          .people-row-top strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .people-row-top span { color: var(--text-muted); font-variant-numeric: tabular-nums; }
          .people-row-sub { display: flex; gap: 8px; color: var(--text-subtle); font-size: 12px; min-width: 0; }
          .people-row-sub span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .people-source-chips, .people-email-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
          .people-source-chips span, .people-email-list span, .people-event-meta span { border-radius: 999px; background: var(--brand-soft-bg); color: var(--brand-fg); padding: 2px 7px; font-size: 11px; line-height: 1.5; }
          .people-panel { overflow: auto; }
          .people-detail { padding: 18px; }
          .people-profile { display: flex; align-items: center; gap: 14px; padding-bottom: 18px; border-bottom: 1px solid var(--border-subtle); }
          .people-profile-avatar { width: 48px; height: 48px; font-size: 20px; }
          .people-profile h2 { margin: 0 0 5px; font-size: 21px; line-height: 1.2; color: var(--text-strong); }
          .people-profile-meta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--text-subtle); font-size: 12px; }
          .people-timeline { padding: 18px 0 0; }
          .people-event { position: relative; display: grid; grid-template-columns: 18px 1fr; gap: 10px; }
          .people-event:not(:last-child)::before { content: ""; position: absolute; left: 8px; top: 16px; bottom: -4px; width: 1px; background: var(--border); }
          .people-event-dot { width: 9px; height: 9px; margin: 7px auto 0; border-radius: 999px; background: var(--brand-fg); }
          .people-event-card { margin-bottom: 12px; padding: 12px; border-radius: var(--radius-md); background: var(--surface-raised); border: 1px solid var(--border-subtle); }
          .people-event-meta { display: flex; gap: 6px; margin-bottom: 8px; }
          .people-note-link { border: 0; background: transparent; color: var(--brand-fg); padding: 0; font-weight: 650; text-align: left; cursor: pointer; font-size: 13px; }
          .people-event-card p { margin: 8px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.45; }
          .people-empty { margin: 18px; min-height: 180px; display: grid; place-items: center; align-content: center; gap: 8px; text-align: center; color: var(--text-subtle); }
          .people-empty div { color: var(--text-strong); font-weight: 650; }
          .people-empty p { margin: 0; max-width: 320px; font-size: 13px; line-height: 1.45; }
          .people-empty-panel { height: calc(100% - 36px); }
          .people-error { margin: 12px; padding: 10px; border-radius: var(--radius-md); border: 1px solid var(--danger-border); color: var(--danger-fg); font-size: 13px; }
          @media (max-width: 780px) { .people-view { grid-template-columns: 1fr; grid-template-rows: minmax(240px, 42%) 1fr; } }
        `}</style>
        <aside className="people-sidebar">
          <div className="people-header">
            <div>
              <h1>People</h1>
              <span>{loading ? "Loading" : `${people.length} visible`}</span>
            </div>
          </div>
          {error && <div className="people-error">{error}</div>}
          <PeopleList people={people} selectedId={selected?.id} onSelect={selectPerson} />
        </aside>
        <main className="people-panel">
          <div className="people-header">
            <div>
              <h1>{selected ? selected.name : "Interactions"}</h1>
              <span>Filtered by current scopes</span>
            </div>
            <MergeBar people={people} selected={selected} tenant={tenant} scopes={scopeKey} onMerged={() => loadPeople(selected?.id)} />
          </div>
          <Timeline detail={detail} onOpenNote={onOpenNote} />
        </main>
      </div>
    );
  }

  window.LorePeopleView = LorePeopleView;
})();
