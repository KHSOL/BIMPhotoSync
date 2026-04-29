# AGENTS.md

## Mandatory Project Operating Rules

These instructions apply to every agent working in this repository. Follow them unless a higher-priority system/developer instruction or explicit user instruction for the current turn conflicts.

## Codex Runtime And OMX

- The local OMX checkout is kept at `.codex/external/oh-my-codex`.
- Before substantial work, inspect and use the relevant OMX workflows, prompts, skills, or guidance when they improve planning, execution, review, or verification.
- Keep OMX as an optimization layer, not as a replacement for repository-specific requirements. If OMX guidance conflicts with this file, this file wins.
- When the environment supports OMX directly, prefer its intended workflow: clarify scope, plan, execute, verify, and preserve useful state.

## Subagent Teaming

- The full `VoltAgent/awesome-codex-subagents` catalog is mirrored locally at `.codex/external/awesome-codex-subagents`.
- Project-ready Codex subagents are installed in `.codex/agents`.
- At the start of non-trivial work, choose the smallest effective team of subagents for the task. Use specialists such as `code-mapper`, `backend-developer`, `frontend-developer`, `nextjs-developer`, `csharp-developer`, `dotnet-core-expert`, `database-administrator`, `devops-engineer`, `security-auditor`, `qa-expert`, and `docs-researcher` as appropriate.
- Do not spawn subagents for trivial edits. When subagents are used, assign concrete, non-overlapping scopes and integrate their findings explicitly.
- Codex platform rules still apply: only delegate when the active environment permits subagents and the user request authorizes delegation.

## Research Requirements

- For Revit, BIM, construction-photo workflows, AI analysis, storage, deployment, or any project-adjacent technical decision, check current primary sources before making architectural claims.
- Prefer Autodesk/Revit official documentation, Dynamo official documentation, framework/vendor docs, peer-reviewed papers, and mature open-source repositories.
- For Codex-style tasks, check the official Codex use cases at `https://developers.openai.com/codex/use-cases`. If a current task resembles an official use case, apply that workflow as a reference before inventing a new process.
- Use research only when it is relevant to the current change. Document useful findings in `README.md` or the implementation notes for that change.

## GitHub Connection Stability

- Keep the Git remote in canonical HTTPS form: `https://github.com/KHSOL/BIMPhotoSync.git`.
- Use Git Credential Manager with GitHub path scoping enabled for this repository so credentials are less likely to be mixed with other accounts or repositories.
- If GitHub App/connector permissions fail, fall back to authenticated local Git for commit and push, then report the exact connector limitation for PR/merge operations.

## Branch, Commit, PR, And Main Hygiene

- New feature work must start from a new branch using the `codex/` prefix unless the user requests another branch name.
- Keep work scoped. Do not mix unrelated cleanup with feature changes.
- After each completed task, update `README.md` so it reflects the current behavior, setup, architecture, and operational assumptions.
- When the feature is complete, run appropriate verification, commit on the feature branch, push it, open a PR into `main`, merge only if checks/review are acceptable, then delete the feature branch so only `main` remains long-term.
- If credentials, GitHub permissions, CI, or branch protection prevent push/PR/merge/delete, report the exact blocker and leave the branch ready for the user.

## Documentation Policy

- `README.md` is the canonical project document.
- Avoid adding separate architecture or operation docs unless the user explicitly asks for them.
- If temporary notes are necessary during work, fold the final useful content back into `README.md` before completion.

## BIM Photo Sync Architecture Rules

- `Room` is the canonical domain object. Photos, AI analyses, and Revit lookups are anchored to Rooms.
- PostgreSQL is the source of truth. Revit is an authoring environment, not the application database.
- Revit Room mapping must use `BIM_PHOTO_ROOM_ID`, not Room name matching.
- Revit model writes must happen through External Events.
- Revit UI integration uses a Dockable Panel for the Room photo timeline.
- Dynamo is not part of the current implementation unless code is explicitly added for Dynamo graphs/scripts.
