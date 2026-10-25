# 🏃 HiperMove | AI-Powered Movement Analysis

<p align="center">
  <strong>Move Smarter. Understand Your Form. Improve Every Rep.</strong>
</p>

<p align="center">
  An AI-assisted movement analysis application that uses computer vision to analyze exercise videos, estimate movement metrics, and provide personalized coaching insights.
</p>

<p align="center">
  <a href="https://github.com/Madhuri-Kumari2504/HiperMove-Mobility-Assistant">
    <img src="https://img.shields.io/badge/Project-HiperMove-0D9488?style=for-the-badge" alt="HiperMove Project" />
  </a>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Computer%20Vision-MediaPipe-4285F4?style=for-the-badge" alt="MediaPipe" />
</p>

---

## ✨ About the Project

**HiperMove** is a computer-vision-based movement analysis application designed to help users better understand their exercise technique through video analysis.

The application uses Google's MediaPipe Pose Landmarker to detect body landmarks in exercise videos. It analyzes movement patterns and calculates useful metrics such as repetition count, knee angles, movement consistency, and average repetition duration.

The goal is to make movement feedback more accessible through an intuitive interface and data-informed coaching insights.

## 🚀 Key Features

- 🎥 **Exercise Video Upload**  
  Upload supported video formats, including MP4, MOV, and WebM, for movement analysis.

- 🦴 **AI-Powered Pose Detection**  
  Detect body landmarks using MediaPipe Pose Landmarker.

- 🔁 **Repetition Tracking**  
  Estimate completed repetitions from detected movement patterns.

- 📐 **Knee Angle Analysis**  
  Calculate average knee angles and observed angle ranges during movement.

- 📊 **Movement Consistency Metrics**  
  Generate a consistency estimate and average repetition duration from analyzed movements.

- 💡 **Coaching Insights**  
  Request an explanatory coaching note based on the calculated session metrics through the backend API.

- 📈 **Analysis Progress**  
  Track analysis progress and view the results when processing is complete.

- 🔄 **Session Reset**  
  Clear the current session and analyze another video.

- 🛡️ **Error Handling**  
  Handle unsupported files, video-processing errors, and unavailable coaching services.

## 🧠 How It Works

```text
Exercise Video
      │
      ▼
Video Validation
      │
      ▼
MediaPipe Pose Detection
      │
      ▼
Body Landmark Tracking
      │
      ▼
Movement & Knee Angle Analysis
      │
      ▼
Session Metrics
      │
      ▼
Backend Coaching Explanation
      │
      ▼
Movement Insights
```

### Analysis Workflow

1. Upload an exercise video.
2. The application validates the file and reads its duration.
3. MediaPipe detects body landmarks across sampled video frames.
4. The application estimates repetitions and calculates movement metrics.
5. Session metrics can be sent to the backend for a coaching explanation.
6. Review the generated results and start another session when ready.

**Video limit:** The current analysis workflow processes up to 60 seconds of a video per session.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| React | Interactive user interface |
| TypeScript | Type-safe application development |
| Vite | Frontend development server and build tooling |
| MediaPipe Tasks Vision | Pose landmark detection |
| TanStack Query | API requests and asynchronous state management |
| Wouter | Lightweight client-side routing |
| Tailwind CSS | Styling infrastructure |
| Lucide React | Interface icons |
| Node.js | JavaScript runtime |
| Express | Backend API framework |
| OpenAI SDK | Backend AI integration |
| Drizzle ORM | Database access infrastructure |
| Zod | Schema validation |
| pnpm | Workspace and dependency management |

## 📁 Project Structure

```text
HiperMove-Mobility-Assistant/
│
├── HiperMove-Mobility-Assistant/
│   ├── artifacts/
│   │   ├── hipermove/          # Main React application
│   │   ├── api-server/         # Backend API
│   │   └── mockup-sandbox/     # UI mockup workspace
│   │
│   ├── lib/
│   │   ├── api-client-react/   # Generated API client
│   │   ├── api-spec/           # OpenAPI specification
│   │   ├── api-zod/            # Generated validation schemas
│   │   └── db/                 # Database schema and setup
│   │
│   ├── scripts/                # Workspace scripts
│   ├── package.json            # Workspace scripts
│   ├── pnpm-workspace.yaml     # Workspace configuration
│   └── pnpm-lock.yaml          # Dependency lockfile
│
└── README.md
```

## ⚙️ Getting Started

### Prerequisites

Install the following before running the project:

- [Node.js](https://nodejs.org/) (a version compatible with the project dependencies)
- [pnpm](https://pnpm.io/)
- [Git](https://git-scm.com/)
- A modern browser with WebAssembly support

### 1. Clone the Repository

```bash
git clone https://github.com/Madhuri-Kumari2504/HiperMove-Mobility-Assistant.git
cd HiperMove-Mobility-Assistant
```

### 2. Enter the Application Workspace

The current repository contains the application inside a nested project directory.

```bash
cd HiperMove-Mobility-Assistant
```

### 3. Install Dependencies

```bash
corepack pnpm install
```

### 4. Start the Frontend

From the inner project directory, run:

```bash
corepack pnpm --filter @workspace/hipermove dev
```

Open the local URL printed in the terminal to view the application.

### 5. Configure the Backend

The frontend uses a backend API for health checks and coaching explanations.

Before using these features, configure the backend and any required environment variables according to the server implementation. Ensure the frontend API base URL points to the running backend.

**Note:** Installing dependencies and starting the frontend do not automatically guarantee that the backend or AI integration is configured.

## 🔐 Privacy & Responsible Use

- The current analysis workflow reads the selected video in the browser and processes video frames locally using MediaPipe.
- Session metrics may be sent to the configured backend to generate a coaching explanation.
- Avoid uploading sensitive or personally identifiable footage.
- Use HTTPS and appropriate access controls when deploying the backend.
- Movement estimates depend on camera angle, lighting, body visibility, and video quality.

HiperMove is intended for informational and fitness-support purposes. Its estimates are not a medical diagnosis or a substitute for professional guidance.

## 🗺️ Roadmap

Potential future improvements include:

- [ ] Support for additional exercises and movement patterns
- [ ] Improved repetition detection across different exercise styles
- [ ] Visual pose overlays and movement timelines
- [ ] Session history and progress tracking
- [ ] Comparative movement analysis
- [ ] Enhanced accessibility and mobile responsiveness
- [ ] Automated testing and deployment workflows

## 🤝 Contributing

Contributions, suggestions, and bug reports are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes and test them.
4. Commit your changes with a clear message.
5. Open a pull request describing the improvement.

## 📄 License

The workspace declares an MIT license in its package metadata. Confirm the repository's licensing requirements and include a root-level `LICENSE` file before distributing the project under that license.

## 👩‍💻 Author

**Madhuri Kumari**

GitHub: [@Madhuri-Kumari2504](https://github.com/Madhuri-Kumari2504)

Project: [HiperMove Mobility Assistant](https://github.com/Madhuri-Kumari2504/HiperMove-Mobility-Assistant)

---

<p align="center">
  <strong>Built to make movement easier to understand.</strong>
  <br />
  <sub>HiperMove · AI-assisted movement analysis</sub>
</p>
