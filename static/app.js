const taskPanel = document.querySelector("#task-panel");
const taskForm = document.querySelector("#task-form");
const taskList = document.querySelector("#task-list");
const memberPanel = document.querySelector("#household-panel");
const memberList = document.querySelector("#member-list");
const tagsPanel = document.querySelector("#tags-panel");
const tagList = document.querySelector("#tag-list");
const messagePanel = document.querySelector("#message-panel");
const messageForm = document.querySelector("#message-form");
const messageList = document.querySelector("#message-list");
const notice = document.querySelector("#notice");
const dueAlertPanel = document.querySelector("#due-alerts");
const dueAlertList = document.querySelector("#due-alert-list");
let currentStatus = "open";
let currentPage = 1;
let currentTasks = [];
let members = [];
let tags = [];
let messages = [];
let noticeTimer;
const ALERT_WINDOW_MS = 60 * 60 * 1000;
const TASKS_PER_PAGE = 10;
const AVATAR_OPTIONS = [
  { key: "happy", label: "Happy" },
  { key: "grin", label: "Big smile" },
  { key: "cool", label: "Cool" },
  { key: "glasses", label: "Glasses" },
  { key: "love", label: "Love" },
  { key: "sleepy", label: "Sleepy" },
  { key: "surprised", label: "Surprised" },
  { key: "wink", label: "Wink" },
];

function populateAvatarOptions(select, selected = AVATAR_OPTIONS[0].key) {
  select.replaceChildren();
  AVATAR_OPTIONS.forEach(({ key, label }) => {
    select.append(new Option(label, key));
  });
  select.value = AVATAR_OPTIONS.some(({ key }) => key === selected)
    ? selected
    : AVATAR_OPTIONS[0].key;
}

function createAvatarImage(key, className = "avatar-image") {
  const image = document.createElement("img");
  const avatar = AVATAR_OPTIONS.find((option) => option.key === key) || AVATAR_OPTIONS[0];
  image.className = className;
  image.src = `/static/avatars/${avatar.key}.svg`;
  image.alt = `${avatar.label} face`;
  image.width = 32;
  image.height = 32;
  return image;
}

const newMemberAvatar = document.querySelector("#member-avatar");
populateAvatarOptions(newMemberAvatar);
document.querySelector("#member-avatar-preview").append(
  createAvatarImage(newMemberAvatar.value)
);
newMemberAvatar.addEventListener("change", () => {
  document.querySelector("#member-avatar-preview").replaceChildren(
    createAvatarImage(newMemberAvatar.value)
  );
});

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
  tagsPanel.hidden = true;
  messagePanel.hidden = true;
  resetTaskForm();
  if (task) {
    document.querySelector("#task-id").value = task.id;
    document.querySelector("#task-title").value = task.title;
    document.querySelector("#task-assignee").value = task.assigned_to;
    document.querySelector("#task-due").value = task.due_at;
    document.querySelector("#task-tag").value = task.tag_id || "";
    document.querySelector("#task-details").value = task.details;
    document.querySelector("#task-form-heading").textContent = "Edit task";
    document.querySelector("#save-task-button").textContent = "Save changes";
  }
  taskPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#task-title").focus({ preventScroll: true });
}

function openMessageForm() {
  taskPanel.hidden = true;
  memberPanel.hidden = true;
  tagsPanel.hidden = true;
  messagePanel.hidden = false;
  messageForm.reset();
  const selectedRecipient = document.querySelector("#message-filter-recipient").value;
  if (members.some((member) => String(member.id) === selectedRecipient)) {
    document.querySelector("#message-recipient").value = selectedRecipient;
  }
  messagePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#message-content").focus({ preventScroll: true });
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
    item.append(createAvatarImage(task.assignee_avatar, "alert-avatar"));
    const title = document.createElement("strong");
    title.textContent = task.title;
    item.append(title, document.createTextNode(` — ${task.assignee}, due ${formatDue(task.due_at)}`));
    dueAlertList.append(item);
  });
}

function renderMessages() {
  messageList.replaceChildren();
  const unreadCount = messages.filter((message) => !message.is_read).length;
  document.querySelector("#message-count").textContent = `${unreadCount} unread`;
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state message-empty-state";
    const title = document.createElement("strong");
    title.textContent = `No messages for ${document.querySelector("#message-filter-recipient").selectedOptions[0]?.textContent || "this person"} yet.`;
    const description = document.createElement("span");
    description.textContent = "Leave a note to brighten someone's day.";
    empty.append(title, description);
    messageList.append(empty);
    return;
  }
  messages.forEach((message) => {
    const card = document.createElement("article");
    card.className = `message-card${message.is_read ? " is-read" : ""}`;
    const copy = document.createElement("div");
    copy.className = "message-copy";
    const heading = document.createElement("div");
    heading.className = "message-meta";
    heading.append(
      createAvatarImage(message.sender_avatar, "message-avatar"),
      document.createTextNode(`From ${message.sender} · ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(message.created_at))}`)
    );
    const status = document.createElement("span");
    status.className = "message-status";
    status.textContent = message.is_read ? "Read" : "New";
    heading.append(status);
    const content = document.createElement("p");
    content.className = "message-content";
    content.textContent = message.content;
    copy.append(heading, content);

    const action = document.createElement("button");
    action.className = message.is_read ? "button button-quiet message-action" : "button button-primary message-action";
    action.type = "button";
    action.textContent = message.is_read ? "Dismiss" : "Mark as read";
    action.setAttribute(
      "aria-label",
      message.is_read ? `Dismiss message from ${message.sender}` : `Mark message from ${message.sender} as read`
    );
    action.addEventListener("click", async () => {
      try {
        if (message.is_read) {
          await api(`/api/messages/${message.id}`, { method: "DELETE" });
        } else {
          await api(`/api/messages/${message.id}`, {
            method: "PATCH",
            body: JSON.stringify({ is_read: true }),
          });
        }
        await loadMessages();
      } catch (error) {
        showNotice(error.message);
      }
    });
    card.append(copy, action);
    messageList.append(card);
  });
}

async function loadMessages() {
  const recipientId = document.querySelector("#message-filter-recipient").value;
  if (!recipientId) {
    messages = [];
    renderMessages();
    return;
  }
  try {
    messages = await api(`/api/messages?recipient_id=${encodeURIComponent(recipientId)}`);
    renderMessages();
  } catch (error) {
    showNotice(error.message);
  }
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
  assignee.append(
    createAvatarImage(task.assignee_avatar, "assignee-avatar"),
    document.createTextNode(task.assignee)
  );
  const due = document.createElement("time");
  due.className = "due-date";
  due.dateTime = task.due_at;
  due.textContent = formatDue(task.due_at);
  const remaining = new Date(task.due_at).getTime() - Date.now();
  if (!task.completed && remaining < 0) due.classList.add("overdue");
  meta.append(assignee, due);
  if (task.tag) {
    const tag = document.createElement("span");
    tag.className = "task-tag-chip";
    tag.textContent = task.tag;
    meta.append(tag);
  }
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
    const tagId = document.querySelector("#filter-tag").value;
    if (dueDate) filters.set("due_on", dueDate);
    if (assignee) filters.set("assigned_to", assignee);
    if (tagId) filters.set("tag_id", tagId);
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
    [
      ["#message-sender", members[0]?.id],
      ["#message-recipient", members[0]?.id],
      ["#message-filter-recipient", members[0]?.id],
    ].forEach(([selector, fallback]) => {
      const select = document.querySelector(selector);
      const selected = select.value;
      select.replaceChildren();
      members.forEach((member) => select.append(new Option(member.name, member.id)));
      select.value = members.some((member) => String(member.id) === selected)
        ? selected
        : String(fallback || "");
    });
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
    const avatar = document.querySelector("#member-avatar");
    const selectedAvatar = avatar.value;
    populateAvatarOptions(avatar, selectedAvatar);
    document.querySelector("#member-avatar-preview").replaceChildren(
      createAvatarImage(avatar.value)
    );
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
    caption.textContent = "Member";
    const input = document.createElement("input");
    input.value = member.name;
    input.maxLength = 40;
    input.setAttribute("aria-label", `Name for ${member.name}`);
    const avatarField = document.createElement("label");
    avatarField.className = "field member-avatar-field";
    const avatarCaption = document.createElement("span");
    avatarCaption.textContent = "Face";
    const avatarSelect = document.createElement("select");
    avatarSelect.setAttribute("aria-label", `Face icon for ${member.name}`);
    populateAvatarOptions(avatarSelect, member.avatar);
    const avatarPreview = createAvatarImage(member.avatar);
    avatarSelect.addEventListener("change", () => {
      avatarPreview.src = `/static/avatars/${avatarSelect.value}.svg`;
      avatarPreview.alt = `${AVATAR_OPTIONS.find((option) => option.key === avatarSelect.value).label} face`;
    });
    avatarField.append(
      avatarCaption,
      avatarPreview,
      avatarSelect
    );
    field.append(caption, input);
    const save = document.createElement("button");
    save.className = "member-action";
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      try {
        await api(`/api/members/${member.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: input.value, avatar: avatarSelect.value }),
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
    row.append(field, avatarField, save, remove);
    memberList.append(row);
  });
}

async function loadTags() {
  try {
    tags = await api("/api/tags");
    const taskSelect = document.querySelector("#task-tag");
    const selectedTaskTag = taskSelect.value;
    taskSelect.replaceChildren(new Option("No tag", ""));
    tags.forEach((tag) => taskSelect.append(new Option(tag.name, tag.id)));
    if (tags.some((tag) => String(tag.id) === selectedTaskTag)) {
      taskSelect.value = selectedTaskTag;
    }

    const filter = document.querySelector("#filter-tag");
    const selectedFilterTag = filter.value;
    filter.replaceChildren(new Option("Every tag", ""));
    tags.forEach((tag) => filter.append(new Option(tag.name, tag.id)));
    if (tags.some((tag) => String(tag.id) === selectedFilterTag)) {
      filter.value = selectedFilterTag;
    }
    renderTags();
  } catch (error) {
    showNotice(error.message);
  }
}

function renderTags() {
  tagList.replaceChildren();
  tags.forEach((tag) => {
    const row = document.createElement("li");
    row.className = "tag-row";
    const field = document.createElement("label");
    field.className = "field tag-name-field";
    const caption = document.createElement("span");
    caption.textContent = "Tag name";
    const input = document.createElement("input");
    input.value = tag.name;
    input.maxLength = 40;
    input.setAttribute("aria-label", `Name for ${tag.name}`);
    field.append(caption, input);

    const save = document.createElement("button");
    save.className = "member-action";
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      try {
        await api(`/api/tags/${tag.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: input.value }),
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
    remove.setAttribute("aria-label", `Remove ${tag.name}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete the "${tag.name}" tag?`)) return;
      try {
        await api(`/api/tags/${tag.id}`, { method: "DELETE" });
        await refreshData();
      } catch (error) {
        showNotice(error.message);
      }
    });
    row.append(field, save, remove);
    tagList.append(row);
  });
}

async function refreshData() {
  await loadMembers();
  await loadTags();
  await loadTasks();
  await loadMessages();
}

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const recipientId = Number(document.querySelector("#message-recipient").value);
  try {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        sender_id: Number(document.querySelector("#message-sender").value),
        recipient_id: recipientId,
        content: document.querySelector("#message-content").value,
      }),
    });
    document.querySelector("#message-filter-recipient").value = String(recipientId);
    messagePanel.hidden = true;
    messageForm.reset();
    await loadMessages();
  } catch (error) {
    showNotice(error.message);
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#task-id").value;
  const data = {
    title: document.querySelector("#task-title").value,
    details: document.querySelector("#task-details").value,
    assigned_to: Number(document.querySelector("#task-assignee").value),
    due_at: document.querySelector("#task-due").value,
    tag_id: document.querySelector("#task-tag").value
      ? Number(document.querySelector("#task-tag").value)
      : null,
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
document.querySelector("#messages-toggle").addEventListener("click", openMessageForm);
document.querySelectorAll(".emotion-button").forEach((button) => {
  button.addEventListener("click", () => {
    const textarea = document.querySelector("#message-content");
    const emotion = button.dataset.emotion;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const updated = `${textarea.value.slice(0, start)}${emotion}${textarea.value.slice(end)}`;
    if (updated.length > textarea.maxLength) return;
    textarea.value = updated;
    textarea.focus();
    const caret = start + emotion.length;
    textarea.setSelectionRange(caret, caret);
  });
});
document.querySelector("#close-message-form").addEventListener("click", () => { messagePanel.hidden = true; });
document.querySelector("#cancel-message-form").addEventListener("click", () => { messagePanel.hidden = true; });
document.querySelector("#message-filter-recipient").addEventListener("change", loadMessages);
document.querySelector("#close-task-form").addEventListener("click", () => { taskPanel.hidden = true; });
document.querySelector("#cancel-task-form").addEventListener("click", () => { taskPanel.hidden = true; });
document.querySelector("#household-toggle").addEventListener("click", async () => {
  taskPanel.hidden = true;
  tagsPanel.hidden = true;
  messagePanel.hidden = true;
  memberPanel.hidden = !memberPanel.hidden;
  if (!memberPanel.hidden) await loadMembers();
});
document.querySelector("#close-household").addEventListener("click", () => { memberPanel.hidden = true; });
document.querySelector("#member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#member-name");
  try {
    await api("/api/members", {
      method: "POST",
      body: JSON.stringify({
        name: input.value,
        avatar: document.querySelector("#member-avatar").value,
      }),
    });
    input.value = "";
    await refreshData();
  } catch (error) {
    showNotice(error.message);
  }
});
document.querySelector("#tags-toggle").addEventListener("click", async () => {
  taskPanel.hidden = true;
  memberPanel.hidden = true;
  messagePanel.hidden = true;
  tagsPanel.hidden = !tagsPanel.hidden;
  if (!tagsPanel.hidden) await loadTags();
});
document.querySelector("#close-tags").addEventListener("click", () => { tagsPanel.hidden = true; });
document.querySelector("#tag-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#tag-name");
  try {
    await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: input.value }),
    });
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
document.querySelector("#filter-tag").addEventListener("change", () => {
  currentPage = 1;
  loadTasks();
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  document.querySelector("#filter-due-date").value = "";
  document.querySelector("#filter-assignee").value = "";
  document.querySelector("#filter-tag").value = "";
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
  if (document.visibilityState === "visible") {
    loadTasks();
    loadMessages();
  }
}, 60_000);
