"use client";

import { Icon, type IconName } from "./Icons";
import BrandLogo from "./BrandLogo";

type Suggestion = {
  icon: IconName;
  title: string;
  description: string;
  action: "chat" | "research";
  seed: string;
};

/**
 * The empty state of the conversation.
 *
 * Restrained on purpose: a mark, a greeting, one line of orientation and a
 * short set of suggestions that each perform a real action. Every suggestion
 * either fills the composer or opens the research workflow, so nothing here
 * is decorative-only.
 */
export default function Welcome({
  greeting,
  name,
  researchReady,
  onChat,
  onResearch,
  onVoice
}: {
  greeting: string;
  name: string | null;
  researchReady: boolean;
  onChat: (seed: string) => void;
  onResearch: (seed: string) => void;
  /** When provided, a voice note suggestion is offered as well. */
  onVoice?: () => void;
}) {
  const suggestions: Suggestion[] = [
    {
      icon: "sparkle",
      title: "Plan something",
      description: "Turn a goal into a realistic plan with clear next steps.",
      action: "chat",
      seed: "Help me plan the following, step by step: "
    },
    {
      icon: "message",
      title: "Understand a topic",
      description: "Get a plain-language explanation you can actually use.",
      action: "chat",
      seed: "Explain this in plain language: "
    },
    {
      icon: "code",
      title: "Work with code",
      description: "Draft, review or debug a snippet with a working answer.",
      action: "chat",
      seed: "Review this code and suggest improvements: "
    },
    {
      icon: "globe",
      title: "Research the web",
      description: researchReady
        ? "Get an answer built from real sources, with citations."
        : "Needs a search provider key on the server.",
      action: "research",
      seed: ""
    }
  ];

  return (
    <div className="welcome">
      <div className="welcome-mark">
        <BrandLogo variant="emblem" size={64} decorative />
      </div>
      <p className="welcome-eyebrow">BDM Personal AI</p>
      <h1 className="welcome-title">
        {greeting}
        {name ? <span className="welcome-name">, {name}</span> : null}
      </h1>
      <p className="welcome-sub">
        Ask anything, speak a note, or send a question to the web. BDM keeps
        your history, remembers what you ask it to remember, and always shows
        its sources.
      </p>

      <div className="suggestions" role="list">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            role="listitem"
            className="suggestion"
            onClick={() =>
              suggestion.action === "research"
                ? onResearch(suggestion.seed)
                : onChat(suggestion.seed)
            }
          >
            <span className="suggestion-icon" aria-hidden="true">
              <Icon name={suggestion.icon} size={18} />
            </span>
            <span className="suggestion-text">
              <span className="suggestion-title">{suggestion.title}</span>
              <span className="suggestion-desc">{suggestion.description}</span>
            </span>
            <Icon name="arrow" size={16} className="suggestion-arrow" />
          </button>
        ))}

        {onVoice ? (
          <button
            type="button"
            role="listitem"
            className="suggestion"
            onClick={onVoice}
          >
            <span className="suggestion-icon" aria-hidden="true">
              <Icon name="mic" size={18} />
            </span>
            <span className="suggestion-text">
              <span className="suggestion-title">Speak a note</span>
              <span className="suggestion-desc">
                Record a voice note and have it transcribed.
              </span>
            </span>
            <Icon name="arrow" size={16} className="suggestion-arrow" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
