"use client";

import {
  Building2,
  Eye,
  FolderPlus,
  Image as ImageIcon,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiJson, authHeaders, isUpperManager, Project, readProjectId, readSession, saveProjectId, User } from "../client";

type ProjectList = { data: Project[] };
type ProjectResult = { data: Project };
type AccessKeyResult = { data: { project_id: string; access_key: string } };
type CreateProjectBody = { name: string; code?: string };

export default function ProjectsPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectCode, setNewProjectCode] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [status, setStatus] = useState("로그인 후 우리 회사 프로젝트를 불러오세요.");

  const canManageProjects = isUpperManager(user);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects]
  );

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    setUser(session.user);
    setActiveProjectId(readProjectId());
    void loadProjects(session.token);
  }, []);

  async function loadProjects(nextToken = token, preferredProjectId = readProjectId()) {
    if (!nextToken) {
      setStatus("먼저 로그인하세요.");
      return;
    }

    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);

    const fallbackProjectId = json.data[0]?.id ?? "";
    const nextProjectId = json.data.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : fallbackProjectId;

    setActiveProjectId(nextProjectId);
    if (nextProjectId) saveProjectId(nextProjectId);
    setStatus(`${json.data.length}개 프로젝트를 불러왔습니다.`);
  }

  async function createProject() {
    const name = newProjectName.trim();
    const code = newProjectCode.trim();

    if (!name) {
      setStatus("프로젝트 이름을 입력하세요.");
      return;
    }

    const body: CreateProjectBody = code ? { name, code } : { name };
    const json = await apiJson<ProjectResult>("/projects", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    setNewProjectName("");
    setNewProjectCode("");
    setGeneratedKey("");
    saveProjectId(json.data.id);
    setActiveProjectId(json.data.id);
    setStatus(`${json.data.name} 프로젝트를 생성했습니다. Revit Add-in에서 이 프로젝트를 선택해 동기화하세요.`);
    await loadProjects(token, json.data.id);
  }

  async function joinProject() {
    const trimmedCode = joinCode.trim();
    const trimmedKey = joinKey.trim();

    if (!trimmedCode || !trimmedKey) {
      setStatus("프로젝트 코드와 접근키를 입력하세요.");
      return;
    }

    const json = await apiJson<ProjectResult>("/projects/join", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ project_code: trimmedCode, access_key: trimmedKey })
    });

    setJoinCode("");
    setJoinKey("");
    setGeneratedKey("");
    saveProjectId(json.data.id);
    setActiveProjectId(json.data.id);
    setStatus(`${json.data.name} 프로젝트에 참여했습니다.`);
    await loadProjects(token, json.data.id);
  }

  async function createAccessKey() {
    const projectId = activeProjectId;
    if (!projectId) {
      setStatus("접근키를 발급할 프로젝트를 먼저 작업 프로젝트로 설정하세요.");
      return;
    }

    const json = await apiJson<AccessKeyResult>(`/projects/${projectId}/access-key`, {
      method: "POST",
      headers: authHeaders(token)
    });

    setGeneratedKey(json.data.access_key);
    setStatus("새 프로젝트 접근키를 생성했습니다. 이 값은 지금만 표시됩니다.");
  }

  function setWorkProject(project: Project) {
    setActiveProjectId(project.id);
    saveProjectId(project.id);
    setGeneratedKey("");
    setStatus(`${project.name} 프로젝트를 Rooms, Photos, Viewer의 작업 기준으로 설정했습니다.`);
  }

  function showRevitImportGuide() {
    setStatus(
      "Revit 2025에서 BIM Photo Sync > Connect Project를 실행하고, 웹에서 생성한 프로젝트를 선택한 뒤 Sync Rooms / Sync Floor Plan을 실행하세요."
    );
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

  return (
    <section className="project-page">
      <div className="breadcrumb">
        <span>{user?.company_name ?? "Company"}</span>
        <span>/</span>
        <strong>Projects</strong>
      </div>

      <div className="project-admin-layout">
        <div className="project-directory panel">
          <div className="panel-header project-header">
            <div>
              <p className="eyebrow-text">회사 프로젝트</p>
              <h1 className="page-title">우리 회사 프로젝트 목록</h1>
              <p className="muted">Room, 사진, Viewer, Revit Add-in은 작업 프로젝트 기준으로 동작합니다.</p>
            </div>
            <button
              aria-label="프로젝트 새로고침"
              className="icon-button"
              onClick={() => loadProjects().catch((err) => setStatus(err.message))}
              type="button"
            >
              <RefreshCw size={17} />
            </button>
          </div>

          <div className="project-list compact">
            {projects.length === 0 ? (
              <div className="project-empty">
                <Building2 size={24} />
                <strong>아직 등록된 프로젝트가 없습니다.</strong>
                <span>{canManageProjects ? "새 프로젝트를 생성한 뒤 Revit에서 동기화하세요." : "관리자에게 프로젝트 접근키를 요청하세요."}</span>
              </div>
            ) : (
              projects.map((project) => (
                <article className={`project-row ${project.id === activeProjectId ? "active" : ""}`} key={project.id}>
                  <Building2 size={18} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.code}</small>
                  </span>
                  <em>{project.id === activeProjectId ? "작업 프로젝트" : project.member_role ?? user?.role}</em>
                  <div className="project-row-actions">
                    <button className="small-button" onClick={() => setWorkProject(project)} type="button">
                      작업 설정
                    </button>
                    <a className="small-button ghost" href="/rooms" onClick={() => setWorkProject(project)}>
                      Rooms
                    </a>
                    <a className="small-button ghost" href="/viewer" onClick={() => setWorkProject(project)}>
                      Viewer
                    </a>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="project-status-row">
            <p className="muted">{status}</p>
            <div className="actions project-actions">
              <a className="button" href="/rooms">
                <Eye size={16} /> Room 매핑 보기
              </a>
              <a className="button secondary" href="/photos">
                <ImageIcon size={16} /> 사진 업로드
              </a>
            </div>
          </div>
        </div>

        {canManageProjects ? (
          <div className="project-admin-stack">
            <div className="project-manager-card panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">새 프로젝트 생성</h2>
                  <p className="muted">프로젝트를 먼저 만든 뒤 Revit Add-in에서 같은 프로젝트를 선택해 Rooms/Sheet를 동기화합니다.</p>
                </div>
                <span className="badge blue">관리자</span>
              </div>
              <div className="project-form-grid">
                <Field label="Project Name">
                  <input
                    className="input"
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder="예: A현장 3공구"
                    value={newProjectName}
                  />
                </Field>
                <Field label="Project Code">
                  <input
                    className="input"
                    onChange={(event) => setNewProjectCode(event.target.value)}
                    placeholder="예: site-a-3f"
                    value={newProjectCode}
                  />
                </Field>
              </div>
              <button className="button project-wide-button" onClick={() => createProject().catch((err) => setStatus(err.message))} type="button">
                <FolderPlus size={16} /> 프로젝트 생성
              </button>
            </div>

            <div className="project-manager-card panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Revit 연결</h2>
                  <p className="muted">{activeProject ? `${activeProject.name} (${activeProject.code}) 기준` : "작업 프로젝트를 먼저 설정하세요."}</p>
                </div>
                <span className="badge blue">Revit</span>
              </div>
              <div className="revit-import-steps compact">
                <span>1. Revit 2025에서 모델을 엽니다.</span>
                <span>2. BIM Photo Sync 탭에서 Connect Project를 실행합니다.</span>
                <span>3. 웹에서 만든 프로젝트를 선택합니다.</span>
                <span>4. Sync Rooms / Sync Floor Plan을 실행합니다.</span>
              </div>
              <button className="button project-wide-button" onClick={showRevitImportGuide} type="button">
                <Link2 size={16} /> Revit 연결 안내
              </button>
            </div>

            <div className="project-manager-card panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">프로젝트 접근키</h2>
                  <p className="muted">{activeProject ? `${activeProject.name} (${activeProject.code})` : "작업 프로젝트를 먼저 설정하세요."}</p>
                </div>
                <ShieldCheck size={19} />
              </div>
              <button className="button project-wide-button" onClick={() => createAccessKey().catch((err) => setStatus(err.message))} type="button">
                <KeyRound size={16} /> 접근키 생성
              </button>
              {generatedKey ? <code className="key-box">{generatedKey}</code> : null}
            </div>
          </div>
        ) : (
          <div className="project-admin-stack">
            <div className="project-manager-card panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">접근키로 프로젝트 참여</h2>
                  <p className="muted">관리자가 발급한 프로젝트 코드와 접근키를 입력하면 사진 업로드와 조회 범위에 참여할 수 있습니다.</p>
                </div>
                <span className="badge green">일반 사용자</span>
              </div>
              <div className="project-form-grid">
                <Field label="Project Code">
                  <input className="input" onChange={(event) => setJoinCode(event.target.value)} value={joinCode} />
                </Field>
                <Field label="Access Key">
                  <input className="input" onChange={(event) => setJoinKey(event.target.value)} value={joinKey} />
                </Field>
              </div>
              <button className="button project-wide-button" onClick={() => joinProject().catch((err) => setStatus(err.message))} type="button">
                <KeyRound size={16} /> 프로젝트 참여
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
