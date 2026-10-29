import { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MessageSquare,
  Users,
  PhoneOff,
  Copy,
  X,
  ShieldCheck,
} from "lucide-react";
import { io } from "socket.io-client";
import "./MeetingRoom.css";

export default function MeetingRoom({
  onLeave,
  meetingCode,
  hostKey = "",
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const socketRef = useRef(null);
  const screenRef = useRef(null);
  const screenVideoRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const pendingCandidatesRef = useRef({});

  const roomId = (meetingCode || "").trim().toUpperCase();

  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState([]);

  const [nameInput, setNameInput] = useState(
    () => localStorage.getItem("cvp-name") || ""
  );
  const [name, setName] = useState(
    () => localStorage.getItem("cvp-name") || ""
  );

  const [participants, setParticipants] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [meetingLocked, setMeetingLocked] = useState(false);
  const [hostMutedAll, setHostMutedAll] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);

  const [attendance, setAttendance] = useState([]);
  const [attendanceOpen, setAttendanceOpen] = useState(false);

  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(true);

  const [notice, setNotice] = useState("");
  const [clockTick, setClockTick] = useState(Date.now());

  function notify(text) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 3000);
  }

  function getParticipantKey() {
    let key = localStorage.getItem("cvp-participant-key");

    if (!key) {
      key =
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `participant-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`;

      localStorage.setItem("cvp-participant-key", key);
    }

    return key;
  }

  function hostAction(action, targetId) {
    if (!isHost) {
      notify("Only the host can perform this action.");
      return;
    }

    const socket = socketRef.current;

    if (!socket?.connected) {
      notify("Meeting server is disconnected.");
      return;
    }

    setHostBusy(true);

    socket.emit("host-action", {
      roomId,
      action,
      targetId,
    });

    window.setTimeout(() => setHostBusy(false), 1200);
  }

  // ==================== WEBRTC HELPERS ====================

  function sendOffer(peerId, pc) {
    const socket = socketRef.current;

    if (!socket || pc.signalingState !== "stable") return;

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit("offer", {
          roomId,
          offer: {
            sdp: pc.localDescription,
            from: socket.id,
            to: peerId,
          },
        });
      })
      .catch((error) => {
        console.error("Offer error:", error);
      });
  }

  function getPeerConnection(peerId) {
    if (peerConnectionsRef.current[peerId]) {
      return peerConnectionsRef.current[peerId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    peerConnectionsRef.current[peerId] = pc;
    pendingCandidatesRef.current[peerId] = [];

    [streamRef.current, screenRef.current]
      .filter(Boolean)
      .forEach((stream) => {
        stream.getTracks().forEach((track) => {
          const exists = pc
            .getSenders()
            .some((sender) => sender.track === track);

          if (!exists) {
            pc.addTrack(track, stream);
          }
        });
      });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      socketRef.current?.emit("ice-candidate", {
        roomId,
        candidate: {
          candidate: event.candidate,
          from: socketRef.current.id,
          to: peerId,
        },
      });
    };

    pc.ontrack = (event) => {
      const remoteStream =
        event.streams?.[0] || new MediaStream([event.track]);

      setRemoteStreams((previous) => {
        const existing = previous.find(
          (item) => item.id === peerId
        );

        if (existing) {
          return previous.map((item) =>
            item.id === peerId
              ? { ...item, stream: remoteStream }
              : item
          );
        }

        return [...previous, { id: peerId, stream: remoteStream }];
      });
    };

    pc.onconnectionstatechange = () => {
      if (
        ["failed", "closed"].includes(pc.connectionState)
      ) {
        setRemoteStreams((previous) =>
          previous.filter((item) => item.id !== peerId)
        );
      }
    };

    return pc;
  }

  async function addPendingCandidates(peerId, pc) {
    const pending = pendingCandidatesRef.current[peerId] || [];
    pendingCandidatesRef.current[peerId] = [];

    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error("Pending ICE candidate error:", error);
      }
    }
  }

  async function addLocalTracksToPeers(stream) {
    for (const [peerId, pc] of Object.entries(
      peerConnectionsRef.current
    )) {
      try {
        let addedTrack = false;

        stream.getTracks().forEach((track) => {
          const exists = pc
            .getSenders()
            .some((sender) => sender.track === track);

          if (!exists) {
            pc.addTrack(track, stream);
            addedTrack = true;
          }
        });

        if (addedTrack && pc.signalingState === "stable") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socketRef.current?.emit("offer", {
            roomId,
            offer: {
              sdp: pc.localDescription,
              from: socketRef.current.id,
              to: peerId,
            },
          });
        }
      } catch (error) {
        console.error("Could not add tracks to peer:", error);
      }
    }
  }

  // ==================== SOCKET CONNECTION ====================

  useEffect(() => {
    if (!roomId) return;

    let active = true;

    const socket = io(
  "https://cloudsync-backend-3bxq.onrender.com"
);

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", {
        roomId,
        name:
          localStorage.getItem("cvp-name") ||
          `Guest ${socket.id.slice(0, 4)}`,
        hostKey:
          hostKey ||
          localStorage.getItem(`cvp-host-key-${roomId}`) ||
          "",
        participantKey: getParticipantKey(),
      });
    });

    socket.on("room-joined", (data) => {
      if (!active) return;

      setIsHost(Boolean(data?.isHost));
      setMeetingLocked(Boolean(data?.locked));
    });

    socket.on("host-state", (data) => {
      if (!active) return;

      setIsHost(Boolean(data?.isHost));
      setMeetingLocked(Boolean(data?.locked));
    });

    socket.on("meeting-lock-state", (data) => {
      if (!active) return;

      setMeetingLocked(Boolean(data?.locked));

      notify(
        data?.locked
          ? "Meeting locked by host."
          : "Meeting unlocked by host."
      );
    });

    socket.on("host-mute-all", () => {
      const tracks =
        streamRef.current?.getAudioTracks() || [];

      tracks.forEach((track) => {
        track.enabled = false;
      });

      setMicOn(false);
      setHostMutedAll(true);
      notify("Host muted all participants.");
    });

    socket.on("host-action-error", (data) => {
      setHostBusy(false);
      notify(data?.message || "Host action failed.");
    });

    socket.on("attendance-error", (data) => {
      notify(
        data?.message ||
          "Attendance save nahi hui. Server check karo."
      );
    });

    socket.on("join-error", (data) => {
      notify(data?.message || "Could not join the meeting.");
    });

    socket.on("meeting-ended", () => {
      notify("The host has ended this meeting.");
      leaveMeeting();
    });

    socket.on("participant-removed", () => {
      notify("You were removed from the meeting.");
      leaveMeeting();
    });

    socket.on("host-transferred", (data) => {
      if (data?.hostKey) {
        localStorage.setItem(
          `cvp-host-key-${roomId}`,
          data.hostKey
        );
      }

      setIsHost(true);
      notify("You are now the host.");
    });

    socket.on("host-transferred-away", () => {
      setIsHost(false);
      notify("Host role transferred to another participant.");
    });

    socket.on("host-changed", (data) => {
      // Backend sends hostId, not hostSocketId.
      setParticipants((previous) =>
        previous.map((person) => ({
          ...person,
          isHost: person.id === data?.hostId,
        }))
      );
    });

    socket.on("room-users", (users) => {
      if (!active) return;

      const list = Array.isArray(users) ? users : [];
      setParticipants(list);

      list.forEach((person) => {
        if (
          person.id !== socket.id &&
          socket.id < person.id &&
          !peerConnectionsRef.current[person.id]
        ) {
          const pc = getPeerConnection(person.id);
          sendOffer(person.id, pc);
        }
      });
    });

    socket.on("offer", async (payload) => {
      try {
        const signal = payload?.sdp ? payload : null;

        if (
          !signal?.from ||
          signal.from === socket.id ||
          (signal.to && signal.to !== socket.id)
        ) {
          return;
        }

        const pc = getPeerConnection(signal.from);

        await pc.setRemoteDescription(
          new RTCSessionDescription(signal.sdp)
        );

        await addPendingCandidates(signal.from, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("answer", {
          roomId,
          answer: {
            sdp: pc.localDescription,
            from: socket.id,
            to: signal.from,
          },
        });
      } catch (error) {
        console.error("Offer handling error:", error);
      }
    });

    socket.on("answer", async (payload) => {
      try {
        const signal = payload?.answer || payload;

        if (
          !signal?.from ||
          signal.from === socket.id ||
          (signal.to && signal.to !== socket.id)
        ) {
          return;
        }

        const pc = peerConnectionsRef.current[signal.from];

        if (pc?.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(
            new RTCSessionDescription(signal.sdp)
          );

          await addPendingCandidates(signal.from, pc);
        }
      } catch (error) {
        console.error("Answer handling error:", error);
      }
    });

    socket.on("ice-candidate", async (payload) => {
      try {
        const signal = payload?.candidate ? payload : null;

        if (
          !signal?.from ||
          signal.from === socket.id ||
          (signal.to && signal.to !== socket.id)
        ) {
          return;
        }

        const pc = peerConnectionsRef.current[signal.from];
        if (!pc) return;

        if (pc.remoteDescription) {
          await pc.addIceCandidate(
            new RTCIceCandidate(signal.candidate)
          );
        } else {
          pendingCandidatesRef.current[signal.from] =
            pendingCandidatesRef.current[signal.from] || [];

          pendingCandidatesRef.current[signal.from].push(
            signal.candidate
          );
        }
      } catch (error) {
        console.error("ICE candidate error:", error);
      }
    });

    socket.on("chat-message", (item) => {
      if (active) {
        setMessages((previous) => [...previous, item]);
      }
    });

    socket.on("room-full", () => {
      notify("This meeting is full.");
    });

    socket.on("connect_error", (error) => {
      console.error("Signaling connection error:", error);
      notify("Meeting server connection failed.");
    });

    return () => {
      active = false;
      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      screenRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      Object.values(peerConnectionsRef.current).forEach(
        (pc) => pc.close()
      );

      peerConnectionsRef.current = {};
      pendingCandidatesRef.current = {};
    };
  }, [roomId]);

  // ==================== ATTENDANCE REFRESH ====================

  useEffect(() => {
    if (!roomId) return;

    let active = true;

    async function loadAttendance() {
      try {
        const response = await fetch(
  `https://cloudsync-backend-3bxq.onrender.com/api/attendance?roomId=${encodeURIComponent(
    roomId
  )}`
);

        if (!response.ok) {
          throw new Error("Attendance request failed");
        }

        const data = await response.json();

        if (active) {
          setAttendance(
            Array.isArray(data.attendance)
              ? data.attendance
              : []
          );
        }
      } catch (error) {
        console.error("Could not load attendance:", error);
      }
    }

    loadAttendance();

    const intervalId = window.setInterval(
      loadAttendance,
      3000
    );

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [roomId]);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setClockTick(Date.now()),
      1000
    );

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOn]);

  useEffect(() => {
    if (
      screenSharing &&
      screenVideoRef.current &&
      screenRef.current
    ) {
      screenVideoRef.current.srcObject = screenRef.current;
      screenVideoRef.current.play().catch(() => {});
    }
  }, [screenSharing]);

  // ==================== CAMERA / MIC ====================

  
async function toggleCamera() {
  if (cameraOn) {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOn(false);
    setMicOn(false);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    notify("Camera needs HTTPS or localhost. Open the app securely.");
    return;
  }

  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
      },
      audio: true,
    });

    streamRef.current = stream;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
    }

    await addLocalTracksToPeers(stream);

    setCameraOn(true);
    setMicOn(false);
    setHostMutedAll(false);
    notify("Camera connected. Enable your microphone when ready.");
  } catch (error) {
    console.error("Camera/microphone error:", error);

    stream?.getTracks().forEach((track) => track.stop());

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOn(false);
    setMicOn(false);

    if (error.name === "NotAllowedError") {
      notify("Camera or microphone permission denied. Check browser settings.");
    } else if (error.name === "NotFoundError") {
      notify("No compatible camera or microphone was found.");
    } else if (error.name === "NotReadableError") {
      notify("Camera may be in use by another application.");
    } else {
      notify("Could not start camera. Check permissions and device settings.");
    }
  }
}

  // ==================== SCREEN SHARE ====================

  async function startScreenShare() {
    if (!window.isSecureContext) {
  notify("Screen sharing needs a secure HTTPS connection.");
  return;
}

if (!navigator.mediaDevices?.getDisplayMedia) {
  notify("Screen sharing is not supported by this mobile browser. Try an updated browser.");
  return;
}
    if (!navigator.mediaDevices?.getDisplayMedia) {
      notify("Screen sharing needs HTTPS or localhost.");
      return;
    }
     console.log(
  "Screen share support:",
  !!navigator.mediaDevices?.getDisplayMedia
);
    try {
      const screenStream =
        await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });

      screenRef.current = screenStream;

      await addLocalTracksToPeers(screenStream);
      setScreenSharing(true);

      const track = screenStream.getVideoTracks()[0];

      if (track) {
        track.addEventListener(
          "ended",
          () => {
            screenRef.current = null;
            setScreenSharing(false);

            if (screenVideoRef.current) {
              screenVideoRef.current.srcObject = null;
            }
          },
          { once: true }
        );
      }

      notify("Screen sharing started.");
    } catch (error) {
      console.error("Screen sharing error:", error);

      notify(
        error.name === "NotAllowedError"
          ? "Screen sharing was cancelled."
          : "Could not start screen sharing."
      );
    }
  }

  function stopScreenShare() {
    screenRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    screenRef.current = null;

    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }

    setScreenSharing(false);
    notify("Screen sharing stopped.");
  }
  
function toggleMic() {
  const stream = streamRef.current;

  if (!stream) {
    notify("Please start your camera first.");
    return;
  }

  const audioTracks = stream.getAudioTracks();

  if (audioTracks.length === 0) {
    notify("No microphone track found.");
    return;
  }

  const nextMicOn = !micOn;

  audioTracks.forEach((track) => {
    track.enabled = nextMicOn;
  });

  setMicOn(nextMicOn);
}


  // ==================== NAME / CHAT ====================

  function updateName(event) {
    event.preventDefault();

    const cleanName = nameInput.trim().slice(0, 40);

    if (!cleanName) {
      notify("Please enter your name.");
      return;
    }

    if (name) {
      notify("Your name is already set.");
      return;
    }

    localStorage.setItem("cvp-name", cleanName);
    setName(cleanName);
    socketRef.current?.emit("update-name", cleanName);
    notify("Name saved successfully.");
  }

  function sendMessage(event) {
    event.preventDefault();

    if (!message.trim()) return;

    socketRef.current?.emit("chat-message", message.trim());
    setMessage("");
  }

  async function copyMeetingCode() {
    try {
      await navigator.clipboard.writeText(roomId);
      notify("Meeting code copied.");
    } catch {
      notify(`Meeting code: ${roomId}`);
    }
  }

  function leaveMeeting() {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    screenRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    streamRef.current = null;
    screenRef.current = null;

    Object.values(peerConnectionsRef.current).forEach(
      (pc) => pc.close()
    );

    peerConnectionsRef.current = {};
    pendingCandidatesRef.current = {};

    socketRef.current?.disconnect();
    socketRef.current = null;

    onLeave?.();
  }

  // ==================== ATTENDANCE FORMATTERS ====================

  function formatTime(value) {
    if (!value) return "Still in meeting";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(
      0,
      Math.floor(Number(totalSeconds) || 0)
    );

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    }

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }

    return `${remainingSeconds}s`;
  }

  const presentCount = attendance.filter(
    (record) => record.status === "Present"
  ).length;

  // ==================== UI ====================

  return (
    <div className="room-shell">
      <header className="room-topbar">
        <div className="room-brand">
          <div className="room-brand-icon">
            <Video size={21} />
          </div>

          <div>
            <strong>Cloud Video Platform</strong>
            <span>Meeting room</span>
          </div>
        </div>

        <div className="room-code">
          <span>MEETING CODE</span>
          <strong>{roomId}</strong>

          <button
            type="button"
            onClick={copyMeetingCode}
            title="Copy code"
          >
            <Copy size={15} />
          </button>
        </div>

        <div className="secure-label">
          <ShieldCheck size={16} />
          Connected room
        </div>
      </header>

      <main className="room-main">
        <div className="room-heading">
          <div>
            <h1>Meeting room</h1>
            <p>Share the meeting code to invite participants.</p>
          </div>

          <div className="room-live">
            <span /> LIVE ROOM
          </div>
        </div>

        {!name && (
          <form className="name-form" onSubmit={updateName}>
            <input
              value={nameInput}
              onChange={(event) =>
                setNameInput(event.target.value)
              }
              placeholder="Enter your name"
              maxLength={40}
              required
            />

            <button type="submit">Set name</button>
          </form>
        )}

        <div className="room-content">
          <section className="video-stage">
            {screenSharing && (
              <div className="video-tile screen-share-tile">
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    background: "#111827",
                    transform: "none",
                  }}
                />

                <div className="tile-label">
                  Your shared screen
                </div>
              </div>
            )}

            <div className="video-tile local-tile">
              {cameraOn ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                />
              ) : (
                <div className="camera-placeholder">
                  <div className="large-avatar">
                    {(name || "G").charAt(0).toUpperCase()}
                  </div>

                  <strong>{name || "Guest"}</strong>
                  <span>Camera is turned off</span>
                </div>
              )}

              <div className="tile-label">
                <span className={micOn ? "audio-active" : ""}>
                  {micOn ? (
                    <Mic size={14} />
                  ) : (
                    <MicOff size={14} />
                  )}
                </span>

                {name || "Guest"} (you)
              </div>

              <span className="local-badge">This device</span>
            </div>

            {remoteStreams.map((remote) => {
              const person = participants.find(
                (item) => item.id === remote.id
              );

              return (
                <div
                  className="video-tile remote-placeholder"
                  key={remote.id}
                >
                  <video
                    autoPlay
                    playsInline
                    ref={(element) => {
                      if (
                        element &&
                        element.srcObject !== remote.stream
                      ) {
                        element.srcObject = remote.stream;
                        element.play().catch(() => {});
                      }
                    }}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      background: "#111827",
                    }}
                  />

                  <div className="tile-label">
                    <Users size={14} />
                    {person?.name || "Participant"}
                  </div>
                </div>
              );
            })}

            {participants.filter(
              (person) =>
                person.id !== socketRef.current?.id &&
                !remoteStreams.some(
                  (remote) => remote.id === person.id
                )
            ).length === 0 && remoteStreams.length === 0 ? (
              <div className="waiting-tile">
                <div className="waiting-icon">
                  <Users size={28} />
                </div>

                <h3>Waiting for participant</h3>
                <p>
                  Share meeting code {roomId} to invite someone.
                </p>
              </div>
            ) : (
              participants
                .filter(
                  (person) =>
                    person.id !== socketRef.current?.id &&
                    !remoteStreams.some(
                      (remote) => remote.id === person.id
                    )
                )
                .map((person) => (
                  <div
                    className="video-tile remote-placeholder"
                    key={person.id}
                  >
                    <div className="camera-placeholder">
                      <div className="large-avatar">
                        {(person.name || "G")
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <strong>{person.name || "Guest"}</strong>
                      <span>Waiting for media stream</span>
                    </div>

                    <div className="tile-label">
                      <Users size={14} />
                      {person.name || "Guest"}
                    </div>
                  </div>
                ))
            )}
          </section>

          <aside className="room-panel">
            <div className="panel-tabs">
              <button
                type="button"
                className={participantsOpen ? "selected" : ""}
                onClick={() => {
                  setParticipantsOpen(true);
                  setChatOpen(false);
                  setAttendanceOpen(false);
                }}
              >
                <Users size={16} />
                People ({participants.length})
              </button>

              <button
                type="button"
                className={chatOpen ? "selected" : ""}
                onClick={() => {
                  setChatOpen(true);
                  setParticipantsOpen(false);
                  setAttendanceOpen(false);
                }}
              >
                <MessageSquare size={16} />
                Chat
              </button>

              <button
                type="button"
                className={attendanceOpen ? "selected" : ""}
                onClick={() => {
                  setAttendanceOpen(true);
                  setParticipantsOpen(false);
                  setChatOpen(false);
                }}
              >
                <ShieldCheck size={16} />
                Attendance
              </button>

              <button
                type="button"
                className="panel-close"
                title="Close panel"
                onClick={() => {
                  setParticipantsOpen(false);
                  setChatOpen(false);
                  setAttendanceOpen(false);
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* PARTICIPANTS: COUNT + HOST CONTROLS */}

            {participantsOpen && (
              <div className="people-content">
                <h3>
                  Participants <span>{participants.length}</span>
                </h3>

                {participants.map((person) => (
                  <div className="person-row" key={person.id}>
                    <div className="person-avatar">
                      {(person.name || "G")
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>
                        {person.name || "Guest"}
                        {person.isHost && " 👑"}
                      </strong>

                      <small>
                        {person.id === socketRef.current?.id
                          ? isHost
                            ? "You · Host"
                            : "You · This device"
                          : person.isHost
                          ? "Meeting host"
                          : "Joined meeting"}
                      </small>

                      {isHost &&
                        person.id !== socketRef.current?.id && (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              marginTop: 8,
                            }}
                          >
                            <button
                              type="button"
                              disabled={hostBusy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove ${
                                      person.name || "this participant"
                                    } from the meeting?`
                                  )
                                ) {
                                  hostAction(
                                    "remove-participant",
                                    person.id
                                  );
                                }
                              }}
                              style={{
                                padding: "5px 8px",
                                border: "1px solid #fecaca",
                                borderRadius: 6,
                                background: "#fef2f2",
                                color: "#b91c1c",
                                cursor: "pointer",
                              }}
                            >
                              Remove
                            </button>

                            {!person.isHost && (
                              <button
                                type="button"
                                disabled={hostBusy}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Transfer host to ${
                                        person.name || "this participant"
                                      }?`
                                    )
                                  ) {
                                    hostAction(
                                      "transfer-host",
                                      person.id
                                    );
                                  }
                                }}
                                style={{
                                  padding: "5px 8px",
                                  border: "1px solid #c7d2fe",
                                  borderRadius: 6,
                                  background: "#eef2ff",
                                  color: "#3730a3",
                                  cursor: "pointer",
                                }}
                              >
                                Transfer Host
                              </button>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                ))}

                {participants.length === 0 && (
                  <p className="panel-note">
                    Connecting to meeting server…
                  </p>
                )}
              </div>
            )}

            {/* ATTENDANCE: TOTAL + PRESENT + HISTORY */}

            {attendanceOpen && (
              <div className="people-content attendance-content">
                <h3
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>Smart Attendance</span>
                  <span>{attendance.length}</span>
                </h3>

                <p
                  className="panel-note"
                  style={{ marginBottom: 12 }}
                >
                  Attendance refreshes automatically every 3 seconds.
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                     background: "#151a2e",
color: "#f8fafc",
border: "1px solid #303954",
                    }}
                  >
                    <small>Total attendance</small>

                    <strong
                      style={{ display: "block", fontSize: 22 }}
                    >
                      {attendance.length}
                    </strong>
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: "#151a2e",
color: "#f8fafc",
border: "1px solid #303954",
                    }}
                  >
                    <small>Present now</small>

                    <strong
                      style={{ display: "block", fontSize: 22 }}
                    >
                      {presentCount}
                    </strong>
                  </div>
                </div>

                {attendance.length === 0 ? (
                  <p className="panel-note">
                    No attendance recorded yet. Join the meeting to begin.
                  </p>
                ) : (
                  attendance.map((record, index) => {
                    const joinedTimestamp = new Date(
                      record.joinedAt
                    ).getTime();

                    const liveDuration =
                      record.status === "Present" &&
                      Number.isFinite(joinedTimestamp)
                        ? Math.max(
                            0,
                            Math.floor(
                              (clockTick - joinedTimestamp) / 1000
                            )
                          )
                        : Number(record.durationSeconds) || 0;

                    return (
                      <div
                        className="attendance-person-row"
                        key={`${record.roomId}-${record.joinedAt}-${record.participantName}-${index}`}
                        style={{
                          padding: 12,
                          marginBottom: 10,
                          border:
                            "1px solid var(--border-color, #e5e7eb)",
                          borderRadius: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 12,
                          }}
                        >
                          <div className="person-avatar">
                            {(record.participantName || "G")
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong>
                              {record.participantName || "Guest"}
                            </strong>

                            <small style={{ display: "block" }}>
                              Room: {record.roomId}
                            </small>
                          </div>

                          <span
                            style={{
                              fontSize: 12,
                              padding: "4px 8px",
                              borderRadius: 20,
                              color:
                                record.status === "Present"
                                  ? "#166534"
                                  : "#6b7280",
                              background:
                                record.status === "Present"
                                  ? "#dcfce7"
                                  : "#f3f4f6",
                            }}
                          >
                            {record.status || "Unknown"}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 10,
                          }}
                        >
                          <div>
                            <small
                              style={{
                                display: "block",
                                opacity: 0.7,
                              }}
                            >
                              Joining time
                            </small>

                            <strong style={{ fontSize: 12 }}>
                              {formatTime(record.joinedAt)}
                            </strong>
                          </div>

                          <div>
                            <small
                              style={{
                                display: "block",
                                opacity: 0.7,
                              }}
                            >
                              Leaving time
                            </small>

                            <strong style={{ fontSize: 12 }}>
                              {formatTime(record.leftAt)}
                            </strong>
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 8,
                            borderTop:
                              "1px solid var(--border-color, #e5e7eb)",
                          }}
                        >
                          <small style={{ opacity: 0.7 }}>
                            Total meeting duration
                          </small>

                          <strong
                            style={{
                              display: "block",
                              marginTop: 3,
                            }}
                          >
                            {formatDuration(liveDuration)}
                          </strong>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* CHAT */}

            {chatOpen && (
              <div className="chat-content">
                <h3>Meeting chat</h3>

                <div className="chat-messages">
                  {messages.length === 0 ? (
                    <p>No messages yet. Start the conversation!</p>
                  ) : (
                    messages.map((item) => (
                      <div className="chat-message" key={item.id}>
                        <strong>{item.name}</strong>
                        <span>{item.text}</span>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={sendMessage}>
                  <input
                    value={message}
                    onChange={(event) =>
                      setMessage(event.target.value)
                    }
                    placeholder="Type a message..."
                    aria-label="Chat message"
                  />

                  <button type="submit">Send</button>
                </form>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* HOST CONTROLS */}

      <footer className="room-controls">
        {isHost && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "center",
              padding: 10,
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <button
              type="button"
              className="control-button"
              disabled={hostBusy}
              onClick={() =>
                hostAction(meetingLocked ? "unlock" : "lock")
              }
            >
              <ShieldCheck size={17} />
              <span>
                {meetingLocked ? "Unlock Meeting" : "Lock Meeting"}
              </span>
            </button>

            <button
              type="button"
              className="control-button"
              disabled={hostBusy}
              onClick={() => {
                if (
                  window.confirm(
                    "Mute all participants in this meeting?"
                  )
                ) {
                  hostAction("mute-all");
                }
              }}
            >
              <MicOff size={17} />
              <span>Mute All</span>
            </button>

            <button
              type="button"
              className="leave-button"
              disabled={hostBusy}
              onClick={() => {
                if (
                  window.confirm(
                    "End this meeting for everyone? This cannot be undone."
                  )
                ) {
                  hostAction("end-meeting");
                }
              }}
            >
              <PhoneOff size={17} />
              <span>End Meeting</span>
            </button>
          </div>
        )}

        <div className="control-info">
          <strong>Meeting in progress</strong>
          <span>Code: {roomId}</span>
        </div>

        <div className="control-buttons">
          <button
            type="button"
            className={`control-button ${
              micOn ? "control-on" : ""
            }`}
            onClick={toggleMic}
          >
            {micOn ? <Mic /> : <MicOff />}
            <span>{micOn ? "Mute" : "Unmute"}</span>
          </button>

          <button
            type="button"
            className={`control-button ${
              cameraOn ? "control-on" : ""
            }`}
            onClick={toggleCamera}
          >
            {cameraOn ? <Video /> : <VideoOff />}
            <span>
              {cameraOn ? "Stop video" : "Start video"}
            </span>
          </button>

          <button
            type="button"
            className={`control-button ${
              screenSharing ? "control-on" : ""
            }`}
            onClick={
              screenSharing ? stopScreenShare : startScreenShare
            }
          >
            <MonitorUp />
            <span>
              {screenSharing ? "Stop sharing" : "Share screen"}
            </span>
          </button>

          <button
            type="button"
            className={`control-button ${
              chatOpen ? "control-on" : ""
            }`}
            onClick={() => {
              setChatOpen(true);
              setParticipantsOpen(false);
              setAttendanceOpen(false);
            }}
          >
            <MessageSquare />
            <span>Chat</span>
          </button>

          <button
            type="button"
            className={`control-button ${
              participantsOpen ? "control-on" : ""
            }`}
            onClick={() => {
              setParticipantsOpen(true);
              setChatOpen(false);
              setAttendanceOpen(false);
            }}
          >
            <Users />
            <span>People ({participants.length})</span>
          </button>

          <button
            type="button"
            className="leave-button"
            onClick={leaveMeeting}
          >
            <PhoneOff size={19} />
            <span>Leave</span>
          </button>
        </div>
      </footer>

      {notice && <div className="room-toast">{notice}</div>}
    </div>
  );
}