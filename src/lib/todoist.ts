// One-way sync from Many Apply to Todoist (v1). Uses the Todoist API v1 with the user's personal token.
import { getSecret, httpFetch } from "./platform";
import type { Client, Grant, ReportDate, Settings } from "./model";
import { addDays, fromISO, toISO } from "./util";

const API = "https://api.todoist.com/api/v1";
export const TOKEN_KEY = "todoist_token";

export class TodoistError extends Error {}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await httpFetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TodoistError(res.status === 401 || res.status === 403 ? "Todoist didn't accept the token." : `Todoist error ${res.status}: ${body.slice(0, 120)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function getToken(): Promise<string | null> {
  return getSecret(TOKEN_KEY);
}

interface Project {
  id: string;
  name: string;
}

export async function listProjects(token: string): Promise<Project[]> {
  const out: Project[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const q: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const r = await call<{ results?: Project[]; next_cursor?: string | null } | Project[]>(token, `/projects${q}`);
    if (Array.isArray(r)) return r;
    out.push(...(r.results ?? []));
    cursor = r.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

export async function testToken(token: string): Promise<number> {
  return (await listProjects(token)).length;
}

async function createTask(token: string, task: { content: string; due_date: string; description?: string; project_id?: string }) {
  const body: Record<string, string> = { content: task.content, due_date: task.due_date };
  if (task.description) body.description = task.description;
  if (task.project_id) body.project_id = task.project_id;
  const r = await call<{ id: string }>(token, "/tasks", { method: "POST", body: JSON.stringify(body) });
  return String(r.id);
}

/**
 * Resolve the Todoist project for a grant: the client's own project (created on first use) when
 * "project per client" is on, else the default project. Returns the project id to use and, if a client
 * project was just created, the updated client so the caller can save it.
 */
export async function projectFor(
  token: string,
  settings: Settings,
  client: Client | undefined,
): Promise<{ projectId?: string; updatedClient?: Client }> {
  if (settings.todoist.projectPerClient && client) {
    if (client.fm.todoist_project_id) return { projectId: client.fm.todoist_project_id };
    const name = client.slug === "me" ? "Many Apply" : `Many Apply · ${client.fm.name}`;
    const existing = (await listProjects(token)).find((p) => p.name === name);
    const id = existing?.id ?? (await call<{ id: string }>(token, "/projects", { method: "POST", body: JSON.stringify({ name }) })).id;
    return { projectId: String(id), updatedClient: { ...client, fm: { ...client.fm, todoist_project_id: String(id) } } };
  }
  return { projectId: settings.todoist.defaultProjectId || undefined };
}

/** When a grant moves to planning: a task due on the deadline, plus prep tasks from the template. */
export async function tasksForPlanning(token: string, settings: Settings, g: Grant, projectId?: string): Promise<string[]> {
  const deadline = fromISO(g.fm.deadline);
  if (!deadline) return [];
  const desc = [g.fm.url, `Many Apply: grants/${g.folder}`].filter(Boolean).join("\n");
  const ids: string[] = [];
  ids.push(await createTask(token, { content: `Submit: ${g.fm.title}`, due_date: g.fm.deadline, description: desc, project_id: projectId }));
  const today = toISO(new Date());
  for (const p of settings.todoist.prepTasks) {
    const due = toISO(addDays(deadline, -p.days_before));
    if (due < today) continue;
    ids.push(await createTask(token, { content: `${p.title}: ${g.fm.title}`, due_date: due, description: desc, project_id: projectId }));
  }
  return ids;
}

/** When a reporting date is added: a task on that date, plus an optional reminder before. */
export async function tasksForReport(token: string, settings: Settings, g: Grant, r: ReportDate, projectId?: string): Promise<string[]> {
  if (!r.due) return [];
  const desc = [r.notes, `Many Apply: grants/${g.folder}`].filter(Boolean).join("\n");
  const ids = [await createTask(token, { content: `${r.title}: ${g.fm.title}`, due_date: r.due, description: desc, project_id: projectId })];
  const days = settings.todoist.reportReminderDays;
  if (days) {
    const due = toISO(addDays(fromISO(r.due)!, -days));
    if (due >= toISO(new Date()))
      ids.push(await createTask(token, { content: `Start ${r.title.toLowerCase()}: ${g.fm.title}`, due_date: due, description: desc, project_id: projectId }));
  }
  return ids;
}
