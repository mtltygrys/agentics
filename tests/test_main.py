import pytest
from httpx import AsyncClient
from fastapi.testclient import TestClient
from main import app, _ensure_project_dirs, _get_project_permissions
import os
import json

# Use the TestClient for synchronous tests if needed, but AsyncClient is preferred for async endpoints.
client = TestClient(app)

# Fixture to ensure a clean state for each test
@pytest.fixture(autouse=True)
def setup_teardown():
    # Setup: ensure default project exists
    _ensure_project_dirs("default")
    _get_project_permissions("default")
    yield
    # Teardown: can clean up created files if necessary

@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] == True
    assert "preview_url" in response.json()

@pytest.mark.asyncio
async def test_list_projects():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        response = await ac.get("/api/projects")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] == True
    assert "default" in data["projects"]

@pytest.mark.asyncio
async def test_create_project():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        response = await ac.post("/api/projects", json={"name": "test-project-1"})
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] == True
    assert "project_id" in data
    assert data["project_id"].startswith("test-project-1")

    # Verify it's in the list now
    async with AsyncClient(app=app, base_url="http://test") as ac:
        response = await ac.get("/api/projects")
    assert "test-project-1" in response.json()["projects"]

def test_get_permissions():
    response = client.get("/api/permissions?project_id=default")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["project_id"] == "default"
    assert "permissions" in data
    assert data["permissions"]["file_write"] is True # Default

def test_update_permissions():
    # First, update permissions
    response = client.post(
        "/api/permissions",
        json={"project_id": "default", "permissions": {"shell": True, "web": True}}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["permissions"]["shell"] is True
    assert data["permissions"]["web"] is True

    # Then, get them to verify
    response = client.get("/api/permissions?project_id=default")
    data = response.json()
    assert data["permissions"]["shell"] is True
    assert data["permissions"]["web"] is True

    # Reset for other tests
    client.post(
        "/api/permissions",
        json={"project_id": "default", "permissions": {"shell": False, "web": False}}
    )

@pytest.mark.asyncio
async def test_workspace_list():
    # First create a file to ensure the list is not empty
    test_file_path = "test_file.txt"
    test_content = "Hello, World!"
    async with AsyncClient(app=app, base_url="http://test") as ac:
        await ac.post("/api/workspace/write", json={"project_id": "default", "path": test_file_path, "content": test_content})

    async with AsyncClient(app=app, base_url="http://test") as ac:
        response = await ac.get("/api/workspace/list?project_id=default")

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert "files" in data
    assert "test_file.txt" in data["files"]

@pytest.mark.asyncio
async def test_workspace_read_write():
    test_file_path = "test_read_write.txt"
    test_content = "This is a test file for reading and writing."

    # Write the file
    async with AsyncClient(app=app, base_url="http://test") as ac:
        write_response = await ac.post(
            "/api/workspace/write",
            json={"project_id": "default", "path": test_file_path, "content": test_content}
        )
    assert write_response.status_code == 200
    assert write_response.json()["ok"] is True

    # Now read it back
    async with AsyncClient(app=app, base_url="http://test") as ac:
        read_response = await ac.get(f"/api/workspace/read?project_id=default&path={test_file_path}")
    
    assert read_response.status_code == 200
    read_data = read_response.json()
    assert read_data["ok"] is True
    assert read_data["content"] == test_content

@pytest.mark.asyncio
async def test_workspace_patch():
    test_file_path = "test_patch.txt"
    test_content = "This is the original content."
    find_text = "original"
    replace_text = "patched"

    # Write initial file
    async with AsyncClient(app=app, base_url="http://test") as ac:
        await ac.post("/api/workspace/write", json={"project_id": "default", "path": test_file_path, "content": test_content})

    # Patch the file
    async with AsyncClient(app=app, base_url="http://test") as ac:
        patch_response = await ac.post("/api/workspace/patch", json={"project_id": "default", "path": test_file_path, "find": find_text, "replace": replace_text})
    
    assert patch_response.status_code == 200
    assert patch_response.json()["ok"] is True

    # Read to verify
    async with AsyncClient(app=app, base_url="http://test") as ac:
        read_response = await ac.get(f"/api/workspace/read?project_id=default&path={test_file_path}")
    
    assert read_response.json()["content"] == f"This is the {replace_text} content."

@pytest.mark.asyncio
async def test_workspace_delete():
    test_file_path = "test_delete.txt"
    test_content = "This file is to be deleted."

    # Write the file
    async with AsyncClient(app=app, base_url="http://test") as ac:
        await ac.post("/api/workspace/write", json={"project_id": "default", "path": test_file_path, "content": test_content})

    # Delete the file
    async with AsyncClient(app=app, base_url="http://test") as ac:
        delete_response = await ac.delete("/api/workspace/delete", json={"project_id": "default", "path": test_file_path})

    assert delete_response.status_code == 200
    assert delete_response.json()["ok"] is True

    # Try to read it, should fail
    async with AsyncClient(app=app, base_url="http://test") as ac:
        read_response = await ac.get(f"/api/workspace/read?project_id=default&path={test_file_path}")
    
    assert read_response.status_code == 200 # The endpoint returns 200 even on failure
    assert read_response.json()["ok"] is False
    assert "File not found" in read_response.json()["error"]

