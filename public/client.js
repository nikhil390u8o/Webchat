// public/client.js
const socket = io();

// UI elements
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileUsername = document.getElementById("profileUsername");

const loginUsername = document.getElementById("loginUsername");
const loginDisplay = document.getElementById("loginDisplay");
const avatarFile = document.getElementById("avatarFile");
const loginBtn = document.getElementById("loginBtn");

const groupList = document.getElementById("groupList");
const userList = document.getElementById("userList");
const newGroupName = document.getElementById("newGroupName");
const createGroupBtn = document.getElementById("createGroupBtn");

const chatTitle = document.getElementById("chatTitle");
const chatWindow = document.getElementById("chatWindow");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const headerActions = document.getElementById("headerActions");

let me = null; // { username, displayName, avatar }
let state = { users: [], groups: [] };
let currentTarget = null; // { type: 'group'|'user', id: 'groupName' or username }

// helpers
function setProfileUI() {
  if (!me) {
    profileAvatar.textContent = "G";
    profileName.textContent = "Guest";
    profileUsername.textContent = "@guest";
  } else {
    if (me.avatar) {
      profileAvatar.style.backgroundImage = `url(${me.avatar})`;
      profileAvatar.textContent = "";
    } else {
      profileAvatar.style.backgroundImage = "";
      profileAvatar.textContent = me.displayName ? me.displayName.slice(0,2).toUpperCase() : me.username.slice(0,2).toUpperCase();
    }
    profileName.textContent = me.displayName || me.username;
    profileUsername.textContent = `@${me.username}`;
  }
}

function renderLists() {
  // groups
  groupList.innerHTML = "";
  state.groups.forEach(g => {
    const el = document.createElement("div");
    el.className = "list-item";
    el.innerHTML = `<div><strong>${g.name}</strong><div class="muted small">owner: ${g.owner} • ${g.members.length} members</div></div>`;
    el.onclick = () => selectGroup(g.name);
    groupList.appendChild(el);
  });

  // users
  userList.innerHTML = "";
  state.users.forEach(u => {
    if (me && u === me.username) return; // don't show self
    const el = document.createElement("div");
    el.className = "list-item";
    el.textContent = u;
    el.onclick = () => selectUser(u);
    userList.appendChild(el);
  });
}

function selectGroup(name) {
  currentTarget = { type: "group", id: name };
  chatTitle.textContent = `# ${name}`;
  chatWindow.innerHTML = "";
  headerActions.innerHTML = "";
  // Show join/leave/delete buttons depending on membership & ownership
  const group = state.groups.find(g => g.name === name);
  if (!group) return;

  const isMember = me && group.members.includes(me.username);
  const isOwner = me && group.owner === me.username;

  if (!isMember) {
    const btn = document.createElement("button");
    btn.textContent = "Join";
    btn.onclick = () => {
      socket.emit("join_group", { groupName: name }, res => {
        if (!res.ok) alert(res.error || "Failed");
      });
    };
    headerActions.appendChild(btn);
  } else {
    const btnLeave = document.createElement("button");
    btnLeave.textContent = "Leave";
    btnLeave.onclick = () => {
      socket.emit("leave_group", { groupName: name }, res => {
        if (!res.ok) alert(res.error || "Failed");
      });
    };
    headerActions.appendChild(btnLeave);
  }

  if (isOwner) {
    const btnDel = document.createElement("button");
    btnDel.textContent = "Delete Group";
    btnDel.onclick = () => {
      if (!confirm("Delete group?")) return;
      socket.emit("delete_group", { groupName: name }, res => {
        if (!res.ok) alert(res.error || "Failed");
      });
    };
    headerActions.appendChild(btnDel);
  }

  // show members
  const membersDiv = document.createElement("div");
  membersDiv.className = "small muted";
  membersDiv.textContent = "Members: " + group.members.join(", ");
  chatWindow.appendChild(membersDiv);
}

function selectUser(username) {
  currentTarget = { type: "user", id: username };
  chatTitle.textContent = `@ ${username}`;
  chatWindow.innerHTML = "";
  headerActions.innerHTML = "";
  // Show quick note
  const note = document.createElement("div");
  note.className = "muted small";
  note.textContent = "Private chat — messages go only to that user (if online).";
  chatWindow.appendChild(note);
}

// send message
function sendMessage() {
  if (!me) return alert("Login first");
  const text = messageInput.value.trim();
  if (!text) return;
  if (!currentTarget) return alert("Select a group or user first");

  if (currentTarget.type === "group") {
    socket.emit("group_message", { groupName: currentTarget.id, text }, res => {
      if (!res.ok) {
        alert(res.error || "Failed sending");
      } else {
        appendMessage({ from: me.username, displayName: me.displayName, avatar: me.avatar, group: currentTarget.id, text, time: Date.now() }, true);
      }
    });
  } else {
    socket.emit("private_message", { toUsername: currentTarget.id, text }, res => {
      if (!res.ok) {
        alert(res.error || "Failed: " + (res.error||""));
      } else {
        appendPrivateMessage({ from: me.username, displayName: me.displayName, avatar: me.avatar, to: currentTarget.id, text, time: Date.now() }, true);
      }
    });
  }
  messageInput.value = "";
}

function appendMessage(msg, isOwn=false) {
  const el = document.createElement("div");
  el.className = "chat-msg";
  el.innerHTML = `<div class="msg-meta"><strong>${msg.displayName}</strong> <span class="muted small">${new Date(msg.time).toLocaleTimeString()}</span></div>
    <div class="msg-text">${escapeHtml(msg.text)}</div>`;
  if (currentTarget && currentTarget.type === "group" && currentTarget.id === msg.group) {
    chatWindow.appendChild(el);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

function appendPrivateMessage(msg, isOwn=false) {
  // Show if current open private is between me and the other user
  if (!me) return;
  const other = isOwn ? msg.to : msg.from;
  if (currentTarget && currentTarget.type === "user" && currentTarget.id === other) {
    const el = document.createElement("div");
    el.className = "chat-msg";
    el.innerHTML = `<div class="msg-meta"><strong>${msg.displayName}</strong> <span class="muted small">${new Date(msg.time).toLocaleTimeString()}</span></div>
      <div class="msg-text">${escapeHtml(msg.text)}</div>`;
    chatWindow.appendChild(el);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

function appendSystem(text) {
  const el = document.createElement("div");
  el.className = "chat-system muted";
  el.textContent = text;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// File to dataURL
function fileToDataUrl(file, cb) {
  if (!file) return cb(null);
  const reader = new FileReader();
  reader.onload = () => cb(reader.result);
  reader.readAsDataURL(file);
}

// Events
loginBtn.onclick = () => {
  const username = loginUsername.value.trim();
  const display = loginDisplay.value.trim();
  if (!username) return alert("Username required");
  fileToDataUrl(avatarFile.files[0], (dataUrl) => {
    socket.emit("login", { username, displayName: display || username, avatar: dataUrl }, res => {
      if (!res.ok) return alert(res.error || "Login failed");
      me = { username, displayName: display || username, avatar: dataUrl };
      setProfileUI();
      // request state
      socket.emit("get_state", (s) => {
        state = s;
        renderLists();
      });
    });
  });
};

createGroupBtn.onclick = () => {
  const name = newGroupName.value.trim();
  if (!name) return alert("Group name required");
  socket.emit("create_group", { groupName: name }, res => {
    if (!res.ok) return alert(res.error || "Failed");
    newGroupName.value = "";
  });
};

sendBtn.onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Socket listeners
socket.on("connect", () => {
  appendSystem("Connected to server.");
  socket.emit("get_state", (s) => {
    state = s;
    renderLists();
  });
});

socket.on("state_update", (s) => {
  state = s;
  renderLists();
});

socket.on("system_message", (m) => {
  appendSystem(m.text);
});

socket.on("group_message", (msg) => {
  appendMessage(msg, false);
});

socket.on("private_message", (msg) => {
  appendPrivateMessage(msg, false);
});

socket.on("disconnect", () => {
  appendSystem("Disconnected from server.");
});
