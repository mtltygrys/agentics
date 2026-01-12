import React, { useMemo } from 'react';

function bullets(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return (
    <ul style={styles.ul}>
      {arr.map((x, i) => <li key={i}>{String(x)}</li>)}
    </ul>
  );
}

export default function RunsPanel({ runs, selectedRun, selectedRunId, onLoadRun }) {
  const summary = useMemo(() => {
    const s = selectedRun?.architect_summary;
    if (!s || typeof s !== 'object') return null;
    return s;
  }, [selectedRun]);

  return (
    <div style={styles.wrap}>
      <div style={styles.split}>
        <div style={styles.left}>
          <div style={styles.title}>Runs</div>
          <div style={styles.list}>
            {runs?.length ? runs.slice().reverse().map(id => (
              <button
                key={id}
                onClick={() => onLoadRun(id)}
                style={{ ...styles.item, ...(selectedRunId === id ? styles.itemActive : {}) }}
              >{id.slice(0, 8)}…</button>
            )) : <div style={styles.muted}>No runs yet.</div>}
          </div>
        </div>

        <div style={styles.right}>
          <div style={styles.title}>Selected</div>
          {!selectedRun ? (
            <div style={styles.muted}>Pick a run to inspect outcomes.</div>
          ) : selectedRun?.ok === false ? (
            <div style={styles.error}>{String(selectedRun?.error || 'Run failed to load')}</div>
          ) : (
            <div>
              {summary ? (
                <div style={styles.card}>
                  <div style={styles.cardTitle}>Architect summary</div>

                  <div style={styles.block}><b>Goal</b><div>{String(summary.goal || '')}</div></div>
                  <div style={styles.block}><b>Changes</b><div>{String(summary.changes_summary || '')}</div></div>

                  <div style={styles.grid2}>
                    <div>
                      <div style={styles.subTitle}>Decisions</div>
                      {bullets(summary.decisions)}
                    </div>
                    <div>
                      <div style={styles.subTitle}>Files touched</div>
                      {bullets(summary.files_touched)}
                    </div>
                    <div>
                      <div style={styles.subTitle}>Open questions</div>
                      {bullets(summary.open_questions)}
                    </div>
                    <div>
                      <div style={styles.subTitle}>Next steps</div>
                      {bullets(summary.next_steps)}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={styles.muted}>No architect summary found for this run.</div>
              )}

              {selectedRun?.notes ? (
                <div style={styles.card}>
                  <div style={styles.cardTitle}>Notes</div>
                  <pre style={styles.pre}>{String(selectedRun.notes)}</pre>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { padding: 12, height: '100%', boxSizing: 'border-box' },
  split: { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, height: '100%', minHeight: 0 },
  left: { border: '1px solid rgba(233,238,252,.10)', borderRadius: 14, background: 'rgba(0,0,0,.12)', overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' },
  right: { minHeight: 0, overflow: 'auto' },
  title: { fontWeight: 900, marginBottom: 8 },
  list: { flex: 1, overflow: 'auto', padding: 10 },
  item: {
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 12,
    border: '1px solid rgba(233,238,252,.08)',
    background: 'rgba(255,255,255,.03)',
    color: '#e9eefc',
    cursor: 'pointer',
    marginBottom: 8,
  },
  itemActive: { background: 'linear-gradient(135deg, rgba(90,140,255,.22), rgba(186,85,255,.14))', border: '1px solid rgba(233,238,252,.16)' },
  muted: { opacity: .75, fontSize: 13 },
  error: { padding: 12, borderRadius: 14, border: '1px solid rgba(255,120,120,.35)', background: 'rgba(255,80,80,.08)' },
  card: { border: '1px solid rgba(233,238,252,.10)', borderRadius: 14, background: 'rgba(0,0,0,.12)', padding: 12, marginBottom: 12 },
  cardTitle: { fontWeight: 900, marginBottom: 8 },
  block: { marginBottom: 10, lineHeight: 1.35 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  subTitle: { fontWeight: 900, marginBottom: 6 },
  ul: { margin: 0, paddingLeft: 18, lineHeight: 1.35 },
  pre: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.35 },
};
