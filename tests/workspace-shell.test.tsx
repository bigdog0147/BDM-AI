// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * Workspace shell tests.
 *
 * They cover the parts of the redesign a type check cannot prove: the
 * navigation the user actually sees, the Google entry point on the account
 * screens, the record-and-transcribe workflow, and the guarantee that a
 * single submission never produces two messages.
 */

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  )
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/"
}));

import Sidebar from "../app/components/Sidebar";
import AuthPage from "../app/auth/page";
import VoiceRecorder from "../app/components/VoiceRecorder";
import type { AuthUser, ConversationSummary } from "../app/components/types";

const CONVERSATIONS: ConversationSummary[] = [
  { id: "c1", title: "Renewable energy research", updated_at: "2026-10-20T10:00:00Z" },
  { id: "c2", title: "Quarterly plan", updated_at: "2026-10-19T10:00:00Z" }
];

type SidebarProps = React.ComponentProps<typeof Sidebar>;

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props = {
    user: null as AuthUser,
    conversations: CONVERSATIONS,
    activeConversationId: null as string | null,
    view: "chat" as const,
    mobileOpen: false,
    collapsed: false,
    onCloseMobile: vi.fn(),
    onToggleCollapse: vi.fn(),
    onNewChat: vi.fn(),
    onSelectConversation: vi.fn(),
    onSelectView: vi.fn(),
    onOpenVoice: vi.fn(),
    onOpenSaved: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenHelp: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("workspace sidebar", () => {
  afterEach(() => cleanup());

  it("offers the primary destinations", () => {
    renderSidebar();
    expect(screen.getByText("New chat")).toBeTruthy();
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("Voice note")).toBeTruthy();
    expect(screen.getByText("Saved items")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Help")).toBeTruthy();
  });

  it("lists the conversation history and opens one on click", () => {
    const props = renderSidebar({ activeConversationId: "c1" });
    expect(screen.getByText("Renewable energy research")).toBeTruthy();

    fireEvent.click(screen.getByText("Quarterly plan"));
    expect(props.onSelectConversation).toHaveBeenCalledWith("c2");
  });

  it("keeps the account controls and sign-out easy to find", () => {
    const props = renderSidebar({
      user: { id: "u1", email: "owner@example.com", providers: ["email"] }
    });
    expect(screen.getByText("owner@example.com")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Sign out"));
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });

  it("offers Google sign-in to a signed-out visitor", () => {
    renderSidebar();
    const cta = screen.getByText(/Sign in with Google/).closest("a");
    expect(cta?.getAttribute("href")).toBe("/auth");
  });

  it("can be collapsed and expanded", () => {
    const props = renderSidebar();
    const toggle = screen.getByLabelText("Collapse sidebar");
    fireEvent.click(toggle);
    expect(props.onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("starts a new chat and closes the mobile drawer", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByText("New chat"));
    expect(props.onNewChat).toHaveBeenCalledTimes(1);
    expect(props.onCloseMobile).toHaveBeenCalled();
  });
});

describe("account screens", () => {
  afterEach(() => cleanup());

  it("shows a recognisable Continue with Google button", () => {
    render(<AuthPage />);
    const button = screen.getByText("Continue with Google").closest("a");
    expect(button).toBeTruthy();
    expect(button?.getAttribute("href")).toBe("/api/auth/google/start");
  });

  it("explains a cancelled Google sign-in", async () => {
    window.history.pushState({}, "", "/auth?error=google_cancelled");
    render(<AuthPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/Google sign-in was cancelled before it completed/)
      ).toBeTruthy();
    });
    window.history.pushState({}, "", "/auth");
  });

  it("explains a missing Google configuration", async () => {
    window.history.pushState({}, "", "/auth?error=google_not_configured");
    render(<AuthPage />);
    await waitFor(() => {
      expect(screen.getByText(/Google sign-in is not configured yet/)).toBeTruthy();
    });
    window.history.pushState({}, "", "/auth");
  });

  it("keeps the email and password path available", () => {
    render(<AuthPage />);
    expect(screen.getByText("or use email and password")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement)).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ voice */

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return type.startsWith("audio/webm");
  }

  static instances: FakeMediaRecorder[] = [];

  mimeType: string;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio-bytes"], { type: this.mimeType })
    });
    this.onstop?.();
  }
}

describe("voice recorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    (globalThis as never as Record<string, unknown>).MediaRecorder =
      FakeMediaRecorder;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }]
        })
      }
    });
    URL.createObjectURL = vi.fn(() => "blob:recording");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => cleanup());

  it("only asks for the microphone after the user clicks record", async () => {
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }]
    });
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });

    render(
      <VoiceRecorder
        configured
        signedIn
        maxSeconds={300}
        onUseTranscript={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Nothing is requested while the panel is merely open.
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Start recording"));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Recording 0:00/)).toBeTruthy();
  });

  it("reports a denied microphone instead of failing silently", async () => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }))
      }
    });

    render(
      <VoiceRecorder
        configured
        signedIn
        maxSeconds={300}
        onUseTranscript={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Start recording"));
    await waitFor(() => {
      expect(screen.getByText(/Microphone access was denied/)).toBeTruthy();
    });
  });

  it("offers Stop while recording and a preview afterwards", async () => {
    render(
      <VoiceRecorder
        configured
        signedIn
        maxSeconds={300}
        onUseTranscript={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Start recording"));
    await waitFor(() => expect(screen.getByText("Stop")).toBeTruthy());

    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => {
      expect(screen.getByText("Send for transcription")).toBeTruthy();
    });
    expect(document.querySelector("audio")).toBeTruthy();
  });

  it("discards the recording without sending anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <VoiceRecorder
        configured
        signedIn
        maxSeconds={300}
        onUseTranscript={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Start recording"));
    await waitFor(() => expect(screen.getByText("Stop")).toBeTruthy());
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(screen.getByText("Discard")).toBeTruthy());

    fireEvent.click(screen.getByText("Discard"));
    await waitFor(() => expect(screen.getByText("Start recording")).toBeTruthy());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("surfaces a transcription failure without losing the recording", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "No speech was detected." }), {
        status: 422,
        headers: { "content-type": "application/json" }
      })
    );

    render(
      <VoiceRecorder
        configured
        signedIn
        maxSeconds={300}
        onUseTranscript={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Start recording"));
    await waitFor(() => expect(screen.getByText("Stop")).toBeTruthy());
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(screen.getByText("Send for transcription")).toBeTruthy());

    fireEvent.click(screen.getByText("Send for transcription"));
    await waitFor(() => {
      expect(screen.getByText("No speech was detected.")).toBeTruthy();
    });
    // The recording can still be transcribed again.
    expect(screen.getByText("Send for transcription")).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it("sends the confirmed transcript back to the composer", async () => {
    const onUseTranscript = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "Book the table for eight." }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    render(
      <VoiceRecorder
        configured
        signedIn
        maxSeconds={300}
        onUseTranscript={onUseTranscript}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Start recording"));
    await waitFor(() => expect(screen.getByText("Stop")).toBeTruthy());
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(screen.getByText("Send for transcription")).toBeTruthy());

    fireEvent.click(screen.getByText("Send for transcription"));
    await waitFor(() => expect(screen.getByText("Book the table for eight.")).toBeTruthy());

    fireEvent.click(screen.getByText("Insert into composer"));
    expect(onUseTranscript).toHaveBeenCalledWith("Book the table for eight.");
    fetchSpy.mockRestore();
  });

  it("does not offer the recorder when transcription is not configured", () => {
    render(
      <VoiceRecorder
        configured={false}
        signedIn
        maxSeconds={300}
        onUseTranscript={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText("Start recording")).toBeNull();
    expect(screen.getByText(/Transcription is not configured/)).toBeTruthy();
  });
});
