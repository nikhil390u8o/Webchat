// server.js
// Node.js + Express + Socket.IO real-time chat demo
// Run: npm init -y
// npm i express socket.io cors
// node server.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server);

// In-memory store (demo). Restarting the server clears this.
const USERS = new Map(); // socketId -> { username, displayName, avatar }
const BY_USERNAME = new Map(); // username -> socketId
const GROUPS = new Map(); // groupName -> { owner, members: Set(username) }

function broadcastState() {
  const users = Array.from(BY_USERNAME.keys());
  const groups = Array.from(GROUPS.entries()).map(([name, g]) => ({
    name,
    owner: g.owner,
    members: Array.from(g.members),
  }));
  io.emit("state_update", { users, groups });
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  // When user logs in (registers) with username & profile
  socket.on("login", ({ username, displayName, avatar }, cb) => {
    if (!username) return cb && cb({ ok: false, error: "Username required" });
    if (BY_USERNAME.has(username)) {
      // If another socket already uses it, reject
      return cb && cb({ ok: false, error: "Username already in use" });
    }
    USERS.set(socket.id, { username, displayName: displayName || username, avatar: avatar || null });
    BY_USERNAME.set(username, socket.id);
    console.log("login:", username);
    broadcastState();
    cb && cb({ ok: true });
  });

  // Request current state
  socket.on("get_state", (cb) => {
    const users = Array.from(BY_USERNAME.keys());
    const groups = Array.from(GROUPS.entries()).map(([name, g]) => ({
      name,
      owner: g.owner,
      members: Array.from(g.members),
    }));
    cb && cb({ users, groups });
  });

  // Create group
  socket.on("create_group", ({ groupName }, cb) => {
    const me = USERS.get(socket.id);
    if (!me) return cb && cb({ ok: false, error: "Not logged in" });
    if (!groupName) return cb && cb({ ok: false, error: "Group name required" });
    if (GROUPS.has(groupName)) return cb && cb({ ok: false, error: "Group exists" });

    GROUPS.set(groupName, { owner: me.username, members: new Set([me.username]) });
    // Put socket into socket.io room for this group
    socket.join(`group:${groupName}`);
    broadcastState();
    io.to(`group:${groupName}`).emit("system_message", { text: `${me.displayName} created the group.` });
    cb && cb({ ok: true });
  });

  // Join group
  socket.on("join_group", ({ groupName }, cb) => {
    const me = USERS.get(socket.id);
    if (!me) return cb && cb({ ok: false, error: "Not logged in" });
    const group = GROUPS.get(groupName);
    if (!group) return cb && cb({ ok: false, error: "No such group" });

    group.members.add(me.username);
    socket.join(`group:${groupName}`);
    broadcastState();
    io.to(`group:${groupName}`).emit("system_message", { text: `${me.displayName} joined the group.` });
    cb && cb({ ok: true });
  });

  // Leave group
  socket.on("leave_group", ({ groupName }, cb) => {
    const me = USERS.get(socket.id);
    if (!me) return cb && cb({ ok: false, error: "Not logged in" });
    const group = GROUPS.get(groupName);
    if (!group) return cb && cb({ ok: false, error: "No such group" });

    group.members.delete(me.username);
    socket.leave(`group:${groupName}`);
    io.to(`group:${groupName}`).emit("system_message", { text: `${me.displayName} left the group.` });
    // If owner leaves, ownership remains; optionally transfer ownership if no members remain
    if (group.members.size === 0) {
      GROUPS.delete(groupName);
      io.emit("system_message", { text: `Group ${groupName} deleted (empty).` });
    }
    broadcastState();
    cb && cb({ ok: true });
  });

  // Delete group (only owner)
  socket.on("delete_group", ({ groupName }, cb) => {
    const me = USERS.get(socket.id);
    if (!me) return cb && cb({ ok: false, error: "Not logged in" });
    const group = GROUPS.get(groupName);
    if (!group) return cb && cb({ ok: false, error: "No such group" });
    if (group.owner !== me.username) return cb && cb({ ok: false, error: "Only owner can delete" });

    // Notify members then remove
    io.to(`group:${groupName}`).emit("system_message", { text: `Group ${groupName} has been deleted by owner.` });
    // Kick everyone from room
    const sockets = io.sockets.adapter.rooms.get(`group:${groupName}`);
    if (sockets) {
      for (const sid of sockets) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.leave(`group:${groupName}`);
      }
    }
    GROUPS.delete(groupName);
    broadcastState();
    cb && cb({ ok: true });
  });

  // Group message
  socket.on("group_message", ({ groupName, text }, cb) => {
    const me = USERS.get(socket.id);
    if (!me) return cb && cb({ ok: false, error: "Not logged in" });
    const group = GROUPS.get(groupName);
    if (!group) return cb && cb({ ok: false, error: "No such group" });
    if (!group.members.has(me.username)) return cb && cb({ ok: false, error: "Not a member" });

    const payload = {
      from: me.username,
      displayName: me.displayName,
      avatar: me.avatar,
      group: groupName,
      text,
      time: Date.now(),
    };
    io.to(`group:${groupName}`).emit("group_message", payload);
    cb && cb({ ok: true });
  });

  // Private message (to username)
  socket.on("private_message", ({ toUsername, text }, cb) => {
    const me = USERS.get(socket.id);
    if (!me) return cb && cb({ ok: false, error: "Not logged in" });
    const toSocketId = BY_USERNAME.get(toUsername);
    if (!toSocketId) return cb && cb({ ok: false, error: "Recipient not online" });

    const payload = {
      from: me.username,
      displayName: me.displayName,
      avatar: me.avatar,
      to: toUsername,
      text,
      time: Date.now(),
    };
    // emit to both sender and receiver for UI consistency
    socket.emit("private_message", payload);
    io.to(toSocketId).emit("private_message", payload);
    cb && cb({ ok: true });
  });

  // Update profile (displayName/avatar)
  socket.on("update_profile", ({ displayName, avatar }, cb) => {
    const me = USERS.get(socket.id);
    if (!me) return cb && cb({ ok: false, error: "Not logged in" });
    me.displayName = displayName || me.displayName;
    me.avatar = avatar || me.avatar;
    // update maps
    USERS.set(socket.id, me);
    broadcastState();
    cb && cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const me = USERS.get(socket.id);
    if (me) {
      console.log("disconnect:", me.username);
      BY_USERNAME.delete(me.username);
      USERS.delete(socket.id);
      // remove from groups
      for (const [gname, g] of GROUPS.entries()) {
        if (g.members.has(me.username)) {
          g.members.delete(me.username);
          io.to(`group:${gname}`).emit("system_message", { text: `${me.displayName} disconnected.` });
          if (g.members.size === 0) {
            GROUPS.delete(gname);
            io.emit("system_message", { text: `Group ${gname} deleted (empty).` });
          }
        }
      }
      broadcastState();
    } else {
      console.log("socket disconnected:", socket.id);
    }
  });
});

// Fallback route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server started on port", PORT));
