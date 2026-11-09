// Start VITE_MOCK_API=true react-router dev on port 3196, then run:
// PROOF_OUTPUT=/tmp/resume-visibility node .pr/reproduce-resume-visibility.mjs before|after
// Uses the mock pagination-local conversation (100 events, so the initial
// 50-event page leaves hasOlderEvents true), then swaps in suffix-free UTC
// history and a completed resume with no afterEventId. No backend or LLM runs.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const mode = process.argv[2] ?? "after";
const output = process.env.PROOF_OUTPUT ?? "/tmp/resume-visibility";
const port = process.env.PORT ?? "3196";
const conversationId = "pagination-local";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  timezoneId: "America/New_York",
  viewport: { width: 1280, height: 960 },
  recordVideo: { dir: output, size: { width: 1280, height: 960 } },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
await page.addInitScript(() => {
  localStorage.setItem("openhands-onboarded", "1");
  localStorage.setItem("openhands-telemetry-consent", "denied");
  localStorage.setItem("openhands-telemetry-first-use", "true");
  localStorage.setItem("analytics-consent", "false");
  localStorage.setItem(
    "openhands-backends",
    JSON.stringify([
      {
        id: "default-local",
        name: "Resume visibility fixture (mock)",
        host: location.origin,
        apiKey: "mock-session-key",
        kind: "local",
      },
    ]),
  );
  localStorage.setItem(
    "openhands-active-backend",
    JSON.stringify({ backendId: "default-local", orgId: null }),
  );
});
try {
  await page.goto(`http://127.0.0.1:${port}/conversations/${conversationId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("chat-scroll-container").waitFor();
  await page.waitForTimeout(3000);
  const consent = page.getByRole("button", { name: "Confirm preferences" });
  if (await consent.isVisible()) {
    await page.getByRole("checkbox").uncheck();
    await consent.click();
  }
  await page.evaluate(async (id) => {
    const { useEventStore } = await import("/src/stores/use-event-store.ts");
    const { useSessionActivityStore, sessionActivityKey } =
      await import("/src/stores/session-activity-store.ts");
    const key = sessionActivityKey("default-local", null, id);
    useEventStore.getState().clearEvents();
    // Agent Server history: UTC timestamps with no suffix.
    const rows = [
      [
        "u1",
        "user",
        "2026-11-05T18:32:35.376752",
        "Hello, this is the original conversation.",
      ],
      [
        "a1",
        "agent",
        "2026-11-05T18:32:44.416381",
        "Earlier assistant reply, from before the sandbox paused.",
      ],
      [
        "u2",
        "user",
        "2026-11-05T18:38:51.913504",
        "This is my latest message in the saved history.",
      ],
      [
        "a2",
        "agent",
        "2026-11-05T18:39:10.417648",
        "Last saved reply. The sandbox was resumed at 23:20Z.",
      ],
    ];
    useEventStore.getState().addEvents(
      rows.map(([eventId, source, timestamp, text]) => ({
        id: eventId,
        source,
        timestamp,
        kind: "MessageEvent",
        llm_message: {
          role: source === "user" ? "user" : "assistant",
          content: [{ type: "text", text }],
        },
        activated_skills: [],
        extended_content: [],
      })),
    );
    // A completed resume that started after that history (23:20Z), with no
    // event-ID anchor.
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
  }, conversationId);
  await page.getByText("Last saved reply.", { exact: false }).waitFor();
  await page.waitForTimeout(1500);
  const resumeCount = await page
    .getByText("Resumed session", { exact: true })
    .count();
  const visible = resumeCount > 0;
  await page.screenshot({ path: `${output}/${mode}.png` });
  console.log(JSON.stringify({ mode, resumedSessionVisible: visible }));
  if (mode === "before" ? visible : !visible) {
    throw new Error(`Unexpected visibility in ${mode}: ${visible}`);
  }
  await page.waitForTimeout(1000);
} catch (error) {
  await page.screenshot({ path: `${output}/${mode}-error.png` });
  console.log((await page.locator("body").innerText()).slice(0, 3000));
  throw error;
} finally {
  await context.close();
  console.log(JSON.stringify({ video: await page.video().path() }));
  await browser.close();
}
