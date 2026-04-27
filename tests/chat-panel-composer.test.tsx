import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PhotoAttachment } from "@/components/photo-attach";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  apiGetCase: vi.fn(),
  readSseStream: vi.fn(),
}));

vi.mock("@/lib/client-analytics", () => ({
  analytics: {
    chatSent: vi.fn(),
    chatError: vi.fn(),
  },
}));

vi.mock("@/components/voice-button", () => ({
  VoiceButton: () => <button type="button" data-testid="mock-voice-button">Voice</button>,
}));

vi.mock("@/components/photo-attach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/photo-attach")>();

  return {
    ...actual,
    PhotoAttachButton: ({ onAttach }: { onAttach: (attachment: PhotoAttachment) => void }) => (
      <button
        type="button"
        data-testid="mock-photo-attach-button"
        onClick={() =>
          onAttach({
            id: "photo_test",
            dataUrl: "data:image/jpeg;base64,abc",
            fileName: "photo.jpg",
            sizeBytes: 123,
          })
        }
      >
        Attach
      </button>
    ),
    PhotoPreviewGrid: ({ attachments }: { attachments: PhotoAttachment[] }) => (
      <div data-testid="mock-photo-preview-grid">{attachments.length}/10 photos</div>
    ),
  };
});

import { ChatPanel } from "@/components/chat-panel";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function renderChatPanel() {
  return render(
    <ChatPanel
      caseId={null}
      draftToken={0}
      languageMode="AUTO"
      onCaseId={vi.fn()}
      disabled={false}
    />
  );
}

describe("ChatPanel composer send state", () => {
  it("keeps Send disabled when both text and attachments are empty", () => {
    renderChatPanel();

    expect((screen.getByTestId("chat-send-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Send when an attachment exists and text is empty", () => {
    renderChatPanel();

    fireEvent.click(screen.getByTestId("mock-photo-attach-button"));

    expect(screen.getByTestId("mock-photo-preview-grid").textContent).toContain("1/10 photos");
    expect((screen.getByTestId("chat-send-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("enables Send when text and an attachment both exist", () => {
    renderChatPanel();

    fireEvent.change(screen.getByTestId("chat-composer-input"), {
      target: { value: "Water heater label attached" },
    });
    fireEvent.click(screen.getByTestId("mock-photo-attach-button"));

    expect((screen.getByTestId("chat-send-button") as HTMLButtonElement).disabled).toBe(false);
  });
});