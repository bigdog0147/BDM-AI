"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon, GoogleIcon, type IconName } from "./Icons";
import BrandLogo from "./BrandLogo";
import type { AuthUser, ConversationSummary } from "./types";
import { formatRelativeTime, initialsFromEmail } from "../../lib/workspace";

export type WorkspaceView = "chat" | "research";

function NavItem({
  icon,
  label,
  active,
  onClick,
  href,
  title
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  title?: string;
}) {
  const inner = (
    <>
      <span className="nav-icon" aria-hidden="true">
        <Icon name={icon} size={17} />
      </span>
      <span className="nav-label">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link
        className={`nav-item${active ? " active" : ""}`}
        href={href}
        aria-current={active ? "page" : undefined}
        title={title ?? label}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={`nav-item${active ? " active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={title ?? label}
    >
      {inner}
    </button>
  );
}

/**
 * The workspace navigation.
 *
 * It is deliberately compact: the primary actions, the conversation history
 * the account actually owns, and the account controls. Provider diagnostics
 * live on the Settings page, not here.
 */
export default function Sidebar({
  user,
  conversations,
  activeConversationId,
  view,
  mobileOpen,
  collapsed,
  onCloseMobile,
  onToggleCollapse,
  onNewChat,
  onSelectConversation,
  onSelectView,
  onOpenVoice,
  onOpenSaved,
  onOpenSettings,
  onOpenHelp,
  onSignOut
}: {
  user: AuthUser;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  view: WorkspaceView;
  mobileOpen: boolean;
  collapsed: boolean;
  onCloseMobile: () => void;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onSelectView: (next: WorkspaceView) => void;
  onOpenVoice: () => void;
  onOpenSaved: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onSignOut: () => void;
}) {
  const [historyQuery, setHistoryQuery] = useState("");

  const filtered = useMemo(() => {
    const term = historyQuery.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((item) =>
      (item.title ?? "").toLowerCase().includes(term)
    );
  }, [conversations, historyQuery]);

  const displayName = user?.email?.split("@")[0] ?? "Guest";
  const initial = initialsFromEmail(user?.email ?? null);

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close navigation"
          onClick={onCloseMobile}
        />
      ) : null}

      <aside
        className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-inner">
          <div className="sidebar-head">
            <Link
              href="/"
              className="sidebar-brand"
              aria-label="BDM Personal AI home"
              onClick={onCloseMobile}
            >
              <BrandLogo variant="emblem" size={38} decorative />
              <span className="sidebar-brand-copy">
                <span className="sidebar-brand-name">BDM</span>
                <span className="sidebar-brand-tag">Personal AI</span>
              </span>
            </Link>
            <button
              type="button"
              className="icon-btn nav-toggle"
              onClick={onToggleCollapse}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icon name="menu" size={17} />
            </button>
          </div>

          <button
            type="button"
            className="new-chat"
            onClick={() => {
              onNewChat();
              onCloseMobile();
            }}
            title="Start a new conversation"
          >
            <Icon name="plus" size={17} />
            <span className="new-chat-label">New chat</span>
          </button>

          <nav className="nav" aria-label="Primary">
            <NavItem
              icon="message"
              label="Chat"
              active={view === "chat"}
              onClick={() => {
                onSelectView("chat");
                onCloseMobile();
              }}
            />
            <NavItem
              icon="globe"
              label="Research"
              active={view === "research"}
              onClick={() => {
                onSelectView("research");
                onCloseMobile();
              }}
            />
            <NavItem
              icon="mic"
              label="Voice note"
              onClick={() => {
                onOpenVoice();
                onCloseMobile();
              }}
            />
            <NavItem
              icon="memory"
              label="Saved items"
              onClick={() => {
                onOpenSaved();
                onCloseMobile();
              }}
            />
          </nav>

          <section className="history-section sidebar-section" aria-label="Chat history">
            <div className="sidebar-label-row">
              <h2 className="sidebar-label">History</h2>
              <span className="sidebar-count">{conversations.length}</span>
            </div>

            {conversations.length > 0 ? (
              <>
                <div className="topbar-search">
                  <Icon name="history" size={15} />
                  <input
                    type="search"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder="Search conversations"
                    aria-label="Search conversations"
                  />
                </div>
                {filtered.length === 0 ? (
                  <p className="sidebar-empty">
                    No conversation matches that search.
                  </p>
                ) : (
                  <ul className="history-list">
                    {filtered.map((conversation) => (
                      <li key={conversation.id}>
                        <button
                          type="button"
                          className={`history-item${
                            conversation.id === activeConversationId ? " active" : ""
                          }`}
                          onClick={() => {
                            onSelectConversation(conversation.id);
                            onCloseMobile();
                          }}
                          title={conversation.title || "Untitled conversation"}
                        >
                          <span className="history-title">
                            {conversation.title || "Untitled conversation"}
                          </span>
                          <span className="history-time">
                            {formatRelativeTime(conversation.updated_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="sidebar-empty">
                {user
                  ? "Your conversations will appear here."
                  : "Sign in to keep your conversations."}
              </p>
            )}
          </section>

          <div className="sidebar-foot">
            <nav className="nav" aria-label="Support">
              <NavItem
                icon="settings"
                label="Settings"
                onClick={() => {
                  onOpenSettings();
                  onCloseMobile();
                }}
              />
              <NavItem
                icon="help"
                label="Help"
                onClick={() => {
                  onOpenHelp();
                  onCloseMobile();
                }}
              />
            </nav>

            {user ? (
              <div className="user-chip">
                <span className="avatar avatar-sm" aria-hidden="true">
                  {initial}
                </span>
                <span className="account-copy">
                  <strong>{displayName}</strong>
                  <span className="user-email">{user.email}</span>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={onSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <Icon name="logout" size={16} />
                </button>
              </div>
            ) : (
              <Link className="nav-cta" href="/auth">
                <GoogleIcon size={15} /> Sign in with Google
              </Link>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
