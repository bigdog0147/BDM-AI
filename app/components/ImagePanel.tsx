"use client";

import { useState } from "react";

export type GeneratedImage = {
  dataUrl: string;
  mimeType: string;
  size: string;
  quality: string;
  model: string;
  provider: string;
  createdAt: string;
};

const SIZES = [
  { value: "1024x1024", label: "Square (1024×1024)" },
  { value: "1024x1536", label: "Portrait (1024×1536)" },
  { value: "1536x1024", label: "Landscape (1536×1024)" }
];

const QUALITIES = [
  { value: "low", label: "Low (fastest, cheapest)" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

export default function ImagePanel({
  configured,
  onGenerated,
  onClose
}: {
  configured: boolean;
  onGenerated: (image: GeneratedImage, prompt: string) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("low");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<GeneratedImage | null>(null);

  async function generate() {
    const text = prompt.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    setImage(null);

    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, size, quality })
      });
      const data = (await response.json()) as {
        image?: GeneratedImage;
        error?: string;
      };

      if (!response.ok || !data.image) {
        throw new Error(data.error || "The image could not be generated.");
      }

      setImage(data.image);
      onGenerated(data.image, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The image could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Generate an image">
      <div className="panel-head">
        <strong>Generate image</strong>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {!configured && (
        <p className="notice">
          Image generation is not configured. Add an OpenAI API key on the server to
          enable it. No request will be sent.
        </p>
      )}

      <label className="field-label" htmlFor="image-prompt">
        Prompt
      </label>
      <textarea
        id="image-prompt"
        rows={3}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="A lighthouse at dusk, long exposure, muted colours…"
        maxLength={1000}
        disabled={!configured || busy}
      />

      <div className="panel-grid">
        <label>
          <span className="field-label">Size</span>
          <select
            value={size}
            onChange={(event) => setSize(event.target.value)}
            disabled={!configured || busy}
          >
            {SIZES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Quality</span>
          <select
            value={quality}
            onChange={(event) => setQuality(event.target.value)}
            disabled={!configured || busy}
          >
            {QUALITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel-actions">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!configured || busy || prompt.trim().length < 3}
        >
          {busy ? "Generating…" : "Generate"}
        </button>
        {image && (
          <a
            className="auth-btn"
            href={image.dataUrl}
            download={`bdm-image-${image.createdAt.replace(/[:.]/g, "-")}.png`}
          >
            Download
          </a>
        )}
      </div>

      {busy && <p className="hint">Generating. This can take up to a minute.</p>}
      {error && <p className="notice error">{error}</p>}

      {image && (
        <figure className="image-result">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimisable remote asset */}
          <img src={image.dataUrl} alt={prompt || "Generated image"} />
          <figcaption className="hint">
            {image.model} · {image.size} · {image.quality}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
