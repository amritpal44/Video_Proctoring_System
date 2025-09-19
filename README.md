# Video Proctoring System

> **A full-stack, real-time video proctoring platform for online interviews and assessments.**

This project provides a robust, extensible, and modern solution for remote proctoring, combining live video monitoring, AI-based integrity checks, and detailed reporting. Built with React (Vite), Node.js (Express), MongoDB, and Socket.IO, it is designed for reliability, security, and ease of use.

---

## 🚀 Features

- **Live Proctoring:** Real-time video and event streaming between candidate and interviewer.
- **AI Integrity Detection:** Face/object detection, focus loss, and suspicious activity monitoring (TensorFlow.js models).
- **Role-based Access:** Distinct flows for candidates, interviewers, and admins.
- **Session Management:** Secure session creation, join by code, and persistent session IDs.
- **Comprehensive Reports:** Searchable, filterable, and exportable (CSV) reports with event timelines and integrity scores.
- **Authentication:** JWT and cookie-based login, with secure session handling.
- **Responsive UI:** Modern, accessible, and mobile-friendly design with Tailwind CSS.
- **Extensible Backend:** Modular Express API, easy to add new endpoints or detection logic.

---

## 🏗️ Architecture Overview

```mermaid
flowchart TD
    subgraph Frontend [React (Vite)]
        A[Candidate Console]
        B[Interviewer Console]
        C[Reports Page]
        D[Auth & Navbar]
    end
    subgraph Backend [Express + MongoDB]
        E[REST API]
        F[Socket.IO Server]
        G[AI Detection Logic]
        H[MongoDB]
    end
    A <--> F
    B <--> F
    C <--> E
    D <--> E
    E <--> H
    F <--> H
    G <--> F
```

---

## 🛠️ Technology Stack

- **Frontend:** React 19, Vite, Tailwind CSS, React Router, Socket.IO Client, TensorFlow.js
- **Backend:** Node.js, Express, Socket.IO, Mongoose (MongoDB), JWT, Multer
- **Dev Tools:** ESLint, Nodemon, dotenv, concurrently (optional for parallel dev)

---

## 📦 Project Structure

```
Video_Proctoring_System/
├── server/                # Express backend
│   ├── src/
│   │   ├── app.js         # Main server entry
│   │   ├── controllers/   # Business logic (proctor, session, auth)
│   │   ├── routes/        # API route definitions
│   │   ├── socket.js      # Socket.IO handlers
│   │   └── utils/         # Utilities (ID gen, seeding)
│   ├── package.json
│   └── .env.sample
├── src/                   # React frontend
│   ├── App.jsx, main.jsx  # App entry and router
│   ├── components/        # UI components
│   ├── pages/             # Route pages (Reports, Login, etc)
│   ├── contexts/          # Auth context
│   └── assets/
├── package.json           # Frontend scripts
└── README.md
```

---

## ⚡ Quickstart

### 1. Prerequisites

- Node.js (v18+ recommended)
- npm (comes with Node.js)
- MongoDB (local or remote)

### 2. Backend Setup

```powershell
cd "server"
npm install
copy .env.sample .env
# Edit .env to set JWT_SECRET and (optionally) MONGO_URI
npm run dev
```

**Key env vars:**

- `MONGO_URI` (default: `mongodb://localhost:27017/videoProctoring`)
- `JWT_SECRET` (required)
- `PORT` (default: 4000)
- `FRONTEND_ORIGIN` (default: `http://localhost:5173`)

### 3. Frontend Setup

```powershell
cd ".."  # Project root
npm install
npm run dev
```

**Optional:**
Set `VITE_BACKEND_URL` to override backend URL:

```powershell
$env:VITE_BACKEND_URL='http://localhost:4000'; npm run dev
```

### 4. Seed Test Users (optional)

```powershell
cd server
npm run seed
# Configure SEED_* vars in .env before running
```

---

## 👤 User Roles & Flows

### Candidate

- Join with Session ID (shared by interviewer)
- Video/audio streamed to interviewer
- Receives live proctoring feedback (if enabled)

### Interviewer

- Create or join session (Session ID)
- Monitor candidate video, receive AI events
- Can set interview title, export reports

### Admin

- Access all reports, manage users (future)

---

## 📊 Reports & Integrity

- **Reports Page:** Search, filter (date, integrity)
- **Export:** Download CSV with all events, timestamps (IST), candidate/interviewer info, and integrity score
- **Integrity Score:** Calculated per session based on suspicious events, focus loss, and detection results

---

## 🔌 API & Socket Overview

### REST API (selected)

- `POST /api/auth/login` — Login (email, password)
- `POST /api/auth/logout` — Logout
- `GET /api/auth/me` — Get current user
- `POST /api/sessions` — Create session
- `POST /api/sessions/:sessionId/title` — Set interview title
- `GET /api/proctor/interviews` — List interviews (filters, pagination)
- `GET /api/proctor/report/:interviewId` — Download report (CSV/JSON)

### Socket Events

- `join-session` — Candidate/interviewer joins session
- `proctor-event` — AI event (focus loss, suspicious activity)
- `video-frame` — Video frame streaming
- `session-update` — Session state changes

---

## 🧑‍💻 Development & Troubleshooting

- **Dev servers:**
  - Backend: `cd server && npm run dev`
  - Frontend: `npm run dev` (project root)
- **Build frontend:** `npm run build` (then `npm run preview`)

---

## 🔒 Security & Privacy

- JWT and cookie-based auth (never commit secrets)
- CORS and socket origin checks
- Minimal user data in localStorage (demo only)
- All sensitive operations require authentication

---

## 🤝 Contributing

Pull requests and suggestions welcome! Please open an issue for bugs or feature requests.

---

## 📄 License

This project is for educational and demonstration purposes. See LICENSE for details.
