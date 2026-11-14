const taskPanel = document.querySelector("#task-panel");
const taskForm = document.querySelector("#task-form");
const taskList = document.querySelector("#task-list");
const memberPanel = document.querySelector("#household-panel");
const memberList = document.querySelector("#member-list");
const notice = document.querySelector("#notice");
const dueAlertPanel = document.querySelector("#due-alerts");
const dueAlertList = document.querySelector("#due-alert-list");
let currentStatus = "open";
let currentPage = 1;
let currentTasks = [];
let members = [];
let noticeTimer;
const ALERT_WINDOW_MS = 60 * 60 * 1000;
const TASKS_PER_PAGE = 10;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function resetTaskForm() {
  taskForm.reset();
  document.querySelector("#task-id").value = "";
  document.querySelector("#task-form-heading").textContent = "Create a task";
  document.querySelector("#save-task-button").textContent = "Add task";
  document.querySelector("#task-due").value = localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000));
}

function openTaskForm(task = null) {
  taskPanel.hidden = false;
  memberPanel.hidden = true;
  resetTaskForm();
  if (task) {
    document.querySelector("#task-id").value = task.id;
    document.querySelector("#task-title").value = task.title;
    document.querySelector("#task-assignee").value = task.assigned_to;
    document.querySelector("#task-due").value = task.due_at;
    document.querySelector("#task-details").value = task.details;
    document.querySelector("#task-form-heading").textContent = "Edit task";
    document.querySelector("#save-task-button").textContent = "Save changes";
  }
  taskPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#task-title").focus({ preventScroll: true });
}

function formatDue(value) {
  const due = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(due);
}

function renderTasks(tasks) {
  currentTasks = tasks;
  const pageCount = Math.ceil(tasks.length / TASKS_PER_PAGE);
  currentPage = Math.min(currentPage, Math.max(pageCount, 1));
  const start = (currentPage - 1) * TASKS_PER_PAGE;
  const pageTasks = tasks.slice(start, start + TASKS_PER_PAGE);
  taskList.replaceChildren();
  const taskCount = tasks.length === 1 ? "task" : "tasks";
  document.querySelector("#task-count").textContent = tasks.length
    ? `Showing ${start + 1}–${Math.min(start + TASKS_PER_PAGE, tasks.length)} of ${tasks.length} ${taskCount}`
    : `0 ${taskCount}`;
  document.querySelector("#pagination").hidden = pageCount <= 1;
  document.querySelector("#page-indicator").textContent = pageCount
    ? `Page ${currentPage} of ${pageCount}`
    : "No pages";
  document.querySelector("#previous-page").disabled = currentPage === 1;
  document.querySelector("#next-page").disabled = currentPage >= pageCount;
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = currentStatus === "open" ? "All caught up!" : "Nothing to show yet.";
    const description = document.createElement("span");
    description.textContent = currentStatus === "open"
      ? "Add a task whenever something needs doing."
      : "Tasks will appear here as your family uses the planner.";
    empty.append(title, description);
    taskList.append(empty);
    return;
  }
  pageTasks.forEach((task) => taskList.append(createTaskCard(task)));
}

function renderDueAlerts(tasks) {
  const now = Date.now();
  const dueSoon = tasks.filter((task) => {
    const remaining = new Date(task.due_at).getTime() - now;
    return !task.completed && remaining > 0 && remaining <= ALERT_WINDOW_MS;
  });
  dueAlertList.replaceChildren();
  dueAlertPanel.hidden = dueSoon.length === 0;
  dueSoon.forEach((task) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = task.title;
    item.append(title, document.createTextNode(` — ${task.assignee}, due ${formatDue(task.due_at)}`));
    dueAlertList.append(item);
  });
}

function createTaskCard(task) {
  const card = document.createElement("article");
  card.className = `task-card${task.completed ? " is-complete" : ""}`;

  const main = document.createElement("div");
  main.className = "task-main";
  const toggle = document.createElement("button");
  toggle.className = "complete-toggle";
  toggle.type = "button";
  toggle.textContent = task.completed ? "✓" : "";
  toggle.setAttribute("aria-label", task.completed ? "Mark task as not done" : "Mark task complete");
  toggle.addEventListener("click", () => updateTask(task.id, { completed: !task.completed }));

  const copy = document.createElement("div");
  copy.className = "task-copy";
  const title = document.createElement("h3");
  title.className = "task-title";
  title.textContent = task.title;
  copy.append(title);
  if (task.details) {
    const details = document.createElement("p");
    details.className = "task-details";
    details.textContent = task.details;
    copy.append(details);
  }
  const meta = document.createElement("div");
  meta.className = "task-meta";
  const assignee = document.createElement("span");
  assignee.className = "assignee-chip";
  assignee.textContent = task.assignee;
  const due = document.createElement("time");
  due.className = "due-date";
  due.dateTime = task.due_at;
  due.textContent = formatDue(task.due_at);
  const remaining = new Date(task.due_at).getTime() - Date.now();
  if (!task.completed && remaining < 0) due.classList.add("overdue");
  meta.append(assignee, due);
  if (!task.completed && remaining > 0 && remaining <= ALERT_WINDOW_MS) {
    const alert = document.createElement("span");
    alert.className = "due-soon-chip";
    alert.textContent = "Due soon";
    meta.append(alert);
  }
  copy.append(meta);
  main.append(toggle, copy);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  const edit = document.createElement("button");
  edit.className = "task-action";
  edit.type = "button";
  edit.textContent = "✎";
  edit.setAttribute("aria-label", `Edit ${task.title}`);
  edit.addEventListener("click", () => openTaskForm(task));
  const remove = document.createElement("button");
  remove.className = "task-action delete";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Delete ${task.title}`);
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      await loadTasks();
    } catch (error) {
      showNotice(error.message);
    }
  });
  actions.append(edit, remove);
  card.append(main, actions);
  return card;
}

async function loadTasks() {
  try {
    const filters = new URLSearchParams({ status: currentStatus });
    const dueDate = document.querySelector("#filter-due-date").value;
    const assignee = document.querySelector("#filter-assignee").value;
    if (dueDate) filters.set("due_on", dueDate);
    if (assignee) filters.set("assigned_to", assignee);
    const [tasks, openTasks] = await Promise.all([
      api(`/api/tasks?${filters}`),
      api("/api/tasks?status=open"),
    ]);
    renderTasks(tasks);
    renderDueAlerts(openTasks);
  } catch (error) {
    showNotice(error.message);
  }
}

async function updateTask(id, changes) {
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
    await loadTasks();
  } catch (error) {
    showNotice(error.message);
  }
}

async function loadMembers() {
  try {
    members = await api("/api/members");
    const select = document.querySelector("#task-assignee");
    const selected = select.value;
    select.replaceChildren();
    members.forEach((member) => {
      const option = document.createElement("option");
      option.value = member.id;
      option.textContent = member.name;
      select.append(option);
    });
    if (members.some((member) => String(member.id) === selected)) select.value = selected;
    const filter = document.querySelector("#filter-assignee");
    const selectedFilter = filter.value;
    filter.replaceChildren(new Option("Everyone", ""));
    members.forEach((member) => {
      filter.append(new Option(member.name, member.id));
    });
    if (members.some((member) => String(member.id) === selectedFilter)) {
      filter.value = selectedFilter;
    }
    renderMembers();
  } catch (error) {
    showNotice(error.message);
  }
}

function renderMembers() {
  memberList.replaceChildren();
  members.forEach((member) => {
    const row = document.createElement("li");
    row.className = "member-row";
    const field = document.createElement("label");
    field.className = "field member-name";
    const caption = document.createElement("span");
    caption.textContent = "Name";
    const input = document.createElement("input");
    input.value = member.name;
    input.maxLength = 40;
    input.setAttribute("aria-label", `Name for ${member.name}`);
    field.append(caption, input);
    const save = document.createElement("button");
    save.className = "member-action";
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      try {
        await api(`/api/members/${member.id}`, {
          method: "PATCH", body: JSON.stringify({ name: input.value }),
        });
        await refreshData();
      } catch (error) {
        showNotice(error.message);
      }
    });
    const remove = document.createElement("button");
    remove.className = "member-action remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${member.name}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove ${member.name} from the household?`)) return;
      try {
        await api(`/api/members/${member.id}`, { method: "DELETE" });
        await refreshData();
      } catch (error) {
        showNotice(error.message);
      }
    });
    row.append(field, save, remove);
    memberList.append(row);
  });
}

async function refreshData() {
  await loadMembers();
  await loadTasks();
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#task-id").value;
  const data = {
    title: document.querySelector("#task-title").value,
    details: document.querySelector("#task-details").value,
    assigned_to: Number(document.querySelector("#task-assignee").value),
    due_at: document.querySelector("#task-due").value,
  };
  try {
    await api(id ? `/api/tasks/${id}` : "/api/tasks", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(data),
    });
    taskPanel.hidden = true;
    await loadTasks();
  } catch (error) {
    showNotice(error.message);
  }
});

document.querySelector("#new-task-button").addEventListener("click", () => openTaskForm());
document.querySelector("#close-task-form").addEventListener("click", () => { taskPanel.hidden = true; });
document.querySelector("#cancel-task-form").addEventListener("click", () => { taskPanel.hidden = true; });
document.querySelector("#household-toggle").addEventListener("click", async () => {
  taskPanel.hidden = true;
  memberPanel.hidden = !memberPanel.hidden;
  if (!memberPanel.hidden) await loadMembers();
});
document.querySelector("#close-household").addEventListener("click", () => { memberPanel.hidden = true; });
document.querySelector("#member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#member-name");
  try {
    await api("/api/members", { method: "POST", body: JSON.stringify({ name: input.value }) });
    input.value = "";
    await refreshData();
  } catch (error) {
    showNotice(error.message);
  }
});
document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    currentStatus = tab.dataset.status;
    currentPage = 1;
    document.querySelectorAll(".filter-tab").forEach((item) => item.classList.toggle("active", item === tab));
    await loadTasks();
  });
});
document.querySelector("#filter-due-date").addEventListener("change", () => {
  currentPage = 1;
  loadTasks();
});
document.querySelector("#filter-assignee").addEventListener("change", () => {
  currentPage = 1;
  loadTasks();
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  document.querySelector("#filter-due-date").value = "";
  document.querySelector("#filter-assignee").value = "";
  currentPage = 1;
  loadTasks();
});
document.querySelector("#previous-page").addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage -= 1;
    renderTasks(currentTasks);
  }
});
document.querySelector("#next-page").addEventListener("click", () => {
  if (currentPage < Math.ceil(currentTasks.length / TASKS_PER_PAGE)) {
    currentPage += 1;
    renderTasks(currentTasks);
  }
});

refreshData();
window.setInterval(() => {
  if (document.visibilityState === "visible") loadTasks();
}, 60_000);
