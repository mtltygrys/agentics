import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchModels,
  fetchSystemMaps,
  fetchRuns,
  fetchRun,
  listWorkspaceFiles,
  readWorkspaceFile,
  getPermissions,
  setPermissions,
  fetchWorkflowAgents,
  fetchWorkflowEvents,
  listProjects,
  createProject,
} from './api';

import ChatPanel from './ChatPanel';
import PreviewPane from './PreviewPane';
import FileBrowser from './FileBrowser';
import RightPanel from './RightPanel';

function safeModelList(data) {
  const arr = data?.data || data?.models || [];
  if (Array.isArray(arr)) return arr;
  return [];
}

export default function App() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [projects, setProjects] = useState(['default']);
  const [projectId, setProjectId] = useState('default');
  const [maps, setMaps] = useState(null);

  const [messages, setMessages] = useState([
    { role: 'system', content: 'You are the Orchestrator. Be truthful, verify when needed, and follow read→patch rules.' }
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const [middleMode, setMiddleMode] = useState('preview'); // 'preview' | 'files'
  const [previewFullscreen, setPreviewFullscreen] = useState(false);

  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [fileError, setFileError] = useState('');

  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRun, setSelectedRun] = useState(null);

  const [rightTab, setRightTab] = useState('workflow'); // 'workflow' | 'actions' | 'runs' | 'maps'

  const [permissions, setLocalPermissions] = useState({
    self_modify: false,
    file_write: true,
    shell: false,
    web: false,
  });

  const [activeTraceId, setActiveTraceId] = useState('');
  const [agents, setAgents] = useState([]);
  const [eventsByAgent, setEventsByAgent] = useState({});
  const pollRef = useRef(null);

  const [orchestratorDecision, setOrchestratorDecision] = useState(null);

  const previewUrl = useMemo(() => {
    const base = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
    return `${base}/preview/${projectId}/preview/`;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const pjs = await listProjects();
        if (pjs?.ok && Array.isArray(pjs.projects) && pjs.projects.length) {
          setProjects(pjs.projects);
          if (!projectId) setProjectId(pjs.projects[0]);
        }
      } catch (e) {
        // ignore
      }

      try {
        const m = await fetchModels();
        // Deduplicate to avoid React "duplicate key" warnings in <select>.
        const raw = safeModelList(m)
          .map(x => x?.id || x?.name || String(x))
          .filter(Boolean);
        const seen = new Set();
        const list = [];
        for (const id of raw) {
          if (seen.has(id)) continue;
          seen.add(id);
          list.push(id);
        }
        setModels(list);
        if (!model && list.length) setModel(list[0]);
      } catch (e) {
        // backend may not have key yet
      }

      try {
        const sm = await fetchSystemMaps();
        setMaps(sm);
      } catch (e) {
        // ignore
      }

      try {
        const r = await fetchRuns(projectId);
        setRuns(r?.runs || []);
      } catch (e) {
        // ignore
      }

      try {
        const p = await getPermissions(projectId);
        if (p?.ok && p?.permissions) setLocalPermissions(p.permissions);
      } catch (e) {
        // ignore
      }

      try {
        const wf = await fetchWorkflowAgents(projectId, '');
        if (wf?.ok && Array.isArray(wf.agents)) setAgents(wf.agents);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (middleMode !== 'files') return;
    (async () => {
      try {
        const data = await listWorkspaceFiles(projectId);
        if (data?.ok) setWorkspaceFiles(data.files || []);
      } catch (e) {
        // ignore
      }
    })();
  }, [middleMode]);

  async function onSelectFile(path) {
    setSelectedFile(path);
    setSelectedFileContent('');
    setFileError('');
    if (!path) return;
    try {
      const data = await readWorkspaceFile(projectId, path);
      if (data?.ok) setSelectedFileContent(String(data.content || ''));
      else setFileError(String(data?.error || 'Failed to read file'));
    } catch (e) {
      setFileError(e?.message || String(e));
    }
  }

  async function onLoadRun(traceId) {
    if (!traceId) return;
    try {
      const data = await fetchRun(projectId, traceId);
      setSelectedRunId(traceId);
      setSelectedRun(data);
      setRightTab('runs');
    } catch (e) {
      setSelectedRunId(traceId);
      setSelectedRun({ ok: false, error: e?.message || String(e) });
      setRightTab('runs');
    }
  }

  async function onTogglePermission(key) {
    const next = { ...permissions, [key]: !permissions[key] };
    setLocalPermissions(next);
    try {
      await setPermissions(projectId, next);
    } catch (e) {
      // ignore (UI still reflects user's intent)
    }
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;

    // Single entrypoint: Orchestrator decides whether this is chat or workflow.
    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);

    try {
      const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000'}/api/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: nextMessages,
          project_id: projectId,
          reasoning_model: '',
          enable_postprocess: true,
          max_steps: 10,
          permissions,
          parallel_tool_calls: true,
        })
      }).then(r => r.json());

      const mode = (resp?.mode || 'chat').toLowerCase();
      const orchReply = (resp?.reply || '').trim();

      // Always surface the orchestrator's decision in the right-side Workflow panel.
      setOrchestratorDecision({
        ts: Date.now(),
        mode,
        goal: resp?.goal ?? null,
        confidence: resp?.confidence ?? null,
        reason: resp?.reason ?? '',
        trace_id: resp?.trace_id ?? '',
      });

      if (mode === 'workflow') {
        setRightTab('workflow');
        setMiddleMode('preview');
        setPreviewFullscreen(false);
        if (resp?.trace_id) setActiveTraceId(resp.trace_id);
        if (orchReply) setMessages(prev => [...prev, { role: 'assistant', content: orchReply }]);

        // refresh runs list
        try {
          const r = await fetchRuns(projectId);
          setRuns(r?.runs || []);
        } catch (e) {
          // ignore
        }
        return;
      }

      // chat mode: append assistant message
      let content = orchReply;
      if (!content) {
        content = resp?.result?.choices?.[0]?.message?.content || '';
      }
      if (content) setMessages(prev => [...prev, { role: 'assistant', content }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e?.message || String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  // Poll workflow events for the active trace.
  useEffect(() => {
    if (!activeTraceId) return;
    if (pollRef.current) clearInterval(pollRef.current);

    async function tick() {
      try {
        const a = await fetchWorkflowAgents(projectId, activeTraceId);
        if (a?.ok && Array.isArray(a.agents)) setAgents(a.agents);
        const ev = await fetchWorkflowEvents(projectId, activeTraceId);
        if (ev?.ok && ev?.events_by_agent) setEventsByAgent(ev.events_by_agent);
      } catch (e) {
        // ignore
      }
    }

    tick();
    pollRef.current = setInterval(tick, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeTraceId]);

  async function onStartWorkflow(goalText) {
    if (!goalText?.trim() || busy) return;
    setBusy(true);
    setRightTab('workflow');
    setMiddleMode('preview');
    setPreviewFullscreen(false);

    try {
      const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000'}/api/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          goal: goalText,
          project_id: projectId,
          enable_postprocess: true,
          max_steps: 10,
          permissions,
        })
      }).then(r => r.json());

      if (resp?.trace_id) setActiveTraceId(resp.trace_id);

      // refresh runs list
      try {
        const r = await fetchRuns(projectId);
        setRuns(r?.runs || []);
      } catch (e) {
        // ignore
      }
    } catch (e) {
      // show error as an agent event fallback
    } finally {
      setBusy(false);
    }
  }

  const layout = previewFullscreen ? styles.pageFullscreen : styles.page;

  return (
    <div style={layout}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <div style={styles.logo}>AI</div>
          <div>
            <div style={styles.title}>Serious AI Builder</div>
            <div style={styles.sub}>Orchestrator • Observable Agents • No Theater</div>
          </div>
        </div>

        <div style={styles.controls}>

<select style={styles.select} value={projectId} onChange={async (e) => {
  const pid = e.target.value;
  setProjectId(pid);
  setActiveTraceId('');
  setSelectedRunId('');
  setSelectedRun(null);
  try {
    const r = await fetchRuns(pid);
    setRuns(r?.runs || []);
  } catch (err) {}
  try {
    const p = await getPermissions(pid);
    if (p?.ok && p?.permissions) setLocalPermissions(p.permissions);
  } catch (err) {}
  try {
    const wf = await fetchWorkflowAgents(pid, '');
    if (wf?.ok && Array.isArray(wf.agents)) setAgents(wf.agents);
  } catch (err) {}
}}>
  {projects.map(p => <option key={p} value={p}>{p}</option>)}
</select>
<button style={styles.smallBtn} onClick={async () => {
  try {
    const created = await createProject('');
    if (created?.ok && created.project_id) {
      const pid = created.project_id;
      const pjs = await listProjects();
      if (pjs?.ok && Array.isArray(pjs.projects)) setProjects(pjs.projects);
      setProjectId(pid);
      setActiveTraceId('');
      setSelectedRunId('');
      setSelectedRun(null);
      setMiddleMode('preview');
      setPreviewFullscreen(false);
      try {
        const r = await fetchRuns(pid);
        setRuns(r?.runs || []);
      } catch (err) {}
      try {
        const p = await getPermissions(pid);
        if (p?.ok && p?.permissions) setLocalPermissions(p.permissions);
      } catch (err) {}
    }
  } catch (err) {}
}}>New Project</button>

          <select style={styles.select} value={model} onChange={e => setModel(e.target.value)}>
            {models.length ? models.map(m => <option key={m} value={m}>{m}</option>) : <option value="">(models)</option>}
          </select>
          <a style={styles.link} href={previewUrl} target="_blank" rel="noreferrer">Open Preview</a>
        </div>
      </header>

      <main style={previewFullscreen ? styles.mainFullscreen : styles.main}>
        {!previewFullscreen && (
          <section style={styles.left}>
            <ChatPanel
              busy={busy}
              messages={messages}
              draft={draft}
              setDraft={setDraft}
              onSend={onSend}
            />
          </section>
        )}

        <section style={styles.middle}>
          <div style={styles.middleHead}>
            {!previewFullscreen && (
              <div style={styles.middleTabs}>
                <button
                  style={{ ...styles.tabBtn, ...(middleMode === 'preview' ? styles.tabBtnActive : {}) }}
                  onClick={() => setMiddleMode('preview')}
                >Preview</button>
                <button
                  style={{ ...styles.tabBtn, ...(middleMode === 'files' ? styles.tabBtnActive : {}) }}
                  onClick={() => setMiddleMode('files')}
                >Files</button>
              </div>
            )}

            <div style={styles.middleRight}>
              {middleMode === 'preview' && (
                <button style={styles.smallBtn} onClick={() => setPreviewFullscreen(v => !v)}>
                  {previewFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                </button>
              )}
              <div style={styles.middleMeta}>{middleMode === 'preview' ? 'workspace/preview' : 'workspace/*'}</div>
            </div>
          </div>

          <div style={styles.middleBody}>
            {middleMode === 'preview' ? (
              <PreviewPane src={previewUrl} />
            ) : (
              <FileBrowser
                files={workspaceFiles}
                selectedFile={selectedFile}
                content={selectedFileContent}
                error={fileError}
                onSelectFile={onSelectFile}
                onRefresh={async () => {
                  const data = await listWorkspaceFiles(projectId);
                  if (data?.ok) setWorkspaceFiles(data.files || []);
                }}
              />
            )}
          </div>
        </section>

        {!previewFullscreen && (
          <section style={styles.right}>
            <RightPanel
              tab={rightTab}
              setTab={setRightTab}
              permissions={permissions}
              onTogglePermission={onTogglePermission}
              runs={runs}
              selectedRun={selectedRun}
              selectedRunId={selectedRunId}
              onLoadRun={onLoadRun}
              maps={maps}
              traceId={activeTraceId}
              agents={agents}
              eventsByAgent={eventsByAgent}
              orchestratorDecision={orchestratorDecision}
            />
          </section>
        )}
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(1100px 600px at 15% 10%, rgba(90,140,255,.25), transparent 60%), radial-gradient(900px 500px at 80% 0%, rgba(186,85,255,.22), transparent 55%), #070b14',
    color: '#e9eefc',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
  },
  pageFullscreen: {
    minHeight: '100vh',
    background: '#070b14',
    color: '#e9eefc',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 22px',
    background: 'linear-gradient(to bottom, rgba(7,11,20,.86), rgba(7,11,20,.55))',
    borderBottom: '1px solid rgba(233,238,252,.12)',
    backdropFilter: 'blur(10px)'
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    fontWeight: 800,
    background: 'linear-gradient(135deg, rgba(90,140,255,.9), rgba(186,85,255,.85))',
    boxShadow: '0 12px 34px rgba(0,0,0,.35)'
  },
  title: { fontWeight: 800, letterSpacing: .2 },
  sub: { fontSize: 12, opacity: .75 },
  controls: { display: 'flex', alignItems: 'center', gap: 12 },
  select: {
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(233,238,252,.12)',
    color: '#e9eefc',
    padding: '10px 12px',
    borderRadius: 12
  },
  link: { color: '#e9eefc', opacity: .85, textDecoration: 'none' },
  main: {
    display: 'grid',
    gridTemplateColumns: '1.1fr 1.4fr 1fr',
    gap: 14,
    padding: 14,
    height: 'calc(100vh - 74px)',
    boxSizing: 'border-box'
  },
  mainFullscreen: {
    padding: 0,
    height: 'calc(100vh - 74px)',
  },
  left: {
    border: '1px solid rgba(233,238,252,.12)',
    borderRadius: 16,
    background: 'rgba(255,255,255,.04)',
    overflow: 'hidden',
    minHeight: 0,
  },
  middle: {
    border: '1px solid rgba(233,238,252,.12)',
    borderRadius: 16,
    background: 'rgba(255,255,255,.04)',
    overflow: 'hidden',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column'
  },
  right: {
    border: '1px solid rgba(233,238,252,.12)',
    borderRadius: 16,
    background: 'rgba(255,255,255,.04)',
    overflow: 'hidden',
    minHeight: 0,
  },
  middleHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(233,238,252,.10)',
    background: 'rgba(0,0,0,.12)'
  },
  middleTabs: { display: 'flex', gap: 8 },
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
  middleRight: { display: 'flex', alignItems: 'center', gap: 10 },
  smallBtn: {
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(233,238,252,.12)',
    color: '#e9eefc',
    padding: '8px 10px',
    borderRadius: 12,
    cursor: 'pointer'
  },
  middleMeta: { fontSize: 12, opacity: .75 },
  middleBody: { flex: 1, minHeight: 0 }
};
