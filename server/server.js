require("dotenv").config({
  path: require("path").join(__dirname, ".env"),
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { GoogleGenAI } = require("@google/genai");

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

// ==================== MONGODB MODELS ====================

const attendanceSchema = new mongoose.Schema({
  socketId: { type: String, default: null },
  name: { type: String, required: true },
  roomId: { type: String, required: true, index: true },
  joinedAt: { type: Date, required: true, default: Date.now },
  leftAt: { type: Date, default: null },
  durationSeconds: { type: Number, default: null },
});

const Attendance = mongoose.model("Attendance", attendanceSchema);

const meetingSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  hostKeyHash: { type: String, required: true },
  hostSocketId: { type: String, default: null },
  locked: { type: Boolean, default: false },
  ended: { type: Boolean, default: false },
  bannedParticipants: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const Meeting = mongoose.model("Meeting", meetingSchema);
// ==================== USER MODEL ====================

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
// ==================== USER MODEL ====================



// ==================== AUTH HELPERS ====================

function createAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({ error: "Please log in first." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: "User not found." });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid or expired login session.",
    });
  }
}

// ==================== HELPER FUNCTIONS ====================

function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function makeRoomCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function getMembers(roomId) {
  return rooms.get(roomId);
}

function sendParticipants(roomId) {
  const members = getMembers(roomId);
  if (!members) return;

  const participants = [...members.entries()].map(([id, data]) => ({
    id,
    name: data.name,
    isHost: Boolean(data.isHost),
  }));

  // Participant count ko sab connected users tak update karta hai.
  io.to(roomId).emit("room-users", participants);
}

async function markAttendanceLeave(socket) {
  try {
    const record = await Attendance.findOne({
      socketId: socket.id,
      leftAt: null,
    }).sort({ joinedAt: -1 });

    if (!record) return;

    const leftAt = new Date();

    record.leftAt = leftAt;
    record.durationSeconds = Math.max(
      0,
      Math.floor((leftAt.getTime() - record.joinedAt.getTime()) / 1000)
    );

    await record.save();

    console.log(
      `${record.name} left ${record.roomId}. Duration: ${record.durationSeconds}s`
    );
  } catch (error) {
    console.error("Attendance leave error:", error.message);
  }
}

async function leaveRoom(socket, options = {}) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  await markAttendanceLeave(socket);

  const members = getMembers(roomId);
  members?.delete(socket.id);

  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.isHost = false;

  if (options.removed) {
    socket.emit("participant-removed", {
      message: options.message || "You were removed from this meeting.",
    });
  }

  if (options.ended) {
    socket.emit("meeting-ended", {
      message: "The host ended this meeting.",
    });
  }

  if (members?.size === 0) {
    rooms.delete(roomId);
  } else {
    sendParticipants(roomId);
  }
}

async function getHostMeeting(socket) {
  if (!socket.data.roomId || !socket.data.isHost) return null;

  const meeting = await Meeting.findOne({
    roomId: socket.data.roomId,
    ended: false,
  });

  if (!meeting || meeting.hostSocketId !== socket.id) return null;

  return meeting;
}
// ==================== AUTH ROUTES ====================

// SIGNUP
app.post("/api/auth/signup", async (req, res) => {
  try {
    const name =
      typeof req.body.name === "string"
        ? req.body.name.trim()
        : "";

    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!name || name.length > 60) {
      return res.status(400).json({
        error: "Name is required and must be under 60 characters.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        error: "Enter a valid email address.",
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: "Password must be 8–128 characters long.",
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        error: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    const token = createAuthToken(user);

    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        error: "An account with this email already exists.",
      });
    }

    console.error("Signup error:", error.message);

    return res.status(500).json({
      error: "Could not create your account.",
    });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        error: "Incorrect email or password.",
      });
    }

    const token = createAuthToken(user);

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      error: "Could not log in.",
    });
  }
});

// GET CURRENT USER
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
    },
  });
});
// ==================== BASIC ROUTES ====================

app.get("/", (req, res) => {
  res.send("Cloud Video Platform server is running!");
});

// ==================== CREATE MEETING ====================

app.post("/api/meetings", async (req, res) => {
  try {
    const title =
      typeof req.body.title === "string"
        ? req.body.title.trim().slice(0, 100)
        : "";

    if (!title) {
      return res.status(400).json({
        error: "Meeting title is required.",
      });
    }

    let roomId;

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makeRoomCode();
      const exists = await Meeting.exists({ roomId: candidate });

      if (!exists) {
        roomId = candidate;
        break;
      }
    }

    if (!roomId) {
      return res.status(503).json({
        error: "Could not generate a meeting code. Try again.",
      });
    }

    const hostKey = crypto.randomBytes(32).toString("hex");

    await Meeting.create({
      roomId,
      title,
      hostKeyHash: hashSecret(hostKey),
    });

    return res.status(201).json({
      meetingCode: roomId,
      hostKey,
      title,
    });
  } catch (error) {
    console.error("Create meeting error:", error.message);

    return res.status(500).json({
      error: "Could not create meeting.",
    });
  }
});

// ==================== ATTENDANCE REPORT ====================

app.get("/api/attendance", async (req, res) => {
  try {
    const filter = {};

    if (req.query.roomId) {
      filter.roomId = String(req.query.roomId).trim().toUpperCase();
    }

    const records = await Attendance.find(filter)
      .sort({ joinedAt: -1 })
      .lean();

    const now = Date.now();

    const report = records.map((item) => {
      const joinedAt = new Date(item.joinedAt).getTime();

      const endTime = item.leftAt
        ? new Date(item.leftAt).getTime()
        : now;

      const durationSeconds =
        item.leftAt && item.durationSeconds != null
          ? item.durationSeconds
          : Math.max(0, Math.floor((endTime - joinedAt) / 1000));

      return {
        participantName: item.name,
        roomId: item.roomId,
        joinedAt: item.joinedAt,
        leftAt: item.leftAt,
        durationSeconds,
        durationMinutes: Math.floor(durationSeconds / 60),
        status: item.leftAt ? "Left" : "Present",
      };
    });

    res.json({
      totalAttendanceEntries: report.length,
      currentlyPresent: report.filter(
        (item) => item.status === "Present"
      ).length,
      attendance: report,
    });
  } catch (error) {
    console.error("Attendance API error:", error.message);

    res.status(500).json({
      error: "Could not fetch attendance records.",
    });
  }
});

// ==================== SOCKET CONNECTION ====================

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Frontend sends { roomId, name, participantKey, hostKey }.
  socket.on("join-room", async (payload = {}) => {
    try {
      if (socket.data.roomId) {
        socket.emit("join-error", {
          message: "Leave your current meeting before joining another.",
        });
        return;
      }

      let { roomId, name, participantKey, hostKey } = payload;

      if (typeof roomId !== "string") return;

      roomId = roomId.trim().toUpperCase();
      if (!roomId) return;

      const cleanName =
        typeof name === "string" && name.trim()
          ? name.trim().slice(0, 40)
          : `Guest ${socket.id.slice(0, 4)}`;

      if (
        typeof participantKey !== "string" ||
        participantKey.length < 16 ||
        participantKey.length > 200
      ) {
        participantKey = `socket-${socket.id}`;
      }

      const meeting = await Meeting.findOne({ roomId });

      if (!meeting) {
        socket.emit("join-error", {
          message: "Meeting not found. Check the meeting code.",
        });
        return;
      }

      if (meeting.ended) {
        socket.emit("join-error", {
          message: "This meeting has ended.",
        });
        return;
      }

      if (meeting.bannedParticipants.includes(participantKey)) {
        socket.emit("join-error", {
          message: "You have been removed from this meeting.",
        });
        return;
      }

      const isHost =
        typeof hostKey === "string" &&
        hostKey.length === 64 &&
        hashSecret(hostKey) === meeting.hostKeyHash;

      if (meeting.locked && !isHost) {
        socket.emit("join-error", {
          message: "This meeting is locked by the host.",
        });
        return;
      }

      if (rooms.get(roomId)?.size >= 10) {
        socket.emit("room-full");
        return;
      }

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }

      socket.data.roomId = roomId;
      socket.data.name = cleanName;
      socket.data.participantKey = participantKey;
      socket.data.isHost = isHost;

      rooms.get(roomId).set(socket.id, {
        name: cleanName,
        participantKey,
        isHost,
      });

      socket.join(roomId);

      if (isHost) {
        meeting.hostSocketId = socket.id;
        await meeting.save();
      }

      let record;

      try {
        record = await Attendance.create({
          socketId: socket.id,
          name: cleanName,
          roomId,
          joinedAt: new Date(),
          leftAt: null,
          durationSeconds: null,
        });
      } catch (attendanceError) {
        // Attendance save fail ho to room ka participant count stale na rahe.
        rooms.get(roomId)?.delete(socket.id);
        socket.leave(roomId);
        socket.data.roomId = null;
        socket.data.isHost = false;

        if (rooms.get(roomId)?.size === 0) {
          rooms.delete(roomId);
        } else {
          sendParticipants(roomId);
        }

        console.error("Attendance create error:", attendanceError.message);

        socket.emit("attendance-error", {
          message: "Attendance save nahi hui. Please meeting dobara join karo.",
        });
        return;
      }

      socket.emit("room-joined", {
        roomId,
        socketId: socket.id,
        isHost,
        locked: meeting.locked,
        title: meeting.title,
      });

      socket.emit("host-state", {
        isHost,
        locked: meeting.locked,
        ended: meeting.ended,
      });

      sendParticipants(roomId);

      console.log(
        `${cleanName} joined ${roomId}${isHost ? " as host" : ""}`
      );
      console.log("Attendance saved:", record._id.toString());
    } catch (error) {
      console.error("Join-room error:", error.message);

      socket.emit("attendance-error", {
        message: "Could not join meeting or save attendance.",
      });
    }
  });

  // ==================== UPDATE NAME ====================

  socket.on("update-name", async (name) => {
    try {
      const roomId = socket.data.roomId;

      if (!roomId || typeof name !== "string" || !name.trim()) return;

      const cleanName = name.trim().slice(0, 40);

      socket.data.name = cleanName;

      rooms.get(roomId)?.set(socket.id, {
        ...rooms.get(roomId)?.get(socket.id),
        name: cleanName,
      });

      await Attendance.updateOne(
        { socketId: socket.id, roomId, leftAt: null },
        { $set: { name: cleanName } }
      );

      sendParticipants(roomId);
    } catch (error) {
      console.error("Update-name error:", error.message);
    }
  });

  // ==================== HOST CONTROLS ====================

  socket.on("host-action", async (data = {}) => {
    try {
      const meeting = await getHostMeeting(socket);

      if (!meeting) {
        socket.emit("host-action-error", {
          message: "Only the verified host can perform this action.",
        });
        return;
      }

      const roomId = socket.data.roomId;
      const members = getMembers(roomId);

      if (!members) return;

      switch (data.action) {
        case "lock": {
          meeting.locked = true;
          await meeting.save();

          io.to(roomId).emit("meeting-lock-state", { locked: true });
          break;
        }

        case "unlock": {
          meeting.locked = false;
          await meeting.save();

          io.to(roomId).emit("meeting-lock-state", { locked: false });
          break;
        }

        case "mute-all": {
          io.to(roomId).emit("host-mute-all", {
            requestedBy: socket.id,
          });
          break;
        }

        case "remove-participant": {
          const targetId = data.targetId;

          if (
            typeof targetId !== "string" ||
            targetId === socket.id ||
            !members.has(targetId)
          ) {
            socket.emit("host-action-error", {
              message: "Invalid participant selection.",
            });
            return;
          }

          const target = io.sockets.sockets.get(targetId);
          const targetData = members.get(targetId);

          if (!target || !targetData) return;

          if (
            targetData.participantKey &&
            !meeting.bannedParticipants.includes(targetData.participantKey)
          ) {
            meeting.bannedParticipants.push(targetData.participantKey);
            await meeting.save();
          }

          await leaveRoom(target, {
            removed: true,
            message: "The host removed you from this meeting.",
          });

          break;
        }

        case "end-meeting": {
          meeting.ended = true;
          meeting.locked = true;
          await meeting.save();

          const sockets = [...members.keys()]
            .map((id) => io.sockets.sockets.get(id))
            .filter(Boolean);

          for (const memberSocket of sockets) {
            await leaveRoom(memberSocket, {
              ended: true,
              message: "The host ended this meeting.",
            });
          }

          break;
        }

        case "transfer-host": {
          const targetId = data.targetId;
          const target = io.sockets.sockets.get(targetId);
          const targetData = members.get(targetId);

          if (!target || !targetData || targetId === socket.id) {
            socket.emit("host-action-error", {
              message: "Select another participant to transfer host.",
            });
            return;
          }

          const newHostKey = crypto.randomBytes(32).toString("hex");

          meeting.hostKeyHash = hashSecret(newHostKey);
          meeting.hostSocketId = targetId;
          await meeting.save();

          socket.data.isHost = false;
          target.data.isHost = true;

          members.set(socket.id, {
            ...members.get(socket.id),
            isHost: false,
          });

          members.set(targetId, {
            ...targetData,
            isHost: true,
          });

          target.emit("host-transferred", {
            hostKey: newHostKey,
            roomId,
          });

          socket.emit("host-transferred-away", {
            message: "Host role transferred successfully.",
          });

          io.to(roomId).emit("host-changed", {
            hostId: targetId,
            hostName: targetData.name,
          });

          sendParticipants(roomId);
          break;
        }

        default:
          socket.emit("host-action-error", {
            message: "Unknown host action.",
          });
      }
    } catch (error) {
      console.error("Host action error:", error.message);

      socket.emit("host-action-error", {
        message: "Could not perform host action.",
      });
    }
  });

  // ==================== CHAT ====================

  socket.on("chat-message", (message) => {
    const roomId = socket.data.roomId;

    if (!roomId || typeof message !== "string" || !message.trim()) {
      return;
    }

    io.to(roomId).emit("chat-message", {
      id: `${socket.id}-${Date.now()}`,
      name: socket.data.name || "Guest",
      text: message.trim().slice(0, 1000),
      time: new Date().toISOString(),
    });
  });

  // ==================== WEBRTC SIGNALING ====================

  socket.on("offer", ({ roomId, offer } = {}) => {
    if (socket.data.roomId !== roomId || !offer) return;
    socket.to(roomId).emit("offer", offer);
  });

  socket.on("answer", ({ roomId, answer } = {}) => {
    if (socket.data.roomId !== roomId || !answer) return;
    socket.to(roomId).emit("answer", answer);
  });

  socket.on("ice-candidate", ({ roomId, candidate } = {}) => {
    if (socket.data.roomId !== roomId || !candidate) return;
    socket.to(roomId).emit("ice-candidate", candidate);
  });

  // ==================== DISCONNECT ====================

  socket.on("disconnect", async () => {
    const roomId = socket.data.roomId;

    if (roomId) {
      await markAttendanceLeave(socket);

      rooms.get(roomId)?.delete(socket.id);

      if (socket.data.isHost) {
        await Meeting.updateOne(
          { roomId, hostSocketId: socket.id },
          { $set: { hostSocketId: null } }
        );
      }

      if (rooms.get(roomId)?.size === 0) {
        rooms.delete(roomId);
      } else {
        sendParticipants(roomId);
      }
    }

    console.log("Disconnected:", socket.id);
  });
});

app.post("/api/ai/summarize", async (req, res) => {
  
  try {
    const { notes } = req.body;

    if (typeof notes !== "string" || !notes.trim()) {
      return res.status(400).json({
        error: "Please enter meeting notes.",
      });
    }

    if (notes.length > 20000) {
      return res.status(400).json({
        error: "Meeting notes must be under 20,000 characters.",
      });
    }

    const response = await genAI.models.generateContent({
      model: "gemini-3.8-flash", 
      contents: `Analyze these meeting notes and return:
1. Meeting Summary
2. Key Points (bullet points)
3. Action Items (bullet points)

Use clear, simple English. Do not invent information.

Meeting Notes:
${notes}`,
    });

    res.json({
      result: response.text,
    });
  } catch (error) {
    console.error("AI summary error:", error);
    res.status(500).json({
      error: "Could not generate summary. Please try again.",
    });
  }
});

// ==================== START SERVER ====================

async function startServer() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  await mongoose.connect(mongoUri);
  console.log("MongoDB connected successfully!");

  // Previous server run ke open attendance records close karo.
  const restartTime = new Date();
  const activeRecords = await Attendance.find({ leftAt: null });

  for (const record of activeRecords) {
    record.leftAt = restartTime;
    record.durationSeconds = Math.max(
      0,
      Math.floor(
        (restartTime.getTime() - record.joinedAt.getTime()) / 1000
      )
    );

    await record.save();
  }

  if (activeRecords.length > 0) {
    console.log(
      `Closed ${activeRecords.length} stale attendance record(s).`
    );
  }

  server.listen(3001, "0.0.0.0", () => {
    console.log("Signaling server running on port 3001");
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});