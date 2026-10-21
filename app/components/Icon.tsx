import type { SVGProps } from "react";

export type IconName =
  | "plus"
  | "chat"
  | "research"
  | "library"
  | "settings"
  | "mic"
  | "image"
  | "mail"
  | "send"
  | "menu"
  | "chevron-left"
  | "chevron-right"
  | "logout"
  | "google"
  | "check"
  | "alert"
  | "x"
  | "arrow-up-right"
  | "sparkles"
  | "stop"
  | "trash"
  | "user"
  | "lock"
  | "globe"
  | "panel"
  | "refresh"
  | "shield"
  | "copy"
  | "volume"
  | "arrow-down-left"
  | "home"
  | "history"
  | "bookmark"
  | "help"
  | "bell"
  | "sun"
  | "paperclip"
  | "lightning";

/**
 * Small inline icon set. Keeping icons local avoids shipping another runtime
 * dependency and keeps the visual language consistent across the workspace.
 */
export default function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  switch (name) {
    case "plus":
      return <svg {...common} {...props}><path d="M12 5v14M5 12h14" /></svg>;
    case "chat":
      return <svg {...common} {...props}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.2 9.2 0 0 1-3.6-.7L3 21l1.8-5.2A8.4 8.4 0 1 1 21 11.5Z" /></svg>;
    case "research":
      return <svg {...common} {...props}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6M11 8.2v5.6M8.2 11h5.6" /></svg>;
    case "library":
      return <svg {...common} {...props}><path d="M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v14L12 16.5 4.5 20V6A1.5 1.5 0 0 1 6 4.5Z" /></svg>;
    case "settings":
      return <svg {...common} {...props}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
    case "mic":
      return <svg {...common} {...props}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" /></svg>;
    case "image":
      return <svg {...common} {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="8.5" cy="9" r="1.4" /><path d="m4.5 17 4.7-4.7 3.4 3.4 2.2-2.2 4.7 4.7" /></svg>;
    case "mail":
      return <svg {...common} {...props}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>;
    case "send":
      return <svg {...common} {...props}><path d="M4 12 20 4l-5.5 16-3.2-6.8L4 12Z" /><path d="m11.3 13.2 3.4-3.4" /></svg>;
    case "menu":
      return <svg {...common} {...props}><path d="M4 7h16M4 12h16M4 17h10" /></svg>;
    case "chevron-left":
      return <svg {...common} {...props}><path d="m14.5 6-6 6 6 6" /></svg>;
    case "chevron-right":
      return <svg {...common} {...props}><path d="m9.5 6 6 6-6 6" /></svg>;
    case "logout":
      return <svg {...common} {...props}><path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M9 12h9" /></svg>;
    case "google":
      return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}><path fill="#4285F4" d="M21.6 12.23c0-.68-.06-1.33-.17-1.96H12v3.71h5.39a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.97-4.33 2.97-7.28Z" /><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.44l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.41 13.89A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.89V7.52H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.48l3.35-2.59Z" /><path fill="#EA4335" d="M12 5.99c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.94 5.52l3.35 2.59C7.2 7.75 9.4 5.99 12 5.99Z" /></svg>;
    case "check":
      return <svg {...common} {...props}><path d="m5 12.5 4.2 4.2L19 6.8" /></svg>;
    case "alert":
      return <svg {...common} {...props}><path d="M12 3.5 21 20H3L12 3.5Z" /><path d="M12 9v5M12 17.2v.1" /></svg>;
    case "x":
      return <svg {...common} {...props}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "arrow-up-right":
      return <svg {...common} {...props}><path d="M7 17 17 7M8 7h9v9" /></svg>;
    case "sparkles":
      return <svg {...common} {...props}><path d="m12 3 1.4 4.2L17.5 8.5l-4.1 1.3L12 14l-1.4-4.2-4.1-1.3 4.1-1.3L12 3ZM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 13l.7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7L5 13Z" /></svg>;
    case "stop":
      return <svg {...common} {...props}><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" /></svg>;
    case "trash":
      return <svg {...common} {...props}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5" /></svg>;
    case "user":
      return <svg {...common} {...props}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
    case "lock":
      return <svg {...common} {...props}><rect x="5" y="10" width="14" height="10" rx="2.5" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" /></svg>;
    case "globe":
      return <svg {...common} {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" /></svg>;
    case "panel":
      return <svg {...common} {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></svg>;
    case "refresh":
      return <svg {...common} {...props}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9A7 7 0 0 1 18.6 7M17.9 15A7 7 0 0 1 5.4 17" /></svg>;
    case "shield":
      return <svg {...common} {...props}><path d="M12 3 19 6v5.5c0 4.2-2.8 7.5-7 9.5-4.2-2-7-5.3-7-9.5V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "copy":
      return <svg {...common} {...props}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
    case "volume":
      return <svg {...common} {...props}><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
    case "arrow-down-left":
      return <svg {...common} {...props}><path d="M17 7 7 17M16 17H7v-10" /></svg>;
    case "home":
      return <svg {...common} {...props}><path d="m4 11 8-6.5 8 6.5" /><path d="M6 10.5V19h12v-8.5" /></svg>;
    case "history":
      return <svg {...common} {...props}><path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8" /><path d="M3.5 3.5V8H8M12 7.5V12l3 1.8" /></svg>;
    case "bookmark":
      return <svg {...common} {...props}><path d="M6.5 4.5h11v15L12 16l-5.5 3.5v-15Z" /></svg>;
    case "help":
      return <svg {...common} {...props}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.2 2.4c-.8.3-1.3 1-1.3 1.9v.4" /><path d="M12 17.2h.01" /></svg>;
    case "bell":
      return <svg {...common} {...props}><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5Z" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /></svg>;
    case "sun":
      return <svg {...common} {...props}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>;
    case "paperclip":
      return <svg {...common} {...props}><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>;
    case "lightning":
      return <svg {...common} {...props}><path d="M13 3 5.5 13.5H11l-1 7.5 8-11H12l1-7Z" /></svg>;
    default:
      return null;
  }
}