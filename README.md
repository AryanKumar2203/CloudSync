# ☁️ CloudSync — Video Conferencing Platform

**CloudSync** is a real-time video conferencing web application designed to make online meetings simple and collaborative. It brings together video calls, messaging, participant management, attendance tracking, and AI-powered meeting summaries in one workspace.

## ✨ Features

- 🔐 **User Authentication** — Sign up, log in, and log out.
- 🎥 **Video & Audio Meetings** — Start meetings and communicate with participants.
- 🔗 **Create & Join Meetings** — Create a meeting and invite others using a meeting code.
- 💬 **Real-Time Chat** — Exchange messages during meetings.
- 👥 **Participant Management** — View participants and participant counts.
- 🖥️ **Screen Sharing** — Share your screen on supported browsers and devices.
- 📋 **Attendance Tracking** — Record participant attendance and join/leave times.
- 🤖 **AI Meeting Assistant** — Generate meeting summaries, key points, and action items from meeting notes.
- ⚙️ **Settings** — Configure available workspace and meeting preferences.
- 📱 **Responsive Interface** — Access the workspace from desktop and mobile browsers, with some features depending on browser support.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| React | Frontend user interface |
| Vite | Frontend development and build tool |
| Node.js | Backend runtime |
| Express.js | Backend API |
| Socket.IO | Real-time communication |
| MongoDB | Database |
| Mongoose | MongoDB object modeling |
| Google Gemini API | AI-generated meeting summaries |
| CSS | Styling and responsive layouts |
| Git & GitHub | Version control |

## 🏗️ Project Structure

```text
cloud-video-platform/
├── public/
├── server/
│   ├── package.json
│   └── server.js
├── src/
│   ├── assets/
│   ├── App.jsx
│   ├── App.css
│   ├── MeetingRoom.jsx
│   ├── MeetingRoom.css
│   ├── index.css
│   └── main.jsx
├── .gitignore
├── index.html
├── package.json
├── package-lock.json
└── vite.config.js
```

## 🚀 Getting Started

### Prerequisites

Install the following before running the project:

- [Node.js](https://nodejs.org/)
- npm (included with Node.js)
- A MongoDB database
- A Google Gemini API key for the AI Meeting Assistant

### 1. Clone the Repository

```bash
git clone https://github.com/AryanKumar2203/CloudSync.git
cd CloudSync
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Install Backend Dependencies

```bash
cd server
npm install
```

### 4. Configure Environment Variables

Create a `.env` file inside the `server/` directory. Add the variables expected by your backend:

```env
PORT=3001
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_strong_secret
GEMINI_API_KEY=your_gemini_api_key
```

Replace the example values with your own credentials. Check `server.js` to confirm the exact environment variable names used by your code.

**Security:** Never commit `.env` files, API keys, database credentials, or JWT secrets to GitHub.

### 5. Start the Backend

From the `server/` directory, run:

```bash
npm start
```

If the backend's `package.json` does not define a `start` script
