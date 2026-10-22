"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

type Project = {
  key: string;
  name: string;
  workspace_root?: string;
};

export default function ProjectSelector({
  currentProject,
  onChange
}: {
  currentProject: string | null;
  onChange: (key: string | null) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to load projects");
      const data = await response.json();
      setProjects(data.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await load();
    };
    run();
    return () => {
      mounted = false;
    };
  }, [load]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="project-selector" ref={ref}>
      <button
        type="button"
        className={`project-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select project"
        disabled={loading}
      >
        <Icon name="code" size={16} />
        <span className="project-name">
          {currentProject
            ? projects.find((p) => p.key === currentProject)?.name ?? currentProject
            : "All Projects"}
        </span>
        <Icon name="chevron" size={14} style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {open && (
        <ul className="project-dropdown" role="listbox" aria-label="Projects">
          <li
            role="option"
            aria-selected={!currentProject}
            className={`project-option ${!currentProject ? "selected" : ""}`}
            onClick={() => { onChange(null); setOpen(false); }}
          >
            <span className="option-content">
              <span className="option-icon">📁</span>
              <span className="option-label">All Projects</span>
            </span>
            {!currentProject && <span className="check" aria-hidden="true">✓</span>}
          </li>
          {projects.map((project) => (
            <li
              key={project.key}
              role="option"
              aria-selected={currentProject === project.key}
              className={`project-option ${currentProject === project.key ? "selected" : ""}`}
              onClick={() => { onChange(project.key); setOpen(false); }}
            >
              <span className="option-content">
                <span className="option-icon">📂</span>
                <span className="option-label">{project.name}</span>
              </span>
              {project.workspace_root && (
                <span className="option-path" title={project.workspace_root}>
                  {project.workspace_root.length > 30
                    ? "…" + project.workspace_root.slice(-30)
                    : project.workspace_root}
                </span>
              )}
              {currentProject === project.key && <span className="check" aria-hidden="true">✓</span>}
            </li>
          ))}
          {projects.length === 0 && !loading && !error && (
            <li className="project-option disabled">
              <span className="hint">No projects configured. Add one in Settings.</span>
            </li>
          )}
          {loading && <li className="hint">Loading…</li>}
          {error && <li className="notice error">{error}</li>}
        </ul>
      )}
    </div>
  );
}