import os
import json
import uuid
import time
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import anyio

load_dotenv()

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "").strip()
MISTRAL_BASE_URL = os.getenv("MISTRAL_API_URL", "https://api.mistral.ai").rstrip("/")

BASE_DIR = os.path.dirname(__file__)
WORKSPACE_DIR = os.path.join(BASE_DIR, "workspace")
PREVIEW_DIR = os.path.join(WORKSPACE_DIR, "preview")
RUNS_DIR = os.path.join(WORKSPACE_DIR, "runs")
PROJECTS_DIR = os.path.join(WORKSPACE_DIR, "projects")
RUNTIME_MEMORY_PATH = os.path.join(WORKSPACE_DIR, "project_memory.json")
RUNTIME_PERMISSIONS_PATH = os.path.join(WORKSPACE_DIR, "permissions_runtime.json")
MISTRAL_REASONING_MODEL = os.getenv("MISTRAL_REASONING_MODEL", "").strip()

class OrchestratorState(BaseModel):
    pending_execution: bool = False
    proposed_goal: Optional[str] = None
    proposed_plan: Optional[Dict[str, Any]] = None
    updated_at: float = Field(default_factory=time.time)

def _load_state(project_id: str) -> OrchestratorState:
    mem = _read_runtime_memory()
    projects = mem.get("projects", {})
    proj = projects.get(project_id, {})
    return OrchestratorState(**proj.get("state", {}))

def _save_state(project_id: str, state: OrchestratorState) -> None:
    mem = _read_runtime_memory()
    projects = mem.setdefault("projects", {})
    projects[project_id] = projects.get(project_id, {})
    projects[project_id]["state"] = state.dict()
    _write_runtime_memory(mem)

SYSTEM_DIR = os.path.join(BASE_DIR, "system")

def _load_system_json(filename: str) -> Any:
    path = os.path.join(SYSTEM_DIR, filename)
    if not os.path.exists(path):
        return {"ok": False, "error": "system_map_missing", "file": filename}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {"ok": False, "error": "system_map_invalid", "file": filename, "detail": str(e)}

def _system_context_snippet() -> str:
    agents = _load_system_json("agents_registry.json")
    perms = _load_system_json("permissions.json")
    rules = []
    if isinstance(agents, dict):
        rules += agents.get("core_rules", [])
    if isinstance(perms, dict):
        rules += [f"PERMISSION: {p}" for p in perms.get("principles", [])]
    rules = rules[:12]
    if not rules:
        return ""
    return "SYSTEM_MAP_SNIPPET:\n" + "\n".join(f"- {r}" for r in rules) + "\n"

os.makedirs(WORKSPACE_DIR, exist_ok=True)
os.makedirs(PREVIEW_DIR, exist_ok=True)
os.makedirs(PROJECTS_DIR, exist_ok=True)

try:
    default_preview = os.path.join(PROJECTS_DIR, "default", "preview")
    os.makedirs(default_preview, exist_ok=True)
    legacy = PREVIEW_DIR
    if os.path.isdir(legacy):
        if not any(os.scandir(default_preview)) and any(os.scandir(legacy)):
            for root, dirs, files in os.walk(legacy):
                rel = os.path.relpath(root, legacy)
                target_root = os.path.join(default_preview, rel) if rel != "." else default_preview
                os.makedirs(target_root, exist_ok=True)
                for fn in files:
                    src = os.path.join(root, fn)
                    dst = os.path.join(target_root, fn)
                    if not os.path.exists(dst):
                        with open(src, "rb") as sf, open(dst, "wb") as df:
                            df.write(sf.read())
except Exception:
    pass

os.makedirs(RUNS_DIR, exist_ok=True)

if not os.path.exists(RUNTIME_MEMORY_PATH):
    with open(RUNTIME_MEMORY_PATH, "w", encoding="utf-8") as f:
        json.dump({"version": "1.0.0", "projects": {}}, f, indent=2)

if not os.path.exists(RUNTIME_PERMISSIONS_PATH):
    with open(RUNTIME_PERMISSIONS_PATH, "w", encoding="utf-8") as f:
        json.dump({"version": "1.0.0", "projects": {}}, f, indent=2)

def _read_runtime_permissions() -> Dict[str, Any]:
    try:
        with open(RUNTIME_PERMISSIONS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"version": "1.0.0", "projects": {}}

def _write_runtime_permissions(mem: Dict[str, Any]) -> None:
    tmp = RUNTIME_PERMISSIONS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(mem, f, indent=2, ensure_ascii=False)
    os.replace(tmp, RUNTIME_PERMISSIONS_PATH)

def _ensure_project_dirs(project_id: str) -> str:
    root = os.path.join(PROJECTS_DIR, project_id)
    os.makedirs(root, exist_ok=True)
    os.makedirs(os.path.join(root, "preview"), exist_ok=True)
    return root

def _project_root(project_id: str) -> str:
    return _ensure_project_dirs(project_id)

def _resolve_path(project_id: str, rel_path: str) -> str:
    rel_path = rel_path.lstrip("/").replace("\\", "/")
    root = _project_root(project_id)
    return os.path.normpath(os.path.join(root, rel_path))

def _get_project_permissions(project_id: str) -> Dict[str, Any]:
    mem = _read_runtime_permissions()
    projects = mem.setdefault("projects", {})
    perms = projects.setdefault(project_id, {
        "self_modify": False,
        "file_write": True,
        "shell": False,
        "web": False,
    })
    _write_runtime_permissions(mem)
    return perms

def _set_project_permissions(project_id: str, perms: Dict[str, Any]) -> Dict[str, Any]:
    mem = _read_runtime_permissions()
    projects = mem.setdefault("projects", {})
    current = projects.setdefault(project_id, {})
    for k in ("self_modify", "file_write", "shell", "web"):
        if k in perms:
            current[k] = bool(perms[k])
    for k, v in {"self_modify": False, "file_write": True, "shell": False, "web": False}.items():
        current.setdefault(k, v)
    _write_runtime_permissions(mem)
    return current

WorkflowKey = Tuple[str, str]
WORKFLOW_EVENTS: Dict[WorkflowKey, List[Dict[str, Any]]] = {}
WORKFLOW_AGENTS: Dict[WorkflowKey, Dict[str, Dict[str, Any]]] = {}

def _emit_event(project_id: str, trace_id: str, agent: str, text: str, *,
               kind: str = "info", level: str = "info", mission: Optional[str] = None,
               status: Optional[str] = None) -> None:
    key = (project_id, trace_id)
    ts = time.time() * 1000.0
    ev = {"ts": ts, "agent": agent, "text": text, "kind": kind, "level": level}
    WORKFLOW_EVENTS.setdefault(key, []).append(ev)
    if len(WORKFLOW_EVENTS[key]) > 2000:
        WORKFLOW_EVENTS[key] = WORKFLOW_EVENTS[key][-2000:]

    agents = WORKFLOW_AGENTS.setdefault(key, {})
    a = agents.setdefault(agent, {"name": agent, "status": "Idle", "mission": ""})
    if mission is not None:
        a["mission"] = mission
    if status is not None:
        a["status"] = status

    run_dir = os.path.join(RUNS_DIR, project_id, trace_id)
    os.makedirs(run_dir, exist_ok=True)
    path = os.path.join(run_dir, "workflow_events.jsonl")
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    except Exception:
        pass

def _load_events_from_disk(project_id: str, trace_id: str) -> None:
    key = (project_id, trace_id)
    if key in WORKFLOW_EVENTS and WORKFLOW_EVENTS[key]:
        return
    run_dir = os.path.join(RUNS_DIR, project_id, trace_id)
    path = os.path.join(run_dir, "workflow_events.jsonl")
    if not os.path.exists(path):
        return
    events: List[Dict[str, Any]] = []
    agents: Dict[str, Dict[str, Any]] = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                    events.append(ev)
                    ag = ev.get("agent")
                    if ag and ag not in agents:
                        agents[ag] = {"name": ag, "status": "Idle", "mission": ""}
                except Exception:
                    continue
    except Exception:
        return
    WORKFLOW_EVENTS[key] = events[-2000:]
    WORKFLOW_AGENTS[key] = agents

def _read_runtime_memory() -> Dict[str, Any]:
    try:
        with open(RUNTIME_MEMORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"version": "1.0.0", "projects": {}}

def _write_runtime_memory(mem: Dict[str, Any]) -> None:
    tmp = RUNTIME_MEMORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(mem, f, indent=2, ensure_ascii=False)
    os.replace(tmp, RUNTIME_MEMORY_PATH)

def _project_bucket(project_id: str) -> Dict[str, Any]:
    mem = _read_runtime_memory()
    projects = mem.setdefault("projects", {})
    bucket = projects.setdefault(project_id, {"runs": [], "notes": []})
    _write_runtime_memory(mem)
    return bucket

def _save_run_artifacts(project_id: str, trace_id: str, payload: Dict[str, Any]) -> str:
    run_dir = os.path.join(RUNS_DIR, project_id, trace_id)
    os.makedirs(run_dir, exist_ok=True)
    with open(os.path.join(run_dir, "run.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    return run_dir

def _try_parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None

def _post_run_compact(project_id: str, trace_id: str, goal: str, transcript: List[Dict[str, Any]], model_for_post: str) -> Dict[str, Any]:
    tail = transcript[-30:]
    architect_prompt = (
        "You are the Architect. Compress the run into strict JSON. "
        "No extra keys. No prose. If unknown, use null.\n\n"
        "Return JSON with keys: "
        "goal, decisions (array), files_touched (array), changes_summary, open_questions (array), next_steps (array), risks (array).\n\n"
        f"GOAL: {goal}"
    )
    architect_resp = mistral_post("/v1/chat/completions", {
        "model": model_for_post,
        "messages": [
            {"role": "system", "content": architect_prompt},
            {"role": "user", "content": json.dumps({"trace_id": trace_id, "transcript_tail": tail})}
        ],
        "temperature": 0.2,
    })
    architect_msg = (architect_resp.get("choices") or [{}])[0].get("message", {})
    architect_text = str(architect_msg.get("content", "")).strip()
    architect_json = _try_parse_json(architect_text) or {"error": "architect_parse_failed", "raw": architect_text[:5000]}

    notes_prompt = (
        "You are the Note-Taker. Write concise Markdown notes for future runs, but ONLY about: "
        "failures, wrong assumptions, blockers, regressions, repo landmines, and the minimal fixes that resolved them. "
        "No fluff. No success stories. Max 40 lines."
    )
    notes_resp = mistral_post("/v1/chat/completions", {
        "model": model_for_post,
        "messages": [
            {"role": "system", "content": notes_prompt},
            {"role": "user", "content": json.dumps({"goal": goal, "architect": architect_json})}
        ],
        "temperature": 0.2,
    })
    notes_msg = (notes_resp.get("choices") or [{}])[0].get("message", {})
    notes_md = str(notes_msg.get("content", "")).strip()

    meta_prompt = (
        "You are the Meta-Reviewer. Output strict JSON only. "
        "Keys: workflow_issues (array), prompt_improvements (array), tool_improvements (array), memory_improvements (array). "
        "No extra keys."
    )
    meta_resp = mistral_post("/v1/chat/completions", {
        "model": model_for_post,
        "messages": [
            {"role": "system", "content": meta_prompt},
            {"role": "user", "content": json.dumps({"goal": goal, "architect": architect_json, "notes": notes_md})}
        ],
        "temperature": 0.2,
    })
    meta_msg = (meta_resp.get("choices") or [{}])[0].get("message", {})
    meta_text = str(meta_msg.get("content", "")).strip()
    meta_json = _try_parse_json(meta_text) or {"error": "meta_parse_failed", "raw": meta_text[:5000]}

    run_dir = os.path.join(RUNS_DIR, project_id, trace_id)
    os.makedirs(run_dir, exist_ok=True)
    with open(os.path.join(run_dir, "architect_summary.json"), "w", encoding="utf-8") as f:
        json.dump(architect_json, f, indent=2, ensure_ascii=False)
    with open(os.path.join(run_dir, "notes.md"), "w", encoding="utf-8") as f:
        f.write(notes_md + "\n")
    with open(os.path.join(run_dir, "meta_review.json"), "w", encoding="utf-8") as f:
        json.dump(meta_json, f, indent=2, ensure_ascii=False)

    issues = []
    if isinstance(meta_json, dict):
        issues = meta_json.get("workflow_issues") or []
    had_issue = bool(issues) or (isinstance(architect_json, dict) and architect_json.get("error"))

    mem = _read_runtime_memory()
    projects = mem.setdefault("projects", {})
    bucket = projects.setdefault(project_id, {"bad_examples": []})
    if had_issue:
        bucket["bad_examples"].append({
            "trace_id": trace_id,
            "goal": goal,
            "architect": architect_json,
            "notes_md": notes_md,
            "meta": meta_json,
        })
        bucket["bad_examples"] = bucket["bad_examples"][-50:]
        _write_runtime_memory(mem)

    return {"architect": architect_json, "notes_md": notes_md, "meta": meta_json}

default_index = os.path.join(PREVIEW_DIR, "index.html")
if not os.path.exists(default_index):
    with open(default_index, "w", encoding="utf-8") as f:
        f.write("""<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preview</title>
<style>body{font-family:system-ui,Arial;padding:24px;background:#0b1220;color:#e8eefc}
.card{max-width:820px;background:rgba(255,255,255,0.06);padding:18px;border-radius:14px}
code{background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:6px}</style></head>
<body><div class="card">
<h1>Live Preview is ready ✅</h1>
<p>Ask the builder to create files in <code>preview/</code> (e.g. <code>preview/index.html</code>).</p>
<p>This iframe auto-refreshes after each run.</p>
</div></body></html>""")

app = FastAPI(title="Serious AI App Builder Backend (Preview + Chat + Agents)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/preview", StaticFiles(directory=PROJECTS_DIR, html=True), name="preview")

def _auth_headers() -> Dict[str, str]:
    if not MISTRAL_API_KEY:
        raise HTTPException(status_code=500, detail="MISTRAL_API_KEY is not set. Put it in .env and restart.")
    return {
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

def _safe_json(resp: requests.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return {"text": resp.text}

def mistral_get(path: str) -> Any:
    r = requests.get(f"{MISTRAL_BASE_URL}{path}", headers=_auth_headers(), timeout=60)
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail={"mistral_status": r.status_code, "mistral_body": _safe_json(r)})
    return r.json()

def mistral_post(path: str, payload: Dict[str, Any]) -> Any:
    r = requests.post(f"{MISTRAL_BASE_URL}{path}", headers=_auth_headers(), json=payload, timeout=120)
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail={"mistral_status": r.status_code, "mistral_body": _safe_json(r)})
    return r.json()

def _norm_filename(filename: str) -> str:
    filename = filename.replace("\\", "/").strip()
    if filename.startswith("/") or ".." in filename or filename == "":
        raise ValueError("Invalid filename (path traversal blocked).")
    return filename

def _write_allowed(project_id: str, filename: str) -> Tuple[bool, str]:
    perms = _get_project_permissions(project_id)
    if not perms.get("file_write", True):
        return False, "blocked: file_write permission is OFF"
    if filename.startswith("preview/"):
        return True, "ok"
    if not perms.get("self_modify", False):
        return False, "blocked: self_modify permission is OFF for non-preview writes"
    return True, "ok"

def tool_create_file(project_id: str, filename: str, content: str) -> Dict[str, Any]:
    filename = _norm_filename(filename)
    ok, reason = _write_allowed(project_id, filename)
    if not ok:
        return {"ok": False, "error": reason, "path": f"workspace/{filename}"}
    out_path = _resolve_path(project_id, filename)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)
    return {"ok": True, "path": f"workspace/{filename}", "bytes": len(content.encode("utf-8"))}

def tool_read_file(project_id: str, filename: str) -> Dict[str, Any]:
    filename = _norm_filename(filename)
    out_path = _resolve_path(project_id, filename)
    if not os.path.exists(out_path):
        return {"ok": False, "error": "File not found", "path": f"workspace/{filename}"}
    with open(out_path, "r", encoding="utf-8") as f:
        content = f.read()
    if len(content) > 200_000:
        content = content[:200_000] + "\n\n[TRUNCATED]"
    return {"ok": True, "path": f"workspace/{filename}", "content": content}

def tool_patch_file(project_id: str, filename: str, find: str, replace: str, count: int = 1) -> Dict[str, Any]:
    filename = _norm_filename(filename)
    ok, reason = _write_allowed(project_id, filename)
    if not ok:
        return {"ok": False, "error": reason, "path": f"workspace/{filename}"}
    out_path = _resolve_path(project_id, filename)
    if not os.path.exists(out_path):
        raise ValueError("File not found for patching.")
    with open(out_path, "r", encoding="utf-8") as f:
        content = f.read()
    if find not in content:
        return {"ok": False, "path": f"workspace/{filename}", "error": "Find-text not found; patch not applied."}
    new_content = content.replace(find, replace, count)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    return {"ok": True, "path": f"workspace/{filename}", "patched": True}

def tool_list_workspace(project_id: str) -> Dict[str, Any]:
    base = _project_root(project_id)
    files: List[str] = []
    for root_dir, _, fnames in os.walk(base):
        for fn in fnames:
            full = os.path.join(root_dir, fn)
            rel = os.path.relpath(full, base).replace('\\', '/')
            files.append(rel)
    files.sort()
    return {'ok': True, 'files': files}

def tool_describe_visuals(project_id: str, model: str) -> Dict[str, Any]:
    _emit_event(project_id, "describe_visuals", "Visualizer", "Analyzing UI code to describe visuals...", status="Working")
    try:
        html_path = _resolve_path(project_id, "preview/index.html")
        css_path = _resolve_path(project_id, "preview/styles.css")
        html_content = ""
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as f:
                html_content = f.read()
        css_content = ""
        if os.path.exists(css_path):
            with open(css_path, "r", encoding="utf-8") as f:
                css_content = f.read()
        
        if not html_content:
            return {"ok": True, "description": "The preview is empty. There is no HTML content."}

        visualizer_prompt = (
            "You are an expert front-end developer. Based on the following HTML and CSS, render the page in your mind and describe its visual appearance in plain English. "
            "Be detailed and literal. Describe the layout, colors, typography, spacing, and key elements. "
            "This description will be used by other agents to understand the current state of the UI."
        )
        
        resp = mistral_post("/v1/chat/completions", {
            "model": model,
            "messages": [
                {"role": "system", "content": visualizer_prompt},
                {"role": "user", "content": json.dumps({"html": html_content, "css": css_content})},
            ],
            "temperature": 0.1,
        })
        description = ((resp.get("choices") or [{}])[0].get("message") or {}).get("content", "")
        _emit_event(project_id, "describe_visuals", "Visualizer", "Visual description generated.", status="Done")
        return {"ok": True, "description": description}
    except Exception as e:
        return {"ok": False, "error": f"Failed to describe visuals: {str(e)}"}

def tool_web_search(query: str) -> str:
    """Performs a web search and returns the results."""
    # In a real implementation, this would call a search engine API.
    # For this example, we'll return a simulated result.
    return json.dumps({
        "ok": True,
        "results": [
            {
                "title": "Simulated Search Result",
                "url": "https://example.com",
                "snippet": "This is a simulated search result for your query."
            }
        ]
    })

TOOLS = [
    {"type": "function", "function": {
        "name": "create_file",
        "description": "Create/overwrite a file in workspace/. For UI use 'preview/index.html', 'preview/styles.css', etc.",
        "parameters": {"type": "object", "properties": {"filename": {"type": "string"}, "content": {"type": "string"}}, "required": ["filename", "content"]},
    }},
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Read a file from workspace/ (use before editing).",
        "parameters": {"type": "object", "properties": {"filename": {"type": "string"}}, "required": ["filename"]},
    }},
    {"type": "function", "function": {
        "name": "patch_file",
        "description": "Patch an existing file by replacing a matching text snippet (string replace). Use read_file first.",
        "parameters": {
            "type": "object",
            "properties": {
                "filename": {"type": "string"},
                "find": {"type": "string"},
                "replace": {"type": "string"},
                "count": {"type": "integer", "default": 1}
            },
            "required": ["filename", "find", "replace"]
        },
    }},
    {"type": "function", "function": {
        "name": "list_workspace",
        "description": "List all files in workspace/.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "describe_visuals",
        "description": "CRITICAL: To 'see' the current UI, call this tool. It analyzes HTML/CSS and returns a detailed text description of the visual appearance.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "delete_file",
        "description": "Deletes a file from the workspace.",
        "parameters": {"type": "object", "properties": {"filename": {"type": "string"}}, "required": ["filename"]},
    }},
    {"type": "function", "function": {
        "name": "web_search",
        "description": "Performs a web search and returns the results.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    }},
]

def tool_delete_file(project_id: str, filename: str) -> Dict[str, Any]:
    filename = _norm_filename(filename)
    ok, reason = _write_allowed(project_id, filename)
    if not ok:
        return {"ok": False, "error": reason, "path": f"workspace/{filename}"}
    out_path = _resolve_path(project_id, filename)
    if not os.path.exists(out_path):
        return {"ok": False, "error": "File not found", "path": f"workspace/{filename}"}
    os.remove(out_path)
    return {"ok": True, "path": f"workspace/{filename}"}

def run_tool(project_id: str, model: str, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if tool_name == "create_file":
        return tool_create_file(project_id=project_id, filename=args["filename"], content=args["content"])
    if tool_name == "read_file":
        return tool_read_file(project_id=project_id, filename=args["filename"])
    if tool_name == "patch_file":
        return tool_patch_file(project_id=project_id, filename=args["filename"], find=args["find"], replace=args["replace"], count=int(args.get("count", 1)))
    if tool_name == "list_workspace":
        return tool_list_workspace(project_id=project_id)
    if tool_name == "describe_visuals":
        return tool_describe_visuals(project_id=project_id, model=model)
    if tool_name == "delete_file":
        return tool_delete_file(project_id=project_id, filename=args["filename"])
    raise ValueError(f"Unknown tool: {tool_name}")

class WriteRequest(BaseModel):
    project_id: str = "default"
    path: str
    content: str

class PatchRequest(BaseModel):
    project_id: str = "default"
    path: str
    find: str
    replace: str
    count: int = 1

class DeleteRequest(BaseModel):
    project_id: str = "default"
    path: str

class WorkflowRequest(BaseModel):
    model: str
    goal: str
    project_id: str = "default"
    reasoning_model: str = ""
    enable_postprocess: bool = True
    max_steps: int = Field(10, ge=1, le=25)
    permissions: Dict[str, Any] = Field(default_factory=dict)

class PermissionsRequest(BaseModel):
    project_id: str = "default"
    permissions: Dict[str, Any] = Field(default_factory=dict)

def _is_user_confirmation(model: str, user_message: str, chat_history: List[Dict[str, Any]]) -> Tuple[str, float]:
    context = chat_history[-4:] + [{"role": "user", "content": user_message}]
    try:
        gate = mistral_post("/v1/chat/completions", {
            "model": model,
            "messages": [
                {"role": "system", "content": "Classify user response as 'approve', 'reject', or 'other'. Return JSON: {\"decision\": \"approve|reject|other\", \"confidence\": 0.0-1.0}"},
                {"role": "user", "content": json.dumps({"conversation": context})},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
        })
        msg = ((gate.get("choices") or [{}])[0].get("message") or {})
        raw = str(msg.get("content", "")).strip()
        data = json.loads(raw)
        decision = str(data.get("decision", "other")).lower()
        confidence = float(data.get("confidence", 0.5))
        if decision not in ["approve", "reject"]:
            return "other", confidence
        return decision, confidence
    except Exception:
        txt = user_message.lower().strip()
        if txt in ["yes", "ok", "y", "tak", "do it", "go", "start", "proceed"]:
            return "approve", 0.9
        if txt in ["no", "n", "stop", "cancel", "nie"]:
            return "reject", 0.9
        return "other", 0.5

class OrchestrateRequest(BaseModel):
    model: str
    messages: List[Dict[str, Any]]
    project_id: str = "default"
    reasoning_model: str = ""
    enable_postprocess: bool = True
    max_steps: int = Field(10, ge=1, le=25)
    permissions: Dict[str, Any] = Field(default_factory=dict)
    parallel_tool_calls: bool = True

class AgentCreateRequest(BaseModel):
    name: str
    model: str
    instructions: str = ""
    description: str = ""

class AgentCompleteRequest(BaseModel):
    agent_id: str
    messages: List[Dict[str, Any]]
    parallel_tool_calls: bool = True

@app.get("/health")
def health(project_id: str = "default"):
    return {"ok": True, "preview_url": f"/preview/{project_id}/preview/", "workspace_dir": "backend/workspace/projects"}

@app.get("/api/models")
def list_models():
    return mistral_get("/v1/models")

@app.get("/api/system/maps")
def system_maps():
    return {
        "system_map": _load_system_json("system_map.json"),
        "agents_registry": _load_system_json("agents_registry.json"),
        "capabilities": _load_system_json("capabilities.json"),
        "permissions": _load_system_json("permissions.json"),
        "ui_map": _load_system_json("ui_map.json"),
        "health_checks": _load_system_json("health_checks.json"),
        "runtime_memory": _read_runtime_memory(),
    }

@app.get("/api/permissions")
def get_permissions(project_id: str = "default"):
    return {"ok": True, "project_id": project_id, "permissions": _get_project_permissions(project_id)}

@app.post("/api/permissions")
def update_permissions(req: PermissionsRequest):
    updated = _set_project_permissions(req.project_id, req.permissions)
    return {"ok": True, "project_id": req.project_id, "permissions": updated}

@app.get("/api/projects")
def api_list_projects():
    mem = _read_runtime_memory()
    projects = sorted(list(mem.get("projects", {}).keys()))
    if "default" not in projects:
        projects.insert(0, "default")
    for pid in projects:
        _ensure_project_dirs(pid)
    return {"ok": True, "projects": projects}

class ProjectCreateRequest(BaseModel):
    name: str = ""

@app.post("/api/projects")
def api_create_project(req: ProjectCreateRequest):
    pid = (req.name or "").strip().lower().replace(" ", "-")
    if not pid:
        pid = f"proj_{uuid.uuid4().hex[:8]}"
    root = os.path.join(PROJECTS_DIR, pid)
    if os.path.exists(root):
        pid = f"{pid}_{uuid.uuid4().hex[:4]}"
    _ensure_project_dirs(pid)
    _get_project_permissions(pid)
    return {"ok": True, "project_id": pid}

@app.get("/api/workspace/list")
def api_workspace_list(project_id: str = "default"):
    return tool_list_workspace(project_id=project_id)

@app.get("/api/workspace/read")
def api_workspace_read(project_id: str = "default", path: str = ""):
    if not path:
        return {"ok": False, "error": "path_required"}
    return tool_read_file(project_id, path)

@app.post("/api/workspace/write")
def api_workspace_write(req: WriteRequest):
    return tool_create_file(req.project_id, req.path, req.content)

@app.post("/api/workspace/patch")
def api_workspace_patch(req: PatchRequest):
    return tool_patch_file(req.project_id, req.path, req.find, req.replace, req.count)

@app.delete("/api/workspace/delete")
def api_workspace_delete(req: DeleteRequest):
    return tool_delete_file(req.project_id, req.path)


@app.get("/api/workflow/agents")
def api_workflow_agents(project_id: str = "default", trace_id: str = ""):
    if not trace_id:
        return {"ok": True, "project_id": project_id, "trace_id": "", "agents": []}
    _load_events_from_disk(project_id, trace_id)
    key = (project_id, trace_id)
    agents = list((WORKFLOW_AGENTS.get(key) or {}).values())
    agents.sort(key=lambda x: x.get("name", ""))
    return {"ok": True, "project_id": project_id, "trace_id": trace_id, "agents": agents}

@app.get("/api/workflow/events")
def api_workflow_events(project_id: str = "default", trace_id: str = ""):
    if not trace_id:
        return {"ok": True, "project_id": project_id, "trace_id": "", "events_by_agent": {}}
    _load_events_from_disk(project_id, trace_id)
    key = (project_id, trace_id)
    events = WORKFLOW_EVENTS.get(key) or []
    by: Dict[str, List[Dict[str, Any]]] = {}
    for ev in events:
        ag = ev.get("agent") or "Unknown"
        by.setdefault(ag, []).append({
            "ts": ev.get("ts"),
            "kind": ev.get("kind", "info"),
            "level": ev.get("level", "info"),
            "text": ev.get("text", "")
        })
    return {"ok": True, "project_id": project_id, "trace_id": trace_id, "events_by_agent": by}

@app.get("/api/runs")
def list_runs(project_id: str = "default"):
    base = os.path.join(RUNS_DIR, project_id)
    if not os.path.exists(base):
        return {"ok": True, "project_id": project_id, "runs": []}
    runs = []
    for trace_id in sorted(os.listdir(base)):
        run_dir = os.path.join(base, trace_id)
        if os.path.isdir(run_dir):
            runs.append(trace_id)
    runs = runs[-100:]
    return {"ok": True, "project_id": project_id, "runs": runs}

@app.get("/api/runs/{project_id}/{trace_id}")
def read_run(project_id: str, trace_id: str):
    run_dir = os.path.join(RUNS_DIR, project_id, trace_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Run not found")

    def read_if_exists(name: str):
        p = os.path.join(run_dir, name)
        if not os.path.exists(p):
            return None
        if name.endswith(".json"):
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        with open(p, "r", encoding="utf-8") as f:
            return f.read()

    return {
        "ok": True,
        "project_id": project_id,
        "trace_id": trace_id,
        "run": read_if_exists("run.json"),
        "architect_summary": read_if_exists("architect_summary.json"),
        "notes": read_if_exists("notes.md"),
        "meta_review": read_if_exists("meta_review.json"),
    }

SYSTEM_RULES = (
    "You are an ELITE web developer. Your standards are EXTREMELY HIGH.\n"
    "CRITICAL RULES:\n"
    "1) MODERN DESIGN ONLY: Use contemporary aesthetics - gradients, shadows, animations, glassmorphism\n"
    "2) RESPONSIVE FIRST: NEVER use fixed pixel widths on main containers. Use %, vw, vh, flexbox, grid\n"
    "3) PROFESSIONAL QUALITY: Every site must look like a $50k+ production website\n"
    "4) VISUAL POLISH: Smooth transitions, hover effects, proper spacing, beautiful typography\n"
    "5) For UI work, ALWAYS create both preview/index.html AND preview/styles.css\n"
    "6) Think like a senior designer at Apple, Stripe, or Vercel - that's your baseline\n"
    "7) Use the web_search tool to research new technologies and find solutions to problems.\n"
) + "\n" + _system_context_snippet()

def _generate_execution_plan(model: str, goal: str, project_id: str) -> Dict[str, Any]:
    workspace = tool_list_workspace(project_id)

    # Context to include in prompt
    workspace_info = json.dumps(workspace.get('files', []), indent=2)

    # System prompt with more details
    planner_prompt = f"""You are a Strategic Planner for an elite web development team.

GOAL: {goal}

Current workspace files:
{workspace_info}

INSTRUCTIONS:
1. If the user requests a website, generate a plan that includes HTML, CSS, and JavaScript as needed
2. Use modern frameworks and design patterns
3. Consider responsive design and accessibility
4. Create a detailed plan with specific file paths and code requirements

GENERATE a DETAILED, ACTIONABLE execution plan in STRICT JSON format:
{{
"steps": ["Create HTML structure with semantic elements", "Add responsive CSS", "Implement interactivity if needed"],
"files_to_modify": ["path/to/file1"],
"files_to_create": ["path/to/file2"],
"technical_requirements": {{
"frameworks": ["HTML5", "CSS3"],
"design_systems": "Modern responsive design",
"accessibility": "WCAG 2.1 AA"
}},
"estimated_steps": 3,
"quality_requirements": ["Responsive design", "Modern aesthetics", "Accessible markup"],
"success_criteria": ["Downloads and runs locally without errors", "Displays correctly on mobile and desktop"]
}}

Be EXTREMELY SPECIFIC about file paths and content.
Keep all your response in valid JSON format."""

    resp = mistral_post("/v1/chat/completions", {
        "model": model,
        "messages": [
            {"role": "system", "content": planner_prompt},
            {"role": "user", "content": f"Please plan how to achieve: {goal}"}  # Restating goal for clarity
        ],
        "temperature": 0.1,  # Lower for more deterministic output
        "response_format": {"type": "json_object"},
    })

    content = ((resp.get("choices") or [{}])[0].get("message") or {}).get("content", "{}")

    # Back-up plan if parsing fails
    return _try_parse_json(content) or {
        "steps": ["Plan generation failed, will proceed with direct execution"],
        "files_to_create": ["preview/index.html", "preview/styles.css"],
        "estimated_steps": 5,
    }

@app.post("/api/workflow")
def workflow(req: WorkflowRequest):
    trace_id = str(uuid.uuid4())
    _save_state(req.project_id, OrchestratorState(pending_execution=False))

    # Get up to date project permissions and workspace state
    perms = _get_project_permissions(req.project_id)
    workspace_contents = tool_list_workspace(req.project_id)
    
    _emit_event(req.project_id, trace_id, "Architect", f"New project: {req.goal}", status="Planning")
    
    # Define the refined architecture process
    analysis_instructions = f"""
    You're an Advanced Project Architect. Please analyze this user request and provide an improved execution plan.

    User request: {req.goal}

    Current workspace contains: {', '.join(workspace_contents.get('files', [])[:5])}
    {len(workspace_contents.get('files', [])) > 5 and f'(and {len(workspace_contents.get("files", [])) - 5} more files)' or ''}

    Design requirements to satisfy:
    1. Modern, professional aesthetic
    2. Fully responsive (mobiledesktop)
    3. Clean, productionready code
    4. Semantic HTML5
    5. Modern CSS techniques

    Generate a comprehensive implementation plan in JSON format:
    {{
        "files": [{"name": "path/to/file.html", "purpose": "Description"}],
        "steps": ["Detailed implementation steps"],
        "tech_stack": ["HTML5", "CSS3", "JavaScript"],
        "dependencies": ["List any dependencies here"]
    }}
    """

    try:
        # Request detailed implementation plan from model
        improve_resp = mistral_post("/v1/chat/completions", {
            "model": req.model,
            "messages": [
                {"role": "system", "content": SYSTEM_RULES},
                {"role": "system", "content": analysis_instructions},
                {"role": "user", "content": f"Enhance this plan: {req.goal}"}
            ],
            "temperature": 0.3,
            "response_format": {"type": "json_object"}
        })

        improve_msg = ((improve_resp.get("choices") or [{}])[0].get("message") or {})
        improve_text = str(improve_msg.get("content", "")).strip()
        improved_plan = _try_parse_json(improve_text) or {}
        
        # Enhanced execution context
        enhanced_context = f"""
        CORE SYSTEM RULES:
        {SYSTEM_RULES}

        IMPROVED PLAN:
        Goal: {req.goal}
        Files: {json.dumps(improved_plan.get('files', []), indent=2)}
        Steps: {json.dumps(improved_plan.get('steps', []), indent=2)}

        Now execute with exceedingly high quality - this will be used in production.
        """
    except Exception as e:
        improved_plan = {}
        enhanced_context = f"""CORE SYSTEM RULES: {SYSTEM_RULES}
        Goal: {req.goal}
        Note: Plan enhancement failed: {str(e)}"""

    transcript = [
        {"role": "system", "content": enhanced_context},
        {"role": "user", "content": f"Implement project with ELITE standards: {req.goal}. Use plan: {improved_plan or 'default website plan'}. Create infrequently preview/ folder."},
    ]

    project_complete = False

    for step in range(req.max_steps):
        response = mistral_post("/v1/chat/completions", {
            "model": req.model,
            "messages": transcript,
            "tools": TOOLS,
            "tool_choice": "auto",
            "parallel_tool_calls": True,
        })

        msg = (response.get("choices") or [{}])[0].get("message", {})
        transcript.append(msg)

        tool_calls = msg.get("tool_calls") or []
        _emit_event(req.project_id, trace_id, "Executor", f"Workflow step {step+1}/{req.max_steps}")

        if not tool_calls:
            # Finalize project if no more tool calls
            project_complete = True
            current_files = tool_list_workspace(req.project_id)
            _emit_event(req.project_id, trace_id, "Architect", f"Project complete! Created {len(current_files.get('files', []))} files", status="Success")
            break

        results = []
        for tc in tool_calls:
            try:
                result = run_tool(req.project_id, req.model, tc['function']['name'], tc['function']['arguments'])
                results.append({
                    "tool_call_id": tc['id'],
                    "result": result
                })
            except Exception as e:
                results.append({
                    "tool_call_id": tc['id'],
                    "result": {"ok": False, "error": str(e)}
                })

        for result in results:
            transcript.append({
                "role": "tool",
                "tool_call_id": result['tool_call_id'],
                "content": json.dumps(result['result'])
            })

    # Update project state and return final result
    updated_files = tool_list_workspace(req.project_id)
    payload = {
        "ok": True,
        "trace_id": trace_id,
        "project_id": req.project_id,
        "status": "complete" if project_complete else "interrupted",
        "walkthrough": f"/preview/{req.project_id}/preview",
        "files": updated_files.get('files', []),
        "used_steps": step + 1,
        "improved_plan": improved_plan,
        "state": "ready"
    }

    return payload

@app.post("/api/orchestrate")
async def orchestrate(req: OrchestrateRequest):
    """Improved orchestration with better intent classification and workflow execution."""
    state = _load_state(req.project_id)
    tail = list(req.messages)
    last_user_message = tail[-1]["content"] if tail else ""
    
    # 1. Check if awaiting user confirmation for a plan
    if state.pending_execution:
        decision, conf = _is_user_confirmation(req.model, last_user_message, tail[:-1])
        
        if decision == "approve":
            state.pending_execution = False
            _save_state(req.project_id, state)
        
            wf_req = WorkflowRequest(
                model=req.model,
                goal=state.proposed_goal or "Execute approved plan",
                project_id=req.project_id,
                reasoning_model=req.reasoning_model,
                enable_postprocess=req.enable_postprocess,
                max_steps=req.max_steps,
                permissions=req.permissions,
            )
            
            result = await anyio.to_thread.run_sync(workflow, wf_req)
            
            return {
                "ok": True,
                "mode": "workflow_executed",
                "reply": f"✓ Workflow completed successfully!, {result.get('preview_url')}",
                "trace_id": result.get("trace_id"),
                "result": result,
                "pending_execution": False,
            }
    
        elif decision == "reject":
            state.pending_execution = False
            _save_state(req.project_id, state)
            return {
                "ok": True,
                "mode": "chat",
                "reply": "Plan cancelled. What would you like to build instead?",
                "pending_execution": False,
            }
    
        else:
            return {
                "ok": True,
                "mode": "awaiting_approval",
                "reply": "Please confirm: 'yes' to start, 'no' to cancel.",
                "pending_execution": True,
            }
        
    # 2. Improved intent classification with more context
    intent_prompt = f"""Analyze the user's request and classify it with confidence.
    
User message: '{last_user_message}'
Recent history: {json.dumps(tail[-5:], default=str)}

Classification:
1. 'workflow' - When the user wants to CREATE/BUILD/FIX something concrete (websites, apps, features)
2. 'chat' - When the user wants to DISCUSS/ASK QUERY/GET ADVICE

Respond in strict JSON format:
{{
"mode": "workflow" | "chat",
"goal": "a clear, specific description of what to build",
"confidence": 0.0-1.0, # How certain you are about this classification
"reasoning": "why you chose this mode"
}}

If you find any of these terms in the user's message, classify as 'workflow':
- create
- build
- make
- generate
- setup
- develop
- modify
- fix
- update
- change
- add
- remove
- implement

Examples:
1. User: "Create a website for a restaurant" → Workflow - create website for restaurant
2. User: "Why isn't my code working?" → Chat - debugging question
3. User: "Build me a React app with a login form" → Workflow - build React app with login form
4. User: "What frameworks should I use?" → Chat - architectural advice

Look for direct construction verbs plus objects (e.g., 'build X', 'create Y').
If uncertain, choose 'chat'."""
    
    try:
        # Get intent classification
        gate = mistral_post("/v1/chat/completions", {
            "model": req.model,
            "messages": [
                {"role": "system", "content": intent_prompt},
                {"role": "user", "content": "Classify the following user input"}
            ],
            "temperature": 0.2,  # Slightly higher for more nuanced classification
            "response_format": {"type": "json_object"},
        })
        
        msg = ((gate.get("choices") or [{}])[0].get("message") or {})
        raw = str(msg.get("content", "")).strip()
        data = _try_parse_json(raw) or {}
        mode = str(data.get("mode", "chat")).lower()
        goal = data.get("goal")
        confidence = float(data.get("confidence", 0.5))
        
        # Don't use workflow if confidence is too low
        if mode == "workflow" and confidence < 0.7:
            mode = "chat"
    
    except Exception as e:
        print(f"Error in intent classification: {str(e)}")
        # Fallback to chat mode
        mode = "chat"
        goal = None
        confidence = 0.5
    
    # 3. If workflow mode, generate a detailed execution plan
    if mode == "workflow" and goal:
        goal_text = str(goal or last_user_message).strip()
        
        # Generate a more detailed plan with specific instructions
        plan = _generate_execution_plan(req.model, goal_text, req.project_id)
        
        # Log the proposed plan and save state
        state.pending_execution = True
        state.proposed_goal = goal_text
        state.proposed_plan = plan
        _save_state(req.project_id, state)
        
        # Create a more detailed explanation of the plan
        steps_list = plan.get('steps', [])[:8]
        files_list = plan.get('files_to_create', [])
        reqs = plan.get('quality_requirements', [])

        response_text = f"""📋 Prepared a detailed plan for your request:

**Your goal:** {goal_text}
**Execution Plan:**
""" + "\n".join(f"{i+1}. {step}" for i, step in enumerate(steps_list)) + """

**Files to create:**
""" + "\n".join(f"→ {f}" for f in files_list) + """

**Quality requirements:**
""" + "\n".join(f"- {r}" for r in reqs) + """

This will create a production-ready implementation. Start execution? (yes/no)"""
        
        return {
            "ok": True,
            "mode": "plan_proposed",
            "reply": response_text,
            "pending_execution": True,
            "plan": plan,
            "goal_text": goal_text,  # Include both the refined goal and original
            "original_input": last_user_message
        }
    
    # 4. Chat mode - simple Q&A
    chat_resp = mistral_post("/v1/chat/completions", {
        "model": req.model,
        "messages": tail,
        "temperature": 0.7,
    })
    reply = ((chat_resp.get("choices") or [{}])[0].get("message") or {}).get("content",
            "I'm ready to help you build something! What would you like to create?")

    # Fallback response if anything goes wrong
    return {
        "ok": True,
        "mode": "chat",
        "reply": reply,
        "pending_execution": False,
        "goal_detection": {
            "mode": mode,
            "goal": goal,
            "confidence": confidence
        }
    }

@app.post("/api/agents/create")
def agents_create(req: AgentCreateRequest):
    return mistral_post("/v1/agents", {
        "name": req.name,
        "model": req.model,
        "instructions": req.instructions + "\n\n" + SYSTEM_RULES,
        "description": req.description,
        "tools": TOOLS,
        "completion_args": {"tool_choice": "auto", "parallel_tool_calls": True},
    })

@app.post("/api/agents/complete")
def agents_complete(req: AgentCompleteRequest):
    return mistral_post("/v1/agents/completions", {
        "agent_id": req.agent_id,
        "messages": req.messages,
        "tools": TOOLS,
        "tool_choice": "auto",
        "parallel_tool_calls": req.parallel_tool_calls,
    })