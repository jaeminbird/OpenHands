import { afterEach, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { Messages } from "#/components/conversation-events/chat/messages";
import { createUserMessageEvent, renderWithProviders } from "test-utils";

vi.mock("#/hooks/query/use-config", () => ({
  useConfig: () => ({ data: {} }),
}));

vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => ({
    data: { id: "conversation-1", conversation_url: "", session_api_key: null },
  }),
}));

vi.mock("#/hooks/use-agent-state", () => ({
  useAgentState: () => ({ curAgentState: "awaiting_user_input" }),
  usePlanningAgentState: () => ({ isPlanningAgentRunning: false }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

it("shows an unanchored resume after older UTC history without timezone suffixes", async () => {
  vi.stubEnv("TZ", "America/New_York");
  const { getActiveBackend } =
    await import("#/api/backend-registry/active-store");
  const { sessionActivityKey, useSessionActivityStore } =
    await import("#/stores/session-activity-store");
  const { backend, orgId } = getActiveBackend();
  const key = sessionActivityKey(backend.id, orgId, "test-conversation-id");
  // The agent server stamps events in UTC without a suffix. The resume began
  // at 23:20 UTC, after the oldest loaded message (18:32 UTC).
  useSessionActivityStore.setState({
    entries: {
      [key]: [
        {
          id: "resume",
          kind: "resume",
          startedAt: Date.parse("2026-11-05T23:20:00Z"),
          phase: "complete",
          steps: [],
          open: false,
        },
      ],
    },
  });
  const message = {
    ...createUserMessageEvent("loaded-user"),
    timestamp: "2026-11-05T18:32:35.376752",
  };
  renderWithProviders(
    <Messages messages={[message]} allEvents={[message]} hasOlderEvents />,
  );
  expect(screen.getByTestId("event-group-toggle")).toBeInTheDocument();
  act(() => useSessionActivityStore.setState({ entries: {} }));
});

it("hides an unanchored resume that predates the loaded UTC history", async () => {
  vi.stubEnv("TZ", "Asia/Seoul");
  const { getActiveBackend } =
    await import("#/api/backend-registry/active-store");
  const { sessionActivityKey, useSessionActivityStore } =
    await import("#/stores/session-activity-store");
  const { backend, orgId } = getActiveBackend();
  const key = sessionActivityKey(backend.id, orgId, "test-conversation-id");
  // The resume began at 10:00 UTC, before the oldest loaded message (15:00
  // UTC), so it belongs to history that is not loaded yet.
  useSessionActivityStore.setState({
    entries: {
      [key]: [
        {
          id: "resume",
          kind: "resume",
          startedAt: Date.parse("2026-11-05T10:00:00Z"),
          phase: "complete",
          steps: [],
          open: false,
        },
      ],
    },
  });
  const message = {
    ...createUserMessageEvent("loaded-user"),
    timestamp: "2026-11-05T15:00:00.000000",
  };
  renderWithProviders(
    <Messages messages={[message]} allEvents={[message]} hasOlderEvents />,
  );
  expect(screen.queryByTestId("event-group-toggle")).not.toBeInTheDocument();
  act(() => useSessionActivityStore.setState({ entries: {} }));
});
