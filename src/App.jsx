import { useEffect, useState } from "react";
import {
  Video,
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  BrainCircuit,
  Settings,
  Search,
  Bell,
  Plus,
  Link2,
  Clock,
  ArrowUpRight,
  Users,
  Play,
  X,
  Menu,
  RefreshCw,
} from "lucide-react";
import "./App.css";
import MeetingRoom from "./MeetingRoom";

const initialMeetings = [
  {
    id: "demo-1",
    title: "Project Discussion",
    date: "Today",
    time: "10:00 AM",
    people: 5,
    color: "purple",
    meetingCode: "PROJ100",
    status: "Scheduled",
  },
  {
    id: "demo-2",
    title: "Team Sync",
    date: "Today",
    time: "02:00 PM",
    people: 8,
    color: "blue",
    meetingCode: "TEAM200",
    status: "Scheduled",
  },
  {
    id: "demo-3",
    title: "Client Meeting",
    date: "Tomorrow",
    time: "11:30 AM",
    people: 4,
    color: "green",
    meetingCode: "CLIENT300",
    status: "Scheduled",
  },
];

const navigation = [
  ["Dashboard", LayoutDashboard],
  ["New Meeting", Plus],
  ["Join Meeting", Link2],
  ["Meetings", CalendarDays],
  ["Attendance", ClipboardCheck],
  ["AI Assistant", BrainCircuit],
  ["Settings", Settings],
];

function loadSavedMeetings() {
  try {
    const saved = localStorage.getItem("cloudsync-meetings");

    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error("Could not load meetings:", error);
  }

  return initialMeetings;
}

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
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
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

export default function App() {
  const [active, setActive] = useState("Dashboard");
  const [authUser, setAuthUser] = useState(null);
const [authMode, setAuthMode] = useState("login");
const [authName, setAuthName] = useState("");
const [authEmail, setAuthEmail] = useState("");
const [authPassword, setAuthPassword] = useState("");
const [authLoading, setAuthLoading] = useState(false);
const [authError, setAuthError] = useState("");
  const [meetings, setMeetings] = useState(loadSavedMeetings);
  const [modal, setModal] = useState("");
  const [meetingName, setMeetingName] = useState("");
  const [meetingCode, setMeetingCode] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showRoom, setShowRoom] = useState(false);

  const [attendance, setAttendance] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(
        "cloudsync-meetings",
        JSON.stringify(meetings)
      );
    } catch (error) {
      console.error("Could not save meetings:", error);
    }
  }, [meetings]);

  useEffect(() => {
    if (active !== "Attendance" || showRoom) return;

    let cancelled = false;

    async function loadAttendance() {
      try {
        setAttendanceLoading(true);

        const response = await fetch(
          `http://${window.location.hostname}:3001/api/attendance`
        );

        if (!response.ok) {
          throw new Error("Could not load attendance.");
        }

        const data = await response.json();

        if (!cancelled) {
          setAttendance(
            Array.isArray(data.attendance) ? data.attendance : []
          );
          setAttendanceError("");
        }
      } catch (error) {
        if (!cancelled) {
          setAttendanceError(
            "Attendance server se connect nahi ho pa raha. Backend running hai ya nahi check karo."
          );
        }
      } finally {
        if (!cancelled) setAttendanceLoading(false);
      }
    }

    loadAttendance();

    const intervalId = window.setInterval(loadAttendance, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [active, showRoom]);

  function notify(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }
   
async function handleAuth(event) {
  event.preventDefault();
  setAuthError("");
  setAuthLoading(true);

  try {
    const endpoint =
      authMode === "signup" ? "signup" : "login";

    const response = await fetch(
      `http://${window.location.hostname}:3001/api/auth/${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          authMode === "signup"
            ? {
                name: authName.trim(),
                email: authEmail.trim(),
                password: authPassword,
              }
            : {
                email: authEmail.trim(),
                password: authPassword,
              }
        ),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Authentication failed."
      );
    }

    localStorage.setItem(
      "cloudsync-token",
      data.token
    );

    setAuthUser(data.user);
    setAuthPassword("");
    setAuthError("");
  } catch (error) {
    setAuthError(
      error.message || "Could not connect to server."
    );
  } finally {
    setAuthLoading(false);
  }
}

  async function createMeeting(event) {
    event.preventDefault();

    if (creatingMeeting) return;

    if (!meetingName.trim()) {
      notify("Please enter a meeting name.");
      return;
    }

    const isScheduled = modal === "schedule";
    let scheduledAt = new Date();

    if (isScheduled) {
      if (!meetingDate || !meetingTime) {
        notify("Please select a meeting date and time.");
        return;
      }

      scheduledAt = new Date(`${meetingDate}T${meetingTime}`);

      if (
        Number.isNaN(scheduledAt.getTime()) ||
        scheduledAt <= new Date()
      ) {
        notify("Please select a future date and time.");
        return;
      }
    }

    setCreatingMeeting(true);

    try {
      const response = await fetch(
        `http://${window.location.hostname}:3001/api/meetings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: meetingName.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not create meeting."
        );
      }

      const newMeeting = {
        id: `meeting-${Date.now()}`,
        title: meetingName.trim(),
        date: scheduledAt.toLocaleDateString(),
        time: scheduledAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        dateISO: scheduledAt.toISOString(),
        people: 1,
        color: "purple",
        meetingCode: data.meetingCode,
        hostKey: data.hostKey,
        status: isScheduled ? "Scheduled" : "Created",
      };

      setMeetings((previous) => [
        newMeeting,
        ...previous,
      ]);

      setMeetingCode(data.meetingCode);
      setHostKey(data.hostKey);
      setMeetingName("");
      setMeetingDate("");
      setMeetingTime("");
      setModal("");
      setActive("Meetings");

      notify(
        `${isScheduled ? "Meeting scheduled" : "Meeting created"}! Code: ${data.meetingCode}`
      );
    } catch (error) {
      console.error("Create meeting error:", error);

      notify(
        error.message ||
          "Could not connect to the backend. Check whether server.js is running."
      );
    } finally {
      setCreatingMeeting(false);
    }
  }

  function joinMeeting(event) {
    event.preventDefault();

    const cleanCode = meetingCode.trim().toUpperCase();

    if (!cleanCode) {
      notify("Please enter a meeting code.");
      return;
    }

    const savedMeeting = meetings.find(
      (meeting) => meeting.meetingCode === cleanCode
    );

    setMeetingCode(cleanCode);
    setHostKey(savedMeeting?.hostKey || "");
    setModal("");
    setShowRoom(true);
  }

  function navigate(label) {
    setMenuOpen(false);

    if (label === "New Meeting") {
      setModal("create");
      return;
    }

    if (label === "Join Meeting") {
      setModal("join");
      return;
    }

    setActive(label);
  }

  function openJoin(meeting) {
    setMeetingCode(meeting.meetingCode || "");
    setHostKey(meeting.hostKey || "");
    setModal("join");
  }

  const filtered = meetings.filter((meeting) =>
    meeting.title.toLowerCase().includes(search.toLowerCase())
  );

  const presentCount = attendance.filter(
    (record) => record.status === "Present"
  ).length;

  const completedCount = attendance.filter(
    (record) => record.leftAt
  ).length;
  
if (!authUser) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Video size={28} />
        </div>

        <h1>Cloud<span>Sync</span></h1>

        <p className="auth-subtitle">
          {authMode === "login"
            ? "Welcome back! Sign in to continue."
            : "Create your account to get started."}
        </p>

        <form onSubmit={handleAuth}>
          {authMode === "signup" && (
            <>
              <label>Full name</label>
              <input
                type="text"
                placeholder="Enter your name"
                value={authName}
                onChange={(event) =>
                  setAuthName(event.target.value)
                }
                maxLength={60}
                required
              />
            </>
          )}

          <label>Email address</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={authEmail}
            onChange={(event) =>
              setAuthEmail(event.target.value)
            }
            required
          />

          <label>Password</label>
          <input
            type="password"
            placeholder="At least 8 characters"
            value={authPassword}
            onChange={(event) =>
              setAuthPassword(event.target.value)
            }
            minLength={8}
            maxLength={128}
            required
          />

          {authError && (
            <p className="auth-error">{authError}</p>
          )}

          <button
            className="primary-button full-button"
            type="submit"
            disabled={authLoading}
          >
            {authLoading
              ? "Please wait..."
              : authMode === "login"
              ? "Sign In"
              : "Create Account"}
          </button>
        </form>

        <p className="auth-switch">
          {authMode === "login"
            ? "Don't have an account?"
            : "Already have an account?"}

          <button
            type="button"
            onClick={() => {
              setAuthMode(
                authMode === "login" ? "signup" : "login"
              );
              setAuthError("");
            }}
          >
            {authMode === "login"
              ? "Sign Up"
              : "Sign In"}
          </button>
        </p>
      </div>
    </div>
  );
}

  if (showRoom) {
    return (
      <MeetingRoom
        onLeave={() => setShowRoom(false)}
        meetingCode={meetingCode}
        hostKey={hostKey}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}
      >
        <div className="brand">
          <div className="brand-icon">
            <Video size={23} />
          </div>

          <div>
            <h2>
              Cloud<span>Sync</span>
            </h2>
            <p>VIDEO CONFERENCING</p>
          </div>

          <button
            className="close-menu"
            onClick={() => setMenuOpen(false)}
          >
            <X />
          </button>
        </div>

        <div className="workspace">
          <div className="workspace-dot" />
          <div>
            <strong>My Workspace</strong>
            <small>Personal workspace</small>
          </div>
          <ArrowUpRight size={15} />
        </div>

        <p className="nav-title">WORKSPACE</p>

        <nav>
          {navigation.map(([label, Icon]) => (
            <button
              key={label}
              className={`nav-link ${
                active === label ? "active" : ""
              }`}
              onClick={() => navigate(label)}
            >
              <Icon size={18} />
              <span>{label}</span>

              {label === "AI Assistant" && (
                <span className="ai-tag">AI</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <BrainCircuit size={21} />
            </div>

            <strong>Meet smarter with AI</strong>

            <p>
              Turn conversations into notes, summaries and action items.
            </p>

            <button onClick={() => navigate("AI Assistant")}>
              Explore assistant <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="profile">
            <div className="avatar">A</div>

            <div>
              <strong>Your Profile</strong>
              <small>Workspace member</small>
            </div>

            <button
  className="settings-button"
  onClick={() => setActive("Settings")}
  title="Settings"
>
  <Settings size={17} />
</button>
          </div>
        </div>
        
<button
  className="logout-button"
  onClick={() => {
    localStorage.removeItem("cloudsync-token");
    setAuthUser(null);
    setAuthPassword("");
    setAuthError("");
  }}
>
  Logout
</button>

      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu />
          </button>

          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{active}</strong>
          </div>

          <div className="top-actions">
            <label className="search-box">
              <Search size={17} />

              <input
                placeholder="Search meetings..."
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />
            </label>

            <button
              className="notification"
              onClick={() => notify("You're all caught up!")}
            >
              <Bell size={19} />
              <i />
            </button>

            <div className="avatar top-avatar">A</div>
          </div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                <span className="live-dot" /> YOUR MEETING SPACE
              </div>

              <h1>
                {active === "Dashboard"
                  ? "Welcome back!"
                  : active}
              </h1>

              <p className="subtitle">
                {active === "Dashboard"
                  ? "Everything you need for better, smarter meetings."
                  : `Manage your ${active.toLowerCase()} in one place.`}
              </p>
            </div>

            <button
              className="primary-button"
              onClick={() => setModal("create")}
            >
              <Plus size={18} /> New Meeting
            </button>
          </section>

          {active === "Dashboard" && (
            <>
              <section className="stats-grid">
                <Stat
                  icon={<Video />}
                  label="Total Meetings"
                  value={String(meetings.length)}
                  note="Saved in this browser"
                  color="purple"
                />

                <Stat
                  icon={<CalendarDays />}
                  label="Scheduled"
                  value={String(
                    meetings.filter((meeting) => {
                      return (
                        meeting.dateISO &&
                        new Date(meeting.dateISO) > new Date()
                      );
                    }).length
                  )}
                  note="Future meetings"
                  color="blue"
                />

                <Stat
                  icon={<ClipboardCheck />}
                  label="Attendance Entries"
                  value={String(attendance.length)}
                  note="Recorded sessions"
                  color="green"
                />

                <Stat
                  icon={<BrainCircuit />}
                  label="AI Summaries"
                  value="—"
                  note="Not connected yet"
                  color="orange"
                />
              </section>

              <section className="section">
                <div className="section-heading">
                  <div>
                    <h2>Quick actions</h2>
                    <p>Get started with one click</p>
                  </div>
                </div>

                <div className="quick-grid">
                  <QuickCard
                    icon={<Video />}
                    title="Create a meeting"
                    text="Start a new video call"
                    color="purple"
                    onClick={() => setModal("create")}
                  />

                  <QuickCard
                    icon={<Link2 />}
                    title="Join a meeting"
                    text="Enter a meeting code"
                    color="blue"
                    onClick={() => {
                      setMeetingCode("");
                      setModal("join");
                    }}
                  />

                  <QuickCard
                    icon={<CalendarDays />}
                    title="Schedule meeting"
                    text="Plan your next session"
                    color="green"
                    onClick={() => setModal("schedule")}
                  />
                </div>
              </section>
            </>
          )}

          {(active === "Dashboard" || active === "Meetings") && (
            <section className="section meetings-section">
              <div className="section-heading">
                <div>
                  <h2>
                    {active === "Dashboard"
                      ? "Upcoming meetings"
                      : "Meeting history"}
                  </h2>
                  <p>Meetings saved in this browser</p>
                </div>

                {active === "Dashboard" && (
                  <button
                    className="text-button"
                    onClick={() => setActive("Meetings")}
                  >
                    View all <ArrowUpRight size={15} />
                  </button>
                )}
              </div>

              <div className="meeting-list">
                {filtered.map((meeting, index) => (
                  <MeetingRow
                    key={meeting.id || `${meeting.title}-${index}`}
                    meeting={meeting}
                    onJoin={() => openJoin(meeting)}
                    onCopy={() => {
                      navigator.clipboard
                        .writeText(meeting.meetingCode || "")
                        .then(() => notify("Meeting code copied!"))
                        .catch(() =>
                          notify("Could not copy the code.")
                        );
                    }}
                  />
                ))}

                {filtered.length === 0 && (
                  <p className="empty-state">
                    No meetings match your search.
                  </p>
                )}
              </div>
            </section>
          )}

          {active === "Attendance" && (
            <section className="section">
              <div className="section-heading">
                <div>
                  <h2>Smart Attendance History</h2>
                  <p>
                    Recorded joining time, leaving time and meeting duration
                  </p>
                </div>

                <button
                  className="text-button"
                  onClick={() => {
                    setAttendanceError("");
                    setAttendanceLoading(true);

                    fetch(
                      `http://${window.location.hostname}:3001/api/attendance`
                    )
                      .then((response) => {
                        if (!response.ok) {
                          throw new Error("Request failed");
                        }

                        return response.json();
                      })
                      .then((data) => {
                        setAttendance(data.attendance || []);
                        setAttendanceError("");
                      })
                      .catch(() => {
                        setAttendanceError(
                          "Could not refresh attendance."
                        );
                      })
                      .finally(() =>
                        setAttendanceLoading(false)
                      );
                  }}
                >
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>

              <section className="stats-grid">
                <Stat
                  icon={<ClipboardCheck />}
                  label="Total Entries"
                  value={String(attendance.length)}
                  note="Saved attendance sessions"
                  color="purple"
                />

                <Stat
                  icon={<Users />}
                  label="Present Now"
                  value={String(presentCount)}
                  note="Currently in a meeting"
                  color="green"
                />

                <Stat
                  icon={<Clock />}
                  label="Completed Sessions"
                  value={String(completedCount)}
                  note="Participant has left"
                  color="blue"
                />
              </section>

              {attendanceError && (
                <div className="placeholder-panel">
                  <p>{attendanceError}</p>
                </div>
              )}

              {attendanceLoading && (
                <p className="empty-state">
                  Loading attendance records…
                </p>
              )}

              {!attendanceLoading &&
                !attendanceError &&
                attendance.length === 0 && (
                  <div className="placeholder-panel">
                    <div className="placeholder-icon">
                      <ClipboardCheck />
                    </div>

                    <h2>No attendance records yet</h2>

                    <p>
                      Join a meeting first. Participant attendance will appear
                      here automatically.
                    </p>

                    <button
                      className="primary-button"
                      onClick={() => setModal("join")}
                    >
                      <Video size={17} /> Join a meeting
                    </button>
                  </div>
                )}

              {attendance.length > 0 && (
                <div className="meeting-list">
                  {attendance.map((record, index) => (
                    <div
                      className="meeting-row"
                      key={`${record.roomId}-${record.joinedAt}-${index}`}
                      style={{
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: 14,
                        padding: 18,
                      }}
                    >
                      <div className="meeting-icon purple">
                        <ClipboardCheck size={19} />
                      </div>

                      <div
                        className="meeting-info"
                        style={{
                          flex: "1 1 220px",
                          minWidth: 0,
                        }}
                      >
                        <strong>
                          {record.participantName || "Guest"}
                        </strong>

                        <span>
                          <Video size={13} /> Room: {record.roomId}
                        </span>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(180px, 1fr))",
                            gap: 12,
                            marginTop: 14,
                            whiteSpace: "normal",
                          }}
                        >
                          <div>
                            <small>Joining time</small>
                            <p style={{ marginTop: 4 }}>
                              {formatTime(record.joinedAt)}
                            </p>
                          </div>

                          <div>
                            <small>Leaving time</small>
                            <p style={{ marginTop: 4 }}>
                              {formatTime(record.leftAt)}
                            </p>
                          </div>

                          <div>
                            <small>Total duration</small>
                            <p style={{ marginTop: 4 }}>
                              {formatDuration(record.durationSeconds)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <span
                        style={{
                          padding: "6px 10px",
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 600,
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
                  ))}
                </div>
              )}

              <p className="subtitle" style={{ marginTop: 18 }}>
                Attendance refreshes every 3 seconds. Records are stored in
                MongoDB through the backend.
              </p>
            </section>
          )}

          {active !== "Dashboard" &&
            active !== "Meetings" &&
            active !== "Attendance" && (
              <section className="placeholder-panel">
                <div className="placeholder-icon">
                  {active === "AI Assistant" ? (
                    <BrainCircuit />
                  ) : active === "Settings" ? (
                    <Settings />
                  ) : (
                    <CalendarDays />
                  )}
                </div>

                <h2>{active}</h2>
                
              {active === "Settings" && (
  <div className="ai-assistant-panel">
    <h3>Settings</h3>
    <p>Manage your CloudSync preferences.</p>

    <label>
      <input type="checkbox" id="notifications-setting" defaultChecked />
      Enable notifications
    </label>

    <br /><br />

    <label>
      <input type="checkbox" id="camera-setting" defaultChecked />
      Start meetings with camera enabled
    </label>

    <br /><br />

    <label>
      <input type="checkbox" id="mic-setting" />
      Start meetings with microphone enabled
    </label>

    <br /><br />

    <button
      onClick={() => {
        localStorage.setItem(
          "cloudsync-settings",
          JSON.stringify({
            notifications: document.getElementById("notifications-setting").checked,
            camera: document.getElementById("camera-setting").checked,
            microphone: document.getElementById("mic-setting").checked
          })
        );
        alert("Settings saved successfully!");
      }}
    >
      Save Settings
    </button>
  </div>
)}
{active === "AI Assistant" ? (
  <div className="ai-assistant-panel">
    <h3>AI Meeting Assistant</h3>
    <p>Paste your meeting notes below to generate a summary, key points, and action items.</p>

    <textarea
      id="meeting-notes"
      placeholder="Enter your meeting notes here..."
      rows={8}
      style={{
        width: "100%",
        padding: "14px",
        marginTop: "16px",
        borderRadius: "10px",
        background: "#242424",
        color: "#ffffff",
        border: "1px solid #444",
        resize: "vertical",
      }}
    />

    <button
      onClick={async () => {
        const notes = document.getElementById("meeting-notes").value.trim();

        if (!notes) {
          alert("Please enter your meeting notes first.");
          return;
        }

        const button = document.getElementById("generate-ai-summary");
        button.disabled = true;
        button.textContent = "Generating...";

        try {
        const response = await fetch(`http://${window.location.hostname}:3001/api/ai/summarize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Failed to generate summary.");
          }

          document.getElementById("ai-summary-result").textContent = data.result;
        } catch (error) {
          alert(error.message || "Could not connect to the AI server.");
        } finally {
          button.disabled = false;
          button.textContent = "Generate Summary";
        }
      }}
      id="generate-ai-summary"
      style={{ marginTop: "12px", padding: "12px 18px", cursor: "pointer" }}
    >
      Generate Summary
    </button>

    <div
      id="ai-summary-result"
      style={{
        marginTop: "20px",
        padding: "16px",
        borderRadius: "10px",
        background: "#1d1d1d",
        color: "#ffffff",
        whiteSpace: "pre-wrap",
      }}
    />
  </div>
) : (
  <p>
    </p>
)}


                

                <button
                  className="primary-button"
                  onClick={() => setActive("Dashboard")}
                >
                  Back to Dashboard
                </button>
              </section>
            )}

          <footer className="footer">
            <span>
              <span className="live-dot" /> Workspace is running locally
            </span>

            <span>
              Cloud Video Platform <b>•</b> Dashboard
            </span>
          </footer>
        </div>
      </main>

      {modal && (
        <div
          className="modal-overlay"
          onClick={() => setModal("")}
        >
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setModal("")}
            >
              <X size={19} />
            </button>

            <div className="modal-icon">
              {modal === "join" ? (
                <Link2 />
              ) : modal === "schedule" ? (
                <CalendarDays />
              ) : (
                <Video />
              )}
            </div>

            <h2>
              {modal === "create"
                ? "Create a meeting"
                : modal === "schedule"
                ? "Schedule a meeting"
                : "Join a meeting"}
            </h2>

            <p>
              {modal === "create"
                ? "Give your meeting a name to get started."
                : modal === "schedule"
                ? "Choose a date and time for your meeting."
                : "Enter the meeting code shared with you."}
            </p>

            <form
              onSubmit={
                modal === "join" ? joinMeeting : createMeeting
              }
            >
              {modal === "join" ? (
                <>
                  <label>Meeting code</label>

                  <input
                    required
                    autoFocus
                    value={meetingCode}
                    onChange={(event) =>
                      setMeetingCode(event.target.value)
                    }
                    placeholder="Enter meeting code"
                  />
                </>
              ) : (
                <>
                  <label>Meeting name</label>

                  <input
                    required
                    autoFocus
                    value={meetingName}
                    onChange={(event) =>
                      setMeetingName(event.target.value)
                    }
                    placeholder="e.g. Project Discussion"
                  />

                  {modal === "schedule" && (
                    <>
                      <label>Meeting date</label>

                      <input
                        type="date"
                        required
                        min={new Date().toLocaleDateString("en-CA")}
                        value={meetingDate}
                        onChange={(event) =>
                          setMeetingDate(event.target.value)
                        }
                      />

                      <label>Meeting time</label>

                      <input
                        type="time"
                        required
                        value={meetingTime}
                        onChange={(event) =>
                          setMeetingTime(event.target.value)
                        }
                      />
                    </>
                  )}
                </>
              )}

              <button
                className="primary-button full-button"
                type="submit"
                disabled={creatingMeeting}
              >
                {creatingMeeting ? (
                  "Creating..."
                ) : modal === "schedule" ? (
                  <>
                    <CalendarDays size={17} /> Schedule Meeting
                  </>
                ) : modal === "create" ? (
                  <>
                    <Plus size={17} /> Create Meeting
                  </>
                ) : (
                  <>
                    <Video size={17} /> Join Meeting
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {notice && (
        <div className="toast">
          <span>✓</span>
          {notice}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, note, color }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <div className={`stat-icon ${color}`}>{icon}</div>
        <span className="stat-period">Overview</span>
      </div>

      <p className="stat-label">{label}</p>
      <div className="stat-value">{value}</div>
      <p className="stat-note">{note}</p>
    </div>
  );
}

function QuickCard({ icon, title, text, color, onClick }) {
  return (
    <button className="quick-card" onClick={onClick}>
      <div className={`quick-icon ${color}`}>{icon}</div>

      <div className="quick-copy">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>

      <ArrowUpRight className="quick-arrow" size={18} />
    </button>
  );
}

function MeetingRow({ meeting, onJoin, onCopy }) {
  return (
    <div className="meeting-row">
      <div className={`meeting-icon ${meeting.color || "purple"}`}>
        <Video size={19} />
      </div>

      <div className="meeting-info">
        <strong>{meeting.title}</strong>

        <span>
          <CalendarDays size={13} /> {meeting.date} <i>·</i>{" "}
          <Clock size={13} /> {meeting.time}
        </span>

        <span>
          Code: <strong>{meeting.meetingCode || "Not available"}</strong>
        </span>

        {meeting.status && <small>{meeting.status}</small>}
      </div>

      <div className="meeting-people">
        <Users size={15} /> {meeting.people || 1}
      </div>

      <button
        className="join-button"
        onClick={onCopy}
        type="button"
        title="Copy meeting code"
      >
        Copy Code
      </button>

      <button
        className="join-button"
        onClick={onJoin}
        type="button"
      >
        <Play size={13} fill="currentColor" /> Join
      </button>
    </div>
  );
}