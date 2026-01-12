import React, { useMemo, useState } from 'react';

function formatTime(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString();
  } catch {
    return '';
  }
}

export default function WorkflowPanel({ traceId, agents, eventsByAgent, orchestratorDecision }) {
  const agentIds = useMemo(() => {
    const list = Array.isArray(agents) ? agents : [];
    return list.map(a => a.name).filter(Boolean);
  }, [agents]);

  const [activeAgent, setActiveAgent] = useState('');

  const effectiveActive = useMemo(() => {
    if (activeAgent && agentIds.includes(activeAgent)) return activeAgent;
    return agentIds[0] || '';
  }, [activeAgent, agentIds]);

  const activeInfo = useMemo(() => {
    const list = Array.isArray(agents) ? agents : [];
    return list.find(a => a.name === effectiveActive) || null;
  }, [agents, effectiveActive]);

  const events = (eventsByAgent && effectiveActive) ? (eventsByAgent[effectiveActive] || []) : [];

  const comms = events.filter(e => e.kind === 'comms');
  const timeline = events.filter(e => e.kind !== 'comms');

  return (
    <div style={styles.wrap}>
      <div style={styles.top}>
        <div style={styles.title}>Workflow</div>
        <div style={styles.meta}>{traceId ? `Trace: ${traceId.slice(0, 8)}…` : 'No workflow run yet — send a message in Chat to start agents'}</div>
      </div>

      {orchestratorDecision ? (
        <div style={styles.decisionCard}>
          <div style={styles.decisionHead}>
            <div style={styles.decisionTitle}>Orchestrator decision</div>
            <div style={styles.decisionMeta}>
              {orchestratorDecision?.mode ? `mode: ${orchestratorDecision.mode}` : ''}
              {typeof orchestratorDecision?.confidence === 'number' ? ` · confidence: ${orchestratorDecision.confidence.toFixed(2)}` : ''}
            </div>
          </div>
          <div style={styles.decisionBody}>
            {orchestratorDecision?.reason ? (
              <div style={styles.decisionRow}>
                <div style={styles.decisionLabel}>Why</div>
                <div style={styles.decisionValue}>{orchestratorDecision.reason}</div>
              </div>
            ) : null}
            {orchestratorDecision?.goal ? (
              <div style={styles.decisionRow}>
                <div style={styles.decisionLabel}>Goal</div>
                <div style={styles.decisionValue}>{String(orchestratorDecision.goal)}</div>
              </div>
            ) : null}
            {orchestratorDecision?.trace_id ? (
              <div style={styles.decisionRow}>
                <div style={styles.decisionLabel}>Trace</div>
                <div style={styles.decisionValue}>{String(orchestratorDecision.trace_id)}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={styles.agentTabs}>
        {agentIds.length ? agentIds.map(id => (
          <button
            key={id}
            onClick={() => setActiveAgent(id)}
            style={{ ...styles.agentBtn, ...(effectiveActive === id ? styles.agentBtnActive : {}) }}
          >{id}</button>
        )) : <div style={styles.muted}>No agent activity yet. Send a message in Chat to start a workflow and see live steps here.</div>}
      </div>

      {effectiveActive ? (
        <div style={styles.card}>
          <div style={styles.cardHead}>
            <div>
              <div style={styles.agentName}>{effectiveActive}</div>
              <div style={styles.agentMeta}>
                <span style={styles.badge}>{activeInfo?.status || 'Idle'}</span>
                <span style={styles.agentGoal}>{activeInfo?.mission || ''}</span>
              </div>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Live feed</div>
            <div style={styles.feed}>
              {events.length ? events.slice().reverse().slice(0, 60).reverse().map((e, idx) => (
                <div key={idx} style={styles.feedRow}>
                  <div style={styles.time}>{formatTime(e.ts)}</div>
                  <div style={styles.text}>{e.text}</div>
                </div>
              )) : <div style={styles.muted}>No events for this agent yet.</div>}
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>What it did (human map)</div>
            <div style={styles.mapGrid}>
              <div style={styles.mapCol}>
                <div style={styles.mapTitle}>Timeline</div>
                {timeline.length ? timeline.map((e, idx) => (
                  <div key={idx} style={styles.mapItem}>
                    <div style={styles.mapItemHead}>{formatTime(e.ts)} · {e.level || 'info'}</div>
                    <div style={styles.mapItemBody}>{e.text}</div>
                  </div>
                )) : <div style={styles.muted}>No timeline yet.</div>}
              </div>
              <div style={styles.mapCol}>
                <div style={styles.mapTitle}>Communications</div>
                {comms.length ? comms.map((e, idx) => (
                  <div key={idx} style={styles.mapItem}>
                    <div style={styles.mapItemHead}>{formatTime(e.ts)}</div>
                    <div style={styles.mapItemBody}>{e.text}</div>
                  </div>
                )) : <div style={styles.muted}>No messages exchanged.</div>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const styles = {
  wrap: { padding: 12 },
  top: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontWeight: 900, letterSpacing: .2 },
  meta: { opacity: .75, fontSize: 12 },
  decisionCard: {
    border: '1px solid rgba(233,238,252,.10)',
    borderRadius: 14,
    background: 'rgba(0,0,0,.12)',
    padding: 10,
    marginBottom: 12,
  },
  decisionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  decisionTitle: { fontWeight: 900 },
  decisionMeta: { opacity: .75, fontSize: 12 },
  decisionBody: { display: 'grid', gap: 8 },
  decisionRow: { display: 'grid', gridTemplateColumns: '60px 1fr', gap: 10 },
  decisionLabel: { opacity: .75, fontSize: 12 },
  decisionValue: { whiteSpace: 'pre-wrap', lineHeight: 1.35, fontSize: 13 },
  agentTabs: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  agentBtn: {
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(233,238,252,.12)',
    color: '#e9eefc',
    padding: '8px 10px',
    borderRadius: 12,
    cursor: 'pointer'
  },
  agentBtnActive: {
    background: 'linear-gradient(135deg, rgba(90,140,255,.35), rgba(186,85,255,.22))',
    border: '1px solid rgba(233,238,252,.22)'
  },
  card: {
    border: '1px solid rgba(233,238,252,.12)',
    borderRadius: 16,
    background: 'rgba(255,255,255,.04)',
    overflow: 'hidden'
  },
  cardHead: {
    padding: 12,
    borderBottom: '1px solid rgba(233,238,252,.10)',
    background: 'rgba(0,0,0,.10)'
  },
  agentName: { fontWeight: 900, fontSize: 16 },
  agentMeta: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 },
  badge: {
    fontSize: 12,
    padding: '4px 8px',
    borderRadius: 999,
    border: '1px solid rgba(233,238,252,.14)',
    background: 'rgba(255,255,255,.06)',
    opacity: .9
  },
  agentGoal: { fontSize: 13, opacity: .85 },
  section: { padding: 12, borderTop: '1px solid rgba(233,238,252,.10)' },
  sectionTitle: { fontWeight: 900, marginBottom: 8 },
  feed: {
    border: '1px solid rgba(233,238,252,.10)',
    borderRadius: 14,
    background: 'rgba(0,0,0,.14)',
    padding: 10,
    maxHeight: 260,
    overflow: 'auto'
  },
  feedRow: { display: 'grid', gridTemplateColumns: '82px 1fr', gap: 10, padding: '6px 0' },
  time: { fontSize: 12, opacity: .75 },
  text: { whiteSpace: 'pre-wrap', lineHeight: 1.35 },
  mapGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  mapCol: {
    border: '1px solid rgba(233,238,252,.10)',
    borderRadius: 14,
    background: 'rgba(0,0,0,.12)',
    padding: 10,
    minHeight: 120
  },
  mapTitle: { fontWeight: 900, marginBottom: 8 },
  mapItem: { padding: '8px 10px', borderRadius: 12, border: '1px solid rgba(233,238,252,.08)', background: 'rgba(255,255,255,.03)', marginBottom: 8 },
  mapItemHead: { fontSize: 12, opacity: .75, marginBottom: 4 },
  mapItemBody: { whiteSpace: 'pre-wrap', lineHeight: 1.35, fontSize: 13 },
  muted: { opacity: .75, fontSize: 13 },
};
