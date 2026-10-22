"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icons";

type Capability = {
  key: string;
  name: string;
  category: string;
  available: boolean;
  reason?: string;
  operations: Array<{
    name: string;
    permissionKey: string;
    requiresApproval: boolean;
  }>;
};

type Permission = {
  tool_key: string;
  permission_level: "deny" | "ask" | "allow";
};

export default function CapabilitiesPanel({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [capsRes, permsRes] = await Promise.all([
        fetch("/api/capabilities"),
        fetch("/api/permissions")
      ]);
      if (!capsRes.ok || !permsRes.ok) throw new Error("Failed to load");
      const capsData = await capsRes.json();
      const permsData = await permsRes.json();
      setCaps(capsData.capabilities ?? []);
      setPerms(permsData.permissions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load capabilities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await load();
    };
    run();
    return () => {
      mounted = false;
    };
  }, [open, load]);

  const permMap = new Map(perms.map((p) => [p.tool_key, p.permission_level]));

  const categoryOrder = [
    "read",
    "reversible",
    "external",
    "high-impact"
  ];

  const grouped = caps.reduce((acc, cap) => {
    if (!acc[cap.category]) acc[cap.category] = [];
    acc[cap.category].push(cap);
    return acc;
  }, {} as Record<string, Capability[]>);

  const getStatusIcon = (available: boolean) => (
    <span className={`status-dot ${available ? "ok" : "warn"}`} aria-hidden="true" />
  );

  const getPermBadge = (key: string) => {
    const level = permMap.get(key) ?? "deny";
    return (
      <span className={`perm-badge ${level}`}>{level}</span>
    );
  };

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Capabilities & permissions"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2>Capabilities & Permissions</h2>
            <p className="hint">
              Tool availability, permission levels, and health status.
            </p>
          </div>
          <button type="button" className="auth-btn" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        {error && <p className="notice error">{error}</p>}
        {loading && <p className="hint">Loading…</p>}

        <div className="capabilities-list">
          {categoryOrder.map((category) => {
            const items = grouped[category];
            if (!items || items.length === 0) return null;
            return (
              <section key={category} className="capability-category">
                <h3 className="category-title">
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </h3>
                <ul>
                  {items.map((cap) => (
                    <li key={cap.key} className="capability-item">
                      <div className="capability-header">
                        <div className="capability-title-row">
                          {getStatusIcon(cap.available)}
                          <strong>{cap.name}</strong>
                          <span className="capability-key">{cap.key}</span>
                        </div>
                        <button
                          type="button"
                          className={`collapse-toggle ${activeCategory === cap.key ? "open" : ""}`}
                          onClick={() => setActiveCategory(activeCategory === cap.key ? null : cap.key)}
                          aria-expanded={activeCategory === cap.key}
                        >
                          <Icon name="chevron" size={14} />
                        </button>
                      </div>

                      {activeCategory === cap.key && (
                        <div className="capability-details">
                          {!cap.available && cap.reason && (
                            <p className="notice warn">
                              Unavailable: {cap.reason}
                            </p>
                          )}

                          <h4>Operations</h4>
                          <ul className="operation-list">
                            {cap.operations.map((op) => (
                              <li key={op.name} className="operation-item">
                                <div className="operation-info">
                                  <span className="operation-name">{op.name}</span>
                                  <span className="operation-key">{op.permissionKey}</span>
                                </div>
                                <div className="operation-meta">
                                  {getPermBadge(op.permissionKey)}
                                  {op.requiresApproval && (
                                    <span className="approval-badge">Approval required</span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          )}
        </div>

        <footer className="drawer-foot">
          <Link href="/settings" className="btn ghost">
            <Icon name="settings" size={15} />
            Full settings
          </Link>
        </footer>
      </aside>
    </div>
  );
}