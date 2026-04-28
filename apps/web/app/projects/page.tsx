"use client";

import { Building2, KeyRound, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiJson, authHeaders, Project, readProjectId, readSession, saveProjectId, User } from "../client";

type ProjectList = { data: Project[] };
type ProjectResult = { data: Project };
type AccessKeyResult = { data: { project_id: string; access_key: string } };

export default function ProjectsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectName, setProjectName] = useState("A현장");
  const [projectCode, setProjectCode] = useState("site-a");
  const [joinCode, setJoinCode] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [status, setStatus] = useState("로그인 후 프로젝트를 선택하거나 접근키로 참여하세요.");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    setUser(session.user);
    setSelectedProjectId(readProjectId());
    void loadProjects(session.token);
  }, []);

  async function loadProjects(nextToken = token) {
    if (!nextToken) {
      setStatus("먼저 로그인하세요.");
      return;
    }
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const stored = readProjectId();
    const fallback = json.data[0]?.id ?? "";
    const nextProjectId = json.data.some((project) => project.id === stored) ? stored : fallback;
    setSelectedProjectId(nextProjectId);
    if (nextProjectId) saveProjectId(nextProjectId);
    setStatus(`${json.data.length}개 프로젝트를 불러왔습니다.`);
  }

  async function createProject() {
    const json = await apiJson<ProjectResult>("/projects", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName, code: projectCode })
    });
    saveProjectId(json.data.id);
    setSelectedProjectId(json.data.id);
    setStatus(`${json.data.name} 프로젝트를 만들었습니다.`);
    await loadProjects();
  }

  async function joinProject() {
    const json = await apiJson<ProjectResult>("/projects/join", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ project_code: joinCode, access_key: joinKey })
    });
    saveProjectId(json.data.id);
    setSelectedProjectId(json.data.id);
    setStatus(`${json.data.name} 프로젝트에 참여했습니다.`);
    await loadProjects();
  }

  async function createAccessKey() {
    if (!selectedProjectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    const json = await apiJson<AccessKeyResult>(`/projects/${selectedProjectId}/access-key`, {
      method: "POST",
      headers: authHeaders(token)
    });
    setGeneratedKey(json.data.access_key);
    setStatus("새 프로젝트 접근키를 생성했습니다. 이 값은 지금만 표시됩니다.");
  }

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    saveProjectId(projectId);
    setStatus("프로젝트 선택을 저장했습니다.");
  }

  if (!token) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">회사/프로젝트 범위 검증을 위해 먼저 로그인해야 합니다.</p>
        <a className="button" href="/login">
          로그인으로 이동
        </a>
      </section>
    );
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return (
    <>
      <div className="breadcrumb">
        <span>{user?.name ?? "User"}</span>
        <span>/</span>
        <strong>Projects</strong>
      </div>

      <section className="project-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h1 className="page-title">프로젝트 선택</h1>
              <p className="muted">사진, Room, Revit Add-in은 모두 선택된 프로젝트 범위에서 동작합니다.</p>
            </div>
            <button className="icon-button" onClick={() => loadProjects().catch((err) => setStatus(err.message))} type="button">
              <RefreshCw size={17} />
            </button>
          </div>

          <div className="project-list">
            {projects.map((project) => (
              <button
                className={`project-row ${project.id === selectedProjectId ? "active" : ""}`}
                key={project.id}
                onClick={() => selectProject(project.id)}
                type="button"
              >
                <Building2 size={18} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.code}</small>
                </span>
                <em>{project.member_role ?? user?.role}</em>
              </button>
            ))}
          </div>
          <p className="muted">{status}</p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">프로젝트 생성</h2>
            <span className="badge blue">Admin</span>
          </div>
          <div className="form-grid">
            <Field label="Project Name">
              <input className="input" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </Field>
            <Field label="Project Code">
              <input className="input" value={projectCode} onChange={(event) => setProjectCode(event.target.value)} />
            </Field>
          </div>
          <button className="button" onClick={() => createProject().catch((err) => setStatus(err.message))} type="button">
            <Plus size={16} /> 프로젝트 생성
          </button>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">접근키 참여</h2>
            <span className="badge green">Worker</span>
          </div>
          <div className="form-grid">
            <Field label="Project Code">
              <input className="input" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} />
            </Field>
            <Field label="Access Key">
              <input className="input" value={joinKey} onChange={(event) => setJoinKey(event.target.value)} />
            </Field>
          </div>
          <button className="button secondary" onClick={() => joinProject().catch((err) => setStatus(err.message))} type="button">
            <KeyRound size={16} /> 프로젝트 참여
          </button>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">프로젝트 접근키</h2>
            <span className="badge orange">상위 관리자</span>
          </div>
          <p className="muted">
            {selectedProject ? `${selectedProject.name} (${selectedProject.code})` : "선택된 프로젝트가 없습니다."}
          </p>
          <button className="button" onClick={() => createAccessKey().catch((err) => setStatus(err.message))} type="button">
            <KeyRound size={16} /> 접근키 생성
          </button>
          {generatedKey ? <code className="key-box">{generatedKey}</code> : null}
        </div>
      </section>

      <div className="actions">
        <a className="button" href="/rooms">
          Room 매핑 보기
        </a>
        <a className="button secondary" href="/photos">
          사진 업로드로 이동
        </a>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
