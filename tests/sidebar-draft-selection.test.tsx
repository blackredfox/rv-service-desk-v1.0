import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiDeleteCase: vi.fn(async () => ({ success: true })),
  apiListCases: vi.fn(async () => ({
    cases: [
      {
        id: "case_existing",
        title: "Brake pressure issue",
        createdAt: "2026-04-07T15:00:00.000Z",
        updatedAt: "2026-04-07T15:00:00.000Z",
      },
    ],
  })),
  apiSearch: vi.fn(async () => ({ cases: [] })),
}));

import { Sidebar } from "@/components/sidebar";

describe("Sidebar draft selection", () => {
  it("does not auto-select a persisted case while a local draft is active", async () => {
    const onSelectCase = vi.fn();

    render(
      <Sidebar
        activeCaseId={null}
        hasActiveDraft
        onSelectCase={onSelectCase}
      />
    );

    await waitFor(() => {
      expect(onSelectCase).not.toHaveBeenCalled();
    });
  });
});