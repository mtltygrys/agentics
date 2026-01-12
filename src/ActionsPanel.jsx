import React, { useMemo } from 'react';

function flattenEvents(eventsByAgent) {
  const out = [];
  if (!eventsByAgent) return out;
  for (const [agent, events] of Object.entries(eventsByAgent)) {
    (events || []).forEach(e => out.push({ ...e, agent }));
  }
  out.sort((a, b) => (new Date(a.ts)).getTime() - (new Date(b.ts)).getTime());
  return out;
}

export default function ActionsPanel({ traceId, agents, eventsByAgent, permissions, onTogglePermission }) {
  const flat = useMemo(() => flattenEvents(eventsByAgent), [eventsByAgent]);
  const latest = flat.slice().reverse().slice(0, 120).reverse();

  return (
    <div style={styles.wrap}>
      <div style={styles.sectionTitle}>Permissions</div>
      <div style={styles.perms}>
        <PermToggle label="Self-modify" value={!!permissions.self_modify} onClick={() => onTogglePermission('self_modify')} />
        <PermToggle label="File write" value={!!permissions.file_write} onClick={() => onTogglePermission('file_write')} />
        <PermToggle label="Shell" value={!!permissions.shell} onClick={() => onTogglePermission('shell')} />
        <PermToggle label="Web" value={!!permissions.web} onClick={() => onTogglePermission('web')} />
      </div>

      <div style={{ ...styles.sectionTitle, marginTop: 14 }}>Recent actions</div>
      <div style={styles.feed}>
        {traceId ? (
          latest.length ? latest.map((e, idx) => (
            <div key={idx} style={styles.row}>
              <div style={styles.agent}>{e.agent}</div>
              <div style={styles.text}>{e.text}</div>
            </div>
          )) : <div style={styles.muted}>No actions yet.</div>
        ) : (
          <div style={styles.muted}>No active trace. Run a workflow to populate actions.</div>
        )}
      </div>
    </div>
  );
}

function PermToggle({ label, value, onClick }) {
  return (
    <button onClick={onClick} style={{ ...styles.toggle, ...(value ? styles.toggleOn : styles.toggleOff) }}>
      <div style={styles.toggleLabel}>{label}</div>
      <div style={styles.toggleVal}>{value ? 'ON' : 'OFF'}</div>
    </button>
  );
}

const styles = {
  wrap: { padding: 12 },
  sectionTitle: { fontWeight: 900, marginBottom: 8 },
  perms: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  toggle: {
    borderRadius: 14,
    border: '1px solid rgba(233,238,252,.12)',
    padding: '10px 12px',
    color: '#e9eefc',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    background: 'rgba(255,255,255,.05)'
  },
  toggleOn: { background: 'linear-gradient(135deg, rgba(90,140,255,.28), rgba(186,85,255,.16))' },
  toggleOff: { opacity: .85 },
  toggleLabel: { fontWeight: 800 },
  toggleVal: { fontSize: 12, opacity: .8 },
  feed: {
    border: '1px solid rgba(233,238,252,.10)',
    borderRadius: 14,
    background: 'rgba(0,0,0,.14)',
    padding: 10,
    maxHeight: 520,
    overflow: 'auto'
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '110px 1fr',
    gap: 10,
    padding: '6px 0',
    borderBottom: '1px solid rgba(233,238,252,.06)'
  },
  agent: { fontSize: 12, opacity: .8 },
  text: { whiteSpace: 'pre-wrap', lineHeight: 1.35 },
  muted: { opacity: .75, fontSize: 13 },
};
