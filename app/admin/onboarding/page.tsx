"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, Circle, PlayCircle, BookOpen,
  Play, Pause, Volume2, VolumeX, Maximize, RotateCcw, RotateCw,
} from "lucide-react";

interface Lesson {
  id: string;
  title: string;
  description: string;
  filename: string;
  duration: string;
}

interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}

const modules: Module[] = [
  {
    id: "module-1",
    title: "Getting Started",
    lessons: [
      {
        id: "lesson-1-1",
        title: "DonorHQ Overview",
        description: "",
        filename: "01_DonorHQ Overview.mp4",
        duration: "",
      },
      {
        id: "lesson-1-2",
        title: "Contact Search and Manual Donations",
        description: "",
        filename: "02_Donor HQ - Contact Search and Manual donations.mp4",
        duration: "",
      },
      {
        id: "lesson-1-3",
        title: "Pledge Creation",
        description: "",
        filename: "03_Donor HQ -Pledge creation.mp4",
        duration: "",
      },
      {
        id: "lesson-1-4",
        title: "Payment Plans",
        description: "",
        filename: "04_Donor HQ - Payment Plans.mp4",
        duration: "",
      },
      {
        id: "lesson-1-5",
        title: "Solicitors",
        description: "",
        filename: "05_Donor HQ - Solicitors.mp4",
        duration: "",
      },
      {
        id: "lesson-1-6",
        title: "Overview of the Left Menu",
        description: "",
        filename: "06_Donor HQ - Overview of the Left Menu.mp4",
        duration: "",
      },
    ],
  },
];

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    v.load();
  }, [src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }, []);

  const skip = useCallback((secs: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(v.currentTime + secs, 0), v.duration || 0);
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    v.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = Number(e.target.value);
    v.volume = val;
    setVolume(val);
    setMuted(val === 0);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const changeSpeed = (rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const fullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen();
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full"
        style={{ aspectRatio: "16/9", display: "block" }}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
        onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
      >
        <source src={src} type="video/mp4" />
      </video>

      {/* Controls bar */}
      <div className="bg-gray-900 px-4 pt-2 pb-3 space-y-2">
        {/* Progress bar */}
        <div className="relative group">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-gray-600"
            style={{
              background: `linear-gradient(to right, var(--color-primary, #4ade80) ${progress}%, #4b5563 ${progress}%)`,
            }}
          />
        </div>

        {/* Buttons row */}
        <div className="flex items-center gap-2">
          {/* Rewind 10s */}
          <button
            onClick={() => skip(-10)}
            className="text-white hover:text-primary transition-colors p-1"
            title="Rewind 10s"
          >
            <RotateCcw className="h-5 w-5" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            className="text-white hover:text-primary transition-colors p-1"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>

          {/* Fast forward 10s */}
          <button
            onClick={() => skip(10)}
            className="text-white hover:text-primary transition-colors p-1"
            title="Forward 10s"
          >
            <RotateCw className="h-5 w-5" />
          </button>

          {/* Time */}
          <span className="text-xs text-gray-400 tabular-nums ml-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Volume */}
          <button onClick={toggleMute} className="text-white hover:text-primary transition-colors p-1">
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolume}
            className="w-20 h-1 rounded-full appearance-none cursor-pointer accent-primary"
          />

          {/* Playback speed */}
          <select
            value={playbackRate}
            onChange={(e) => changeSpeed(Number(e.target.value))}
            className="bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-600 cursor-pointer"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>{r}x</option>
            ))}
          </select>

          {/* Fullscreen */}
          <button onClick={fullscreen} className="text-white hover:text-primary transition-colors p-1" title="Fullscreen">
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const [activeLesson, setActiveLesson] = useState<Lesson>(modules[0].lessons[0]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);
  const completedCount = completed.size;

  const toggleComplete = (lessonId: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Onboarding</h1>
          <p className="text-muted-foreground mt-1">
            Learn how to get the most out of GiveSuite
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Progress</p>
          <p className="text-2xl font-bold text-primary">
            {completedCount}/{totalLessons}
          </p>
          <div className="mt-1 h-2 w-32 rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${totalLessons > 0 ? (completedCount / totalLessons) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lesson list */}
        <div className="lg:col-span-1 space-y-4">
          {modules.map((module) => (
            <Card key={module.id}>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-foreground" />
                  <CardTitle className="text-sm font-semibold text-foreground">
                    {module.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1">
                {module.lessons.map((lesson) => {
                  const isActive = activeLesson.id === lesson.id;
                  const isDone = completed.has(lesson.id);
                  return (
                    <button
                      key={lesson.id}
                      onClick={() => setActiveLesson(lesson)}
                      className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors flex items-start gap-3 ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-gray-100 text-gray-800"
                      }`}
                    >
                      <span className="mt-0.5 shrink-0">
                        {isDone ? (
                          <CheckCircle2 className={`h-4 w-4 ${isActive ? "text-primary-foreground" : "text-primary"}`} />
                        ) : (
                          <Circle className={`h-4 w-4 ${isActive ? "text-primary-foreground" : "text-gray-400"}`} />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium leading-snug">
                          {lesson.title}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Video player */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <VideoPlayer
                src={`/api/course-videos/${encodeURIComponent(activeLesson.filename)}`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <PlayCircle className="h-4 w-4 text-primary shrink-0" />
                  <h2 className="text-lg font-semibold leading-tight">
                    {activeLesson.title}
                  </h2>
                  {completed.has(activeLesson.id) && (
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
                      Completed
                    </Badge>
                  )}
                </div>
                {activeLesson.description && (
                  <p className="text-sm text-muted-foreground">{activeLesson.description}</p>
                )}
              </div>
              <button
                onClick={() => toggleComplete(activeLesson.id)}
                className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  completed.has(activeLesson.id)
                    ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {completed.has(activeLesson.id) ? (
                  <><CheckCircle2 className="h-4 w-4" /> Mark incomplete</>
                ) : (
                  <><Circle className="h-4 w-4" /> Mark complete</>
                )}
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
