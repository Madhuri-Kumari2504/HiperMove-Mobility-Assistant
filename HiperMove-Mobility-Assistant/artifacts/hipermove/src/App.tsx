import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  Activity,
  ArrowUpFromLine,
  Check,
  Clock3,
  FileVideo2,
  Gauge,
  HeartPulse,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Upload,
  Waves,
} from 'lucide-react';
import {
  getHealthCheckQueryKey,
  useCreateHipermoveSessionExplanation,
  useHealthCheck,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Router as WouterRouter, Route, Switch, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();
const MAX_VIDEO_SECONDS = 60;
const FRAME_STEP = 0.12;
const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26],
  [26, 28], [28, 30], [30, 32], [28, 32],
];

type PoseSample = { time: number; landmarks: NormalizedLandmark[] };
type Metrics = {
  repetitions: number;
  averageKneeAngleDegrees: number;
  kneeAngleRange: { min: number; max: number } | null;
  consistencyPercent: number;
  averageRepSeconds: number;
  analyzedSeconds: number;
};
type SessionStatus = 'idle' | 'loading-model' | 'analyzing' | 'complete' | 'error';

function angleAtJoint(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magnitude = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  return Math.acos(Math.max(-1, Math.min(1, dot / Math.max(magnitude, 0.00001)))) * 180 / Math.PI;
}

function averageKneeAngle(landmarks: NormalizedLandmark[]) {
  const left = [landmarks[23], landmarks[25], landmarks[27]];
  const right = [landmarks[24], landmarks[26], landmarks[28]];
  const visible = (point?: NormalizedLandmark) => point && (point.visibility ?? 1) > 0.35;
  const angles = [left, right]
    .filter((joints) => joints.every(visible))
    .map(([hip, knee, ankle]) => angleAtJoint(hip!, knee!, ankle!))
    .filter(Number.isFinite);
  return angles.length ? angles.reduce((sum, angle) => sum + angle, 0) / angles.length : null;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function waitForSeek(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    if (!video.seeking) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
      resolve();
    };
    const failed = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
      reject(new Error('This video could not be read.'));
    };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={Home} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Home() {
  const health = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60_000, retry: 1 },
  });
  const explanationMutation = useCreateHipermoveSessionExplanation();
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const poseSamplesRef = useRef<PoseSample[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [currentSecond, setCurrentSecond] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [explanation, setExplanation] = useState<{ headline: string; explanation: string; tip: string } | null>(null);

  const isBusy = status === 'loading-model' || status === 'analyzing';

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    landmarkerRef.current?.close();
  }, []);

  const reset = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    poseSamplesRef.current = [];
    setFile(null);
    setVideoUrl('');
    setDuration(0);
    setMetrics(null);
    setExplanation(null);
    setProgress(0);
    setStatus('idle');
    setErrorMessage('');
    setAnalysisError('');
    setCurrentSecond(0);
    explanationMutation.reset();
    if (inputRef.current) inputRef.current.value = '';
  }, [explanationMutation]);

  const acceptFile = useCallback((candidate?: File) => {
    if (!candidate) return;
    const looksLikeVideo = candidate.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv)$/i.test(candidate.name);
    if (!looksLikeVideo) {
      setErrorMessage('Choose a video file, such as MP4, MOV, or WebM.');
      return;
    }
    reset();
    const url = URL.createObjectURL(candidate);
    objectUrlRef.current = url;
    setFile(candidate);
    setVideoUrl(url);
    setErrorMessage('');
    setAnalysisError('');
  }, [reset]);

  const submitMetrics = useCallback((result: Metrics) => {
    explanationMutation.mutate({ data: result }, {
      onSuccess: (response) => {
        setExplanation(response);
        setAnalysisError('');
      },
      onError: () => setAnalysisError('Your movement results are safe here. The coach note could not connect right now. Try again when you have a connection.'),
    });
  }, [explanationMutation]);

  const analyze = useCallback(async () => {
    const currentFile = file;
    if (!currentFile || !duration || isBusy) return;
    let analysisUrl: string | null = null;
    setErrorMessage('');
    setAnalysisError('');
    setExplanation(null);
    setProgress(0);
    setStatus('loading-model');
    try {
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm');
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      }

      setStatus('analyzing');
      const sampler = document.createElement('video');
      sampler.preload = 'auto';
      sampler.muted = true;
      sampler.playsInline = true;
      sampler.src = URL.createObjectURL(currentFile);
      const samplerUrl = sampler.src;
      analysisUrl = samplerUrl;
      await new Promise<void>((resolve, reject) => {
        sampler.onloadedmetadata = () => resolve();
        sampler.onerror = () => reject(new Error('We could not open this clip. Try another video.'));
        sampler.load();
      });
      const clipLength = Math.min(sampler.duration || duration, MAX_VIDEO_SECONDS);
      if (!clipLength || !Number.isFinite(clipLength)) throw new Error('This video has no readable duration.');
      const steps = Math.ceil(clipLength / FRAME_STEP);
      const samples: PoseSample[] = [];
      const angles: { time: number; angle: number }[] = [];
      let wasStanding = false;
      let wasLow = false;
      let repStart = 0;
      let lastStandingTime: number | null = null;
      let bottomAngle = 180;
      let lastRepAt = -1;
      const completedRepDurations: number[] = [];
      const depthValues: number[] = [];
      const landmarker = landmarkerRef.current;
      if (!landmarker) throw new Error('Pose tracking is not ready. Please try again.');

      for (let index = 0; index <= steps; index += 1) {
        const time = Math.min(index * FRAME_STEP, clipLength);
        sampler.currentTime = time;
        await waitForSeek(sampler);
        if (sampler.readyState < 2) {
          await new Promise<void>((resolve, reject) => {
            sampler.addEventListener('loadeddata', () => resolve(), { once: true });
            sampler.addEventListener('error', () => reject(new Error('This video frame could not be decoded.')), { once: true });
          });
        }
        const detection = landmarker.detectForVideo(sampler, Math.round(time * 1000));
        const landmarks = detection.landmarks?.[0];
        if (landmarks?.length) {
          samples.push({ time, landmarks: Array.from(landmarks) });
          const angle = averageKneeAngle(landmarks);
          if (angle !== null) {
            angles.push({ time, angle });
            if (angle > 145 && !wasLow) {
              wasStanding = true;
              if (lastStandingTime === null) lastStandingTime = time;
            }
            if (wasStanding && !wasLow && angle < 112 && time - lastRepAt > 0.65) {
              wasLow = true;
              repStart = time;
              bottomAngle = angle;
            } else if (wasLow) {
              bottomAngle = Math.min(bottomAngle, angle);
              if (angle > 148 && time - repStart > 0.45 && time - lastRepAt > 0.65) {
                completedRepDurations.push(
                  time - (lastStandingTime ?? repStart),
                );
                depthValues.push(bottomAngle);
                lastRepAt = time;
                lastStandingTime = time;
                wasLow = false;
                wasStanding = true;
              }
            }
          }
        }
        if (index % 3 === 0 || index === steps) setProgress(Math.min(100, Math.round(time / clipLength * 100)));
        if (time === clipLength) break;
      }
      URL.revokeObjectURL(samplerUrl);
      analysisUrl = null;
      poseSamplesRef.current = samples;
      const repCount = completedRepDurations.length;
      const averageRepSeconds = repCount
        ? completedRepDurations.reduce((sum, value) => sum + value, 0) / repCount
        : 0;
      const averageKneeAngleDegrees = depthValues.length
        ? depthValues.reduce((sum, value) => sum + value, 0) / depthValues.length
        : angles.length ? angles.reduce((sum, sample) => sum + sample.angle, 0) / angles.length : 0;
      const kneeAngleRange = depthValues.length > 1
        ? {
            min: Math.round(Math.min(...depthValues)),
            max: Math.round(Math.max(...depthValues)),
          }
        : null;
      const standardDeviation = repCount > 1
        ? Math.sqrt(completedRepDurations.reduce((sum, value) => sum + (value - averageRepSeconds) ** 2, 0) / repCount)
        : 0;
      const consistencyPercent = repCount > 1 && averageRepSeconds
        ? Math.max(0, Math.min(100, Math.round(100 - (standardDeviation / averageRepSeconds) * 100)))
        : repCount ? 100 : 0;
      const result: Metrics = {
        repetitions: repCount,
        averageKneeAngleDegrees: Math.round(Math.max(0, Math.min(180, averageKneeAngleDegrees))),
        kneeAngleRange,
        consistencyPercent,
        averageRepSeconds: Math.round(averageRepSeconds * 10) / 10,
        analyzedSeconds: Math.round(clipLength),
      };
      setMetrics(result);
      setStatus('complete');
      submitMetrics(result);
    } catch (error) {
      if (analysisUrl) URL.revokeObjectURL(analysisUrl);
      setStatus('error');
      const message = error instanceof Error ? error.message : 'Something interrupted the movement analysis.';
      setErrorMessage(message.includes('fetch') || message.includes('network')
        ? 'Pose tracking could not load. Check your connection and try again.'
        : message);
    }
  }, [duration, file, isBusy, submitMetrics]);

  const renderPose = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth || !video.videoHeight) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(bounds.width * ratio) || canvas.height !== Math.round(bounds.height * ratio)) {
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const samples = poseSamplesRef.current;
    if (!samples.length) return;
    const now = video.currentTime;
    let nearest = samples[0];
    for (const sample of samples) {
      if (Math.abs(sample.time - now) < Math.abs(nearest.time - now)) nearest = sample;
    }
    if (Math.abs(nearest.time - now) > 0.55) return;
    const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
    const offsetX = (bounds.width - video.videoWidth * scale) / 2;
    const offsetY = (bounds.height - video.videoHeight * scale) / 2;
    const position = (landmark: NormalizedLandmark) => ({
      x: offsetX + landmark.x * video.videoWidth * scale,
      y: offsetY + landmark.y * video.videoHeight * scale,
    });
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 2.4;
    context.strokeStyle = 'rgba(225, 157, 116, .94)';
    context.shadowColor = 'rgba(22, 54, 44, .45)';
    context.shadowBlur = 4;
    for (const [from, to] of CONNECTIONS) {
      const a = nearest.landmarks[from];
      const b = nearest.landmarks[to];
      if (!a || !b || (a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3) continue;
      const start = position(a);
      const end = position(b);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    context.shadowBlur = 2;
    for (let index = 11; index <= 32; index += 1) {
      const point = nearest.landmarks[index];
      if (!point || (point.visibility ?? 1) < 0.36) continue;
      const { x, y } = position(point);
      context.beginPath();
      context.fillStyle = [23, 24, 25, 26, 27, 28].includes(index) ? '#e4a17c' : '#e9eadb';
      context.arc(x, y, [23, 24, 25, 26, 27, 28].includes(index) ? 4 : 3, 0, Math.PI * 2);
      context.fill();
    }
    context.shadowBlur = 0;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      setCurrentSecond(video.currentTime || 0);
      renderPose();
    };
    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', update);
    video.addEventListener('loadedmetadata', update);
    window.addEventListener('resize', renderPose);
    return () => {
      video.removeEventListener('timeupdate', update);
      video.removeEventListener('seeked', update);
      video.removeEventListener('loadedmetadata', update);
      window.removeEventListener('resize', renderPose);
    };
  }, [renderPose, videoUrl, status]);

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  const backendStatus = health.isLoading ? 'checking' : health.isError ? 'offline' : 'connected';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="HiperMove home">
          <span className="brand-mark"><Activity aria-hidden="true" /></span>
          <span>hipermove</span>
        </div>
        <div className="backend-state" data-testid="status-backend">
          <span className={`status-dot ${backendStatus === 'connected' ? 'ready' : backendStatus === 'offline' ? 'down' : ''}`} />
          Coach {backendStatus}
        </div>
        <div className="privacy-pill"><LockKeyhole aria-hidden="true" /> Private by design</div>
      </header>

      <main className="main-wrap">
        <section className="intro" aria-labelledby="page-title">
          <div>
            <div className="eyebrow">Your form, understood</div>
            <h1 id="page-title">A little more insight.<br /><em>A lot more confidence.</em></h1>
          </div>
          <p className="intro-copy">A private movement check-in that helps you notice what your squat is already doing well.</p>
        </section>

        {errorMessage && <div className="error-banner" role="alert" data-testid="status-video-error">{errorMessage}</div>}

        <section className="workbench" aria-label="Squat session analyzer">
          <div className={`panel video-panel ${dragging ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
            <div className="panel-head">
              <div>
                <div className="panel-title">Your movement clip</div>
                <div className="panel-subtitle">Side view · full body in frame</div>
              </div>
              <div className="backend-state"><span className="status-dot ready" /> On-device analysis</div>
            </div>
            <div className="video-stage">
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    playsInline
                    onLoadedMetadata={(event) => {
                      const clipDuration = event.currentTarget.duration;
                      setDuration(clipDuration);
                      if (clipDuration > MAX_VIDEO_SECONDS) setErrorMessage('For a focused check-in, choose a clip that is 60 seconds or shorter.');
                      else setErrorMessage('');
                    }}
                    onError={() => setErrorMessage('This clip could not be played in your browser. Choose another video format.')}
                    aria-label="Selected squat video preview"
                    data-testid="video-preview"
                  />
                  <canvas ref={canvasRef} className="pose-canvas" aria-hidden="true" />
                  {(status === 'complete' || status === 'analyzing') && <span className="video-overlay-status">{status === 'analyzing' ? 'Tracking movement' : 'Pose landmarks'}</span>}
                </>
              ) : (
                <div className="empty-video">
                  <div className="upload-symbol"><ArrowUpFromLine aria-hidden="true" /></div>
                  <h2>A good rep starts with a clear view.</h2>
                  <p>Choose a short side-on clip with your whole body visible. Your video stays on this device.</p>
                  <button type="button" className="upload-button" onClick={() => inputRef.current?.click()} data-testid="button-choose-video">
                    <Upload aria-hidden="true" /> Choose a video
                  </button>
                  <div className="file-hint">MP4, MOV, WEBM · UP TO 60 SEC</div>
                </div>
              )}
              <input
                ref={inputRef}
                className="sr-only"
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm"
                onChange={(event) => acceptFile(event.currentTarget.files?.[0])}
                aria-label="Choose a squat video"
                data-testid="input-video-file"
              />
            </div>
            <div className="video-controls">
              <div className="video-meta" data-testid="text-video-meta">
                {file ? <>{file.name} · {duration ? formatDuration(duration) : 'Reading clip…'}</> : 'Drop a clip here, or browse your device'}
              </div>
              <div className="video-actions">
                {file && <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()} disabled={isBusy} data-testid="button-replace-video"><FileVideo2 aria-hidden="true" /> Replace clip</button>}
                {file && <button type="button" className="primary-button" onClick={analyze} disabled={isBusy || duration > MAX_VIDEO_SECONDS || !duration} data-testid="button-analyze">
                  {isBusy ? <><span className="pulse">●</span> {status === 'loading-model' ? 'Waking up pose tracking' : 'Reading your movement'}</> : status === 'complete' ? <><RotateCcw aria-hidden="true" /> Analyze again</> : <><Activity aria-hidden="true" /> Analyze my squat</>}
                </button>}
                {file && <button type="button" className="secondary-button" onClick={reset} disabled={isBusy} data-testid="button-clear-video">Start over</button>}
              </div>
            </div>
          </div>

          <aside className="panel analysis-panel" aria-label="Measured session metrics">
            <div className="analysis-top">
              <div>
                <h2 className="section-heading">Session snapshot</h2>
                <div className="section-kicker">Measured on your device</div>
              </div>
              <span className="analysis-icon"><Waves aria-hidden="true" /></span>
            </div>
            <div className="rep-total">
              <div className="rep-number" data-testid="text-repetition-count">{metrics ? metrics.repetitions : '—'}</div>
              <div className="rep-label">reps found<br />in this clip</div>
            </div>
            <div className="rep-note">
              {status === 'complete' && metrics?.repetitions === 0 ? 'No complete reps spotted this time. A clearer side view can help.' : 'Every number comes from the movement in this clip.'}
            </div>
            <div className="metrics-grid">
              <Metric icon={<Gauge aria-hidden="true" />} label="Knee angle" value={metrics ? `${metrics.averageKneeAngleDegrees}°` : '—'} />
              <Metric icon={<Waves aria-hidden="true" />} label="Rhythm" value={metrics ? `${metrics.consistencyPercent}%` : '—'} />
              <Metric icon={<Clock3 aria-hidden="true" />} label="Avg. rep" value={metrics ? `${metrics.averageRepSeconds.toFixed(1)}s` : '—'} />
              <Metric icon={<Activity aria-hidden="true" />} label="Clip checked" value={metrics ? `${metrics.analyzedSeconds}s` : '—'} />
            </div>
            <div className="analysis-progress">
              <div className="progress-row"><span>{isBusy ? 'Reading each movement' : status === 'complete' ? 'Session analysis' : 'Ready when you are'}</span><span>{isBusy ? `${progress}%` : status === 'complete' ? 'Complete' : '—'}</span></div>
              <div className="progress-track" role="progressbar" aria-label="Movement analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={isBusy ? progress : status === 'complete' ? 100 : 0}>
                <span style={{ width: `${isBusy ? progress : status === 'complete' ? 100 : 0}%` }} />
              </div>
              <div className={`session-state ${status === 'complete' ? 'complete' : status === 'error' ? 'error' : ''}`} role="status" data-testid="status-analysis">
                <span className={`state-mark ${isBusy ? 'pulse' : ''}`} />
                {status === 'loading-model' ? 'Preparing secure, on-device pose tracking…'
                  : status === 'analyzing' ? `Finding the rhythm in ${formatDuration(currentSecond)}`
                    : status === 'complete' ? 'Your session is ready to explore.'
                      : status === 'error' ? 'Analysis paused. Your clip is still here.'
                        : 'Add a clip to begin your check-in.'}
              </div>
              {status === 'error' && <button type="button" className="secondary-button" onClick={analyze} disabled={!file} data-testid="button-retry-analysis"><RotateCcw aria-hidden="true" /> Try analysis again</button>}
            </div>
          </aside>
        </section>

        <section className="results-section" aria-label="Coach reflection and privacy">
          <div className="panel coach-card">
            <div className="coach-topline">
              <div className="coach-label"><Sparkles aria-hidden="true" /> A note from your coach</div>
              {explanation && <span className="coach-label"><Check aria-hidden="true" /> Based on this session</span>}
            </div>
            {explanation ? (
              <>
                <h2 className="coach-headline" data-testid="text-coach-headline">{explanation.headline}</h2>
                <p className="coach-explanation" data-testid="text-coach-explanation">{explanation.explanation}</p>
                <div className="coach-tip"><strong>Try this next:</strong><span data-testid="text-coach-tip">{explanation.tip}</span></div>
              </>
            ) : (
              <>
                <h2 className="coach-headline">{metrics?.repetitions === 0 ? 'A fresh angle can tell a different story.' : 'Progress isn’t a perfect-looking rep.'}</h2>
                <p className="coach-explanation">
                  {analysisError ? 'Your form measures are ready, but your coach note is taking a little longer.' : metrics ? 'Your measurements are ready. Your short coach reflection will appear here when it is available.' : 'We look at knee bend, rep rhythm, and how consistently each repetition comes together.'}
                </p>
                <div className="coach-tip">
                  <strong>{analysisError ? 'Still here:' : 'A helpful start:'}</strong>
                  <span>{analysisError ? 'Your video stays in this browser. Only the numbers above are shared for a plain-language note.' : 'Set your phone around hip height, a few steps back, and let your full body stay in frame.'}</span>
                </div>
                {analysisError && <button type="button" className="secondary-button" style={{ marginTop: 12 }} onClick={() => metrics && submitMetrics(metrics)} disabled={explanationMutation.isPending} data-testid="button-retry-coach">
                  <RotateCcw aria-hidden="true" /> {explanationMutation.isPending ? 'Connecting…' : 'Try coach note again'}
                </button>}
              </>
            )}
          </div>
          <div className="panel how-card">
            <div>
              <div className="how-label">A private little check-in</div>
              <h3>Your video never leaves your phone.</h3>
              <p>Pose points and repetition counts are measured in your browser. Only five numeric measurements go to the coach for a short reflection.</p>
            </div>
            <div className="steps" aria-label="Analysis steps">
              <span className="step"><b>01</b> Choose</span>
              <span className="step"><b>02</b> Measure</span>
              <span className="step"><b>03</b> Reflect</span>
            </div>
          </div>
        </section>

        <section className="signals-section" aria-labelledby="signals-title">
          <div className="signals-heading">
            <div>
              <div className="how-label">What this clip can tell us</div>
              <h2 id="signals-title">Movement signals &amp; body readings</h2>
              <p>Movement comes from visible pose landmarks. Health readings need dedicated sensors.</p>
            </div>
            <span className="signals-mark"><ShieldCheck aria-hidden="true" /></span>
          </div>
          <div className="signal-grid">
            <div className="signal-card signal-card-measured" data-testid="card-knee-range">
              <div className="signal-card-top">
                <span className="signal-icon"><Waves aria-hidden="true" /></span>
                <span className="signal-status signal-status-live">From video</span>
              </div>
              <h3>Knee-angle range</h3>
              <div className="signal-value" data-testid="text-knee-angle-range">
                {metrics?.kneeAngleRange
                  ? `${metrics.kneeAngleRange.min}°–${metrics.kneeAngleRange.max}°`
                  : metrics?.repetitions === 1
                    ? '1 rep found'
                    : metrics
                      ? 'No range yet'
                      : 'After analysis'}
              </div>
              <p>Lowest knee angle across your reps. This shows variation, not knee vibration.</p>
            </div>
            <SignalCard
              icon={<HeartPulse aria-hidden="true" />}
              title="Heart rate"
              status="Pulse sensor needed"
              detail="This clip can't provide a reliable pulse reading."
              testId="card-heart-rate"
            />
            <SignalCard
              icon={<Gauge aria-hidden="true" />}
              title="Blood pressure"
              status="Cuff needed"
              detail="Video cannot measure blood pressure or “tension.”"
              testId="card-blood-pressure"
            />
            <SignalCard
              icon={<Thermometer aria-hidden="true" />}
              title="Body temperature"
              status="Thermometer needed"
              detail="Fever screening needs a thermometer or thermal sensor."
              testId="card-body-temperature"
            />
            <SignalCard
              icon={<Activity aria-hidden="true" />}
              title="Knee vibration"
              status="Not measured"
              detail="This clip's frame rate can't reliably detect tremor."
              testId="card-knee-vibration"
            />
          </div>
          <p className="signals-disclaimer">
            HiperMove is a movement prototype, not a medical device. It reports approximate movement patterns only; it does not assess fever, blood pressure, heart rate, or tremor.
          </p>
        </section>

        <footer className="privacy-footer">
          <span><ShieldCheck aria-hidden="true" /> Your clip stays on this device. It is never uploaded.</span>
          <span>{file ? file.name : 'No video selected'} {file && status === 'complete' ? '· Analysis complete' : ''}</span>
        </footer>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="metric-label">{icon}{label}</div>
      <div className="metric-value">{value}{value !== '—' && label === 'Rhythm' ? <small> consistent</small> : null}</div>
    </div>
  );
}

function SignalCard({
  icon,
  title,
  status,
  detail,
  testId,
}: {
  icon: ReactNode;
  title: string;
  status: string;
  detail: string;
  testId: string;
}) {
  return (
    <div className="signal-card" data-testid={testId}>
      <div className="signal-card-top">
        <span className="signal-icon">{icon}</span>
        <span className="signal-status">{status}</span>
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export default App;
