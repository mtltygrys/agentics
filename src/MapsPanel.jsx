import React, { useMemo, useState } from 'react';

function countKeys(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.keys(obj).length;
}

export default function MapsPanel({ maps }) {
  const [showRaw, setShowRaw] = useState(false);

  const stats = useMemo(() => {
    const out = [];
    if (!maps) return out;
    out.push({ label: 'Agents registry', n: countKeys(maps.agents_registry) });
    out.push({ label: 'Capabilities', n: countKeys(maps.capabilities) });
    out.push({ label: 'Permissions', n: countKeys(maps.permissions) });
    out.push({ label: 'UI map', n: countKeys(maps.ui_map) });
    out.push({ label: 'System map', n: countKeys(maps.system_map) });
    out.push({ label: 'Health checks', n: countKeys(maps.health_checks) });
    return out;
  }, [maps]);

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>System Maps (human summary)</div>
      {!maps ? (
        <div style={styles.muted}>Maps not loaded yet.</div>
      ) : (
        <>
          <div style={styles.grid}>
            {stats.map((s, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.cardTitle}>{s.label}</div>
                <div style={styles.cardVal}>{s.n} keys</div>
              </div>
            ))}
          </div>

          <div style={styles.note}>
            These are the internal maps that guide agent behavior and UI. Raw data is hidden by default.
          </div>

          <button style={styles.btn} onClick={() => setShowRaw(v => !v)}>
            {showRaw ? 'Hide raw' : 'Show raw'}
          </button>

          {showRaw ? (
            <pre style={styles.pre}>{JSON.stringify(maps, null, 2)}</pre>
          ) : null}
        </>
      )}
    </div>
  );
}

const styles = {
  wrap: { padding: 12 },
  title: { fontWeight: 900, marginBottom: 10 },
  muted: { opacity: .75, fontSize: 13 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 },
  card: { border: '1px solid rgba(233,238,252,.10)', borderRadius: 14, background: 'rgba(0,0,0,.12)', padding: 12 },
  cardTitle: { fontWeight: 900, marginBottom: 6 },
  cardVal: { opacity: .8 },
  note: { opacity: .8, fontSize: 13, lineHeight: 1.35, marginBottom: 10 },
  btn: {
    padding: '8px 10px',
    borderRadius: 12,
    border: '1px solid rgba(233,238,252,.12)',
    background: 'rgba(255,255,255,.06)',
    color: '#e9eefc',
    cursor: 'pointer',
    marginBottom: 10,
  },
  pre: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.35, opacity: .95 }
};
