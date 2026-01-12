import React, { useMemo, useState } from 'react';
import WorkflowPanel from './WorkflowPanel';
import RunsPanel from './RunsPanel';
import MapsPanel from './MapsPanel';
import ActionsPanel from './ActionsPanel';

export default function RightPanel({
  tab,
  setTab,
  permissions,
  onTogglePermission,
  runs,
  selectedRun,
  selectedRunId,
  onLoadRun,
  maps,
  traceId,
  agents,
  eventsByAgent,
  orchestratorDecision,
}) {
  const tabs = useMemo(() => ([
    { id: 'workflow', label: 'Workflow' },
    { id: 'actions', label: 'Actions' },
    { id: 'runs', label: 'Runs' },
    { id: 'maps', label: 'Maps' },
  ]), []);

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <div style={styles.tabs}>
          {tabs.map(t => (
            <button
              key={t.id}
              style={{ ...styles.tabBtn, ...(tab === t.id ? styles.tabBtnActive : {}) }}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
      </div>

      <div style={styles.body}>
        {tab === 'workflow' && (
          <WorkflowPanel traceId={traceId} agents={agents} eventsByAgent={eventsByAgent} orchestratorDecision={orchestratorDecision} />
        )}
        {tab === 'actions' && (
          <ActionsPanel traceId={traceId} agents={agents} eventsByAgent={eventsByAgent} permissions={permissions} onTogglePermission={onTogglePermission} />
        )}
        {tab === 'runs' && (
          <RunsPanel runs={runs} selectedRun={selectedRun} selectedRunId={selectedRunId} onLoadRun={onLoadRun} />
        )}
        {tab === 'maps' && (
          <MapsPanel maps={maps} />
        )}
      </div>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%' },
  head: {
    padding: '10px 12px',
    borderBottom: '1px solid rgba(233,238,252,.10)',
    background: 'rgba(0,0,0,.12)'
  },
  tabs: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tabBtn: {
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(233,238,252,.12)',
    color: '#e9eefc',
    padding: '8px 10px',
    borderRadius: 12,
    cursor: 'pointer'
  },
  tabBtnActive: {
    background: 'linear-gradient(135deg, rgba(90,140,255,.35), rgba(186,85,255,.22))',
    border: '1px solid rgba(233,238,252,.22)'
  },
  body: { flex: 1, minHeight: 0, overflow: 'auto' },
};
