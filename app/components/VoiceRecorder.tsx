"use client";

import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "requesting" | "recording" | "recorded" | "transcribing" | "review";

const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg"
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function VoiceRecorder({
  configured,
  maxSeconds,
  onUseTranscript,
  onClose
}: {
  configured: boolean;
  maxSeconds: number;
  onUseTranscript: (text: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlRef = useRef<string | null>(null);
  /** Set while a discard is in flight, so a late onstop cannot resurrect it. */
  const discardedRef = useRef(false);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const releaseUrl = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setAudioUrl(null);
  };

  useEffect(() => {
    return () => {
      discardedRef.current = true;
      clearTimer();
      releaseStream();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    };
  }, []);

  /**
   * Enforce the duration cap from render state.
   *
   * This deliberately is not done inside the setSeconds updater: calling
   * stop() there is a side effect during render, and React may invoke the
   * updater twice in development.
   */
  useEffect(() => {
    if (phase !== "recording" || seconds < maxSeconds) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, [phase, seconds, maxSeconds]);

  async function start() {
    setError(null);
    setTranscript("");
    releaseUrl();
    discardedRef.current = false;
    blobRef.current = null;
    chunksRef.current = [];

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("This browser does not support microphone recording.");
      setPhase("idle");
      return;
    }

    setPhase("requesting");
    let stream: MediaStream;
    try {
      // Permission is requested only here, after the user clicks the mic.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was denied. Allow it in your browser settings and try again."
          : name === "NotFoundError"
            ? "No microphone was found on this device."
            : "The microphone could not be started."
      );
      setPhase("idle");
      return;
    }

    streamRef.current = stream;
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      releaseStream();
      setError("This browser could not start a recording.");
      setPhase("idle");
      return;
    }

    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      releaseStream();
      clearTimer();
      // A discard stops the recorder too. Its late onstop must not bring the
      // recording back as a reviewable blob.
      if (discardedRef.current) {
        chunksRef.current = [];
        return;
      }
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || "audio/webm"
      });
      chunksRef.current = [];
      if (blob.size === 0) {
        setError("The recording was empty. Try again and speak a little longer.");
        setPhase("idle");
        return;
      }
      blobRef.current = blob;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setAudioUrl(url);
      setPhase("recorded");
    };

    recorder.start();
    setSeconds(0);
    setPhase("recording");
    timerRef.current = setInterval(() => {
      // The cap is enforced by the effect above, not inside this updater.
      setSeconds((current) => Math.min(maxSeconds, current + 1));
    }, 1000);
  }

  function stop() {
    discardedRef.current = false;
    clearTimer();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      releaseStream();
      setPhase((current) => (current === "recording" ? "idle" : current));
    }
  }

  function discard() {
    discardedRef.current = true;
    clearTimer();
    releaseStream();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    releaseUrl();
    blobRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
    setTranscript("");
    setError(null);
    setPhase("idle");
  }

  async function transcribe() {
    const blob = blobRef.current;
    if (!blob) {
      setError("There is no recording to transcribe.");
      return;
    }
    setPhase("transcribing");
    setError(null);

    try {
      const form = new FormData();
      const extension = blob.type.includes("mp4")
        ? "mp4"
        : blob.type.includes("ogg")
          ? "ogg"
          : "webm";
      form.append("audio", blob, `recording.${extension}`);
      // The recorder is the source of truth for elapsed time.
      form.append("durationSeconds", String(Math.max(1, seconds)));

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: form
      });
      const data = (await response.json()) as { text?: string; error?: string };

      if (!response.ok || typeof data.text !== "string") {
        throw new Error(data.error || "The recording could not be transcribed.");
      }
      setTranscript(data.text);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recording could not be transcribed.");
      setPhase("recorded");
    }
  }

  function useTranscript() {
    const text = transcript.trim();
    if (!text) return;
    onUseTranscript(text);
    discard();
    onClose();
  }

  const busy = phase === "requesting" || phase === "transcribing";

  return (
    <section className="panel" aria-label="Voice note">
      <div className="panel-head">
        <strong>Voice note</strong>
        <button type="button" className="ghost" onClick={() => { discard(); onClose(); }}>
          Close
        </button>
      </div>

      {!configured && (
        <p className="notice">
          Transcription is not configured. Add an OpenAI API key on the server to enable
          it. Recording is disabled.
        </p>
      )}

      {configured && (
        <p className="hint">
          Your recording is uploaded to OpenAI for transcription only. It is not saved
          by BDM: the audio is discarded after the transcript is returned.
        </p>
      )}

      <div className="voice-row">
        <span className={`record-dot ${phase === "recording" ? "live" : ""}`} aria-hidden="true" />
        <span className="voice-state" aria-live="polite">
          {phase === "idle" && "Ready"}
          {phase === "requesting" && "Waiting for microphone permission…"}
          {phase === "recording" && `Recording ${formatTime(seconds)} / ${formatTime(maxSeconds)}`}
          {phase === "recorded" && `Recorded ${formatTime(seconds)}`}
          {phase === "transcribing" && "Transcribing…"}
          {phase === "review" && "Review the transcript before sending"}
        </span>
      </div>

      {audioUrl && (
        <audio controls src={audioUrl} className="audio-preview">
          <track kind="captions" />
        </audio>
      )}

      <div className="panel-actions">
        {(phase === "idle" || phase === "recorded") && configured && (
          <button type="button" onClick={() => void start()} disabled={busy}>
            {phase === "recorded" ? "Re-record" : "Start recording"}
          </button>
        )}
        {phase === "recording" && (
          <button type="button" onClick={stop}>
            Stop
          </button>
        )}
        {phase === "recorded" && configured && (
          <button type="button" onClick={() => void transcribe()} disabled={busy}>
            Transcribe
          </button>
        )}
        {(phase === "recorded" || phase === "review") && (
          <button type="button" className="ghost danger" onClick={discard} disabled={busy}>
            Discard
          </button>
        )}
      </div>

      {phase === "review" && (
        <div className="transcript-review">
          <label htmlFor="transcript">Transcript (edit before sending)</label>
          <textarea
            id="transcript"
            rows={4}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
          <div className="panel-actions">
            <button type="button" onClick={useTranscript} disabled={!transcript.trim()}>
              Use transcript
            </button>
            <button type="button" className="ghost" onClick={() => void transcribe()} disabled={busy}>
              Transcribe again
            </button>
          </div>
        </div>
      )}

      {error && <p className="notice error">{error}</p>}
    </section>
  );
}
