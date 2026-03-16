export interface WizardState {
  currentStep: number;
  totalSteps: number;
}

export function renderWizardShell(container: HTMLElement, state: WizardState): void {
  container.innerHTML = "";
  const title = document.createElement("h1");
  title.textContent = `Step ${state.currentStep}/${state.totalSteps}`;
  const requiredInput = document.createElement("input");
  requiredInput.required = true;
  requiredInput.setAttribute("data-testid", "wizard-required-input");
  container.append(title, requiredInput);
}

export function renderConnectivityPanel(
  container: HTMLElement,
  status: "idle" | "connecting" | "success" | "failed",
  detail?: string
): void {
  container.innerHTML = "";
  const button = document.createElement("button");
  button.textContent = "检测连通性";
  button.disabled = status === "connecting";
  const result = document.createElement("div");
  result.setAttribute("data-testid", "connectivity-result");
  result.textContent = detail ?? status;
  container.append(button, result);
}

export interface ProjectRow {
  id: string;
  name: string;
}

export function renderProjectPage(container: HTMLElement, projects: ProjectRow[], canEdit: boolean): void {
  container.innerHTML = "";
  const list = document.createElement("ul");
  projects.forEach((project) => {
    const item = document.createElement("li");
    item.textContent = project.name;
    list.appendChild(item);
  });
  const createButton = document.createElement("button");
  createButton.textContent = "新建项目";
  createButton.hidden = !canEdit;
  container.append(list, createButton);
}

export interface AuditRow {
  id: string;
  action: string;
}

export function renderAuditPage(container: HTMLElement, rows: AuditRow[], invalidFilter: boolean): void {
  container.innerHTML = "";
  if (invalidFilter) {
    container.textContent = "筛选条件无效";
    return;
  }
  if (rows.length === 0) {
    container.textContent = "暂无审计数据";
    return;
  }
  const list = document.createElement("ul");
  rows.forEach((row) => {
    const item = document.createElement("li");
    item.textContent = `${row.id}:${row.action}`;
    list.appendChild(item);
  });
  container.appendChild(list);
}

export interface MemberRow {
  userId: string;
  role: string;
}

export function renderMembersPage(
  container: HTMLElement,
  members: MemberRow[],
  canManage: boolean
): void {
  container.innerHTML = "";
  const table = document.createElement("table");
  members.forEach((member) => {
    const tr = document.createElement("tr");
    const userTd = document.createElement("td");
    userTd.textContent = member.userId;
    const roleTd = document.createElement("td");
    roleTd.textContent = member.role;
    const actionTd = document.createElement("td");
    const button = document.createElement("button");
    button.textContent = "修改角色";
    button.disabled = !canManage;
    actionTd.appendChild(button);
    tr.append(userTd, roleTd, actionTd);
    table.appendChild(tr);
  });
  container.appendChild(table);
}
