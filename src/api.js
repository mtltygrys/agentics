import axios from 'axios';

const BASE_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

export async function fetchModels() {
  const res = await axios.get(`${BASE_URL}/api/models`);
  return res.data;
}

export async function fetchSystemMaps() {
  const res = await axios.get(`${BASE_URL}/api/system/maps`);
  return res.data;
}

export async function sendChat(model, messages) {
  const res = await axios.post(`${BASE_URL}/api/chat`, {
    model,
    messages
  });
  return res.data;
}

export async function fetchRuns(projectId = "default") {
  const res = await axios.get(`${BASE_URL}/api/runs`, { params: { project_id: projectId } });
  return res.data;
}

export async function fetchRun(projectId, traceId) {
  const res = await axios.get(`${BASE_URL}/api/runs/${encodeURIComponent(projectId)}/${encodeURIComponent(traceId)}`);
  return res.data;
}

// ---- Workspace browsing (read-only) ----
export async function listWorkspaceFiles(projectId = 'default') {
  const res = await axios.get(`${BASE_URL}/api/workspace/list`, { params: { project_id: projectId } });
  return res.data;
}

export async function readWorkspaceFile(projectId = 'default', path = '') {
  const res = await axios.get(`${BASE_URL}/api/workspace/read`, { params: { project_id: projectId, path } });
  return res.data;
}

// ---- Permissions (runtime toggles) ----
export async function getPermissions(projectId = 'default') {
  const res = await axios.get(`${BASE_URL}/api/permissions`, { params: { project_id: projectId } });
  return res.data;
}

export async function setPermissions(projectId = 'default', permissions = {}) {
  const res = await axios.post(`${BASE_URL}/api/permissions`, { project_id: projectId, permissions });
  return res.data;
}

// ---- Workflow observability (human-readable events) ----
export async function fetchWorkflowAgents(projectId = 'default', traceId = '') {
  const res = await axios.get(`${BASE_URL}/api/workflow/agents`, { params: { project_id: projectId, trace_id: traceId } });
  return res.data;
}

export async function fetchWorkflowEvents(projectId = 'default', traceId = '') {
  const res = await axios.get(`${BASE_URL}/api/workflow/events`, { params: { project_id: projectId, trace_id: traceId } });
  return res.data;
}


// ---- Projects ----
export async function listProjects() {
  const res = await axios.get(`${BASE_URL}/api/projects`);
  return res.data;
}

export async function createProject(name = "") {
  const res = await axios.post(`${BASE_URL}/api/projects`, { name });
  return res.data;
}
