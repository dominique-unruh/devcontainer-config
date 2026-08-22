import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { DASHBOARD_HTML } from "../src/ui/dashboardHtml.js";

interface DashboardHandle {
  refresh: () => Promise<void>;
  render: (jobs: unknown[]) => void;
}

let dom: JSDOM;
let jobs: unknown[];

/** Boot the dashboard page in jsdom with a stubbed API returning `jobs`. */
async function boot(initialJobs: unknown[]): Promise<DashboardHandle> {
  jobs = initialJobs;
  dom = new JSDOM(DASHBOARD_HTML, {
    runScripts: "dangerously",
    url: "http://127.0.0.1:1234/?key=testkey",
  });
  // Stub fetch before the inline script's initial refresh resolves.
  (dom.window as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
    ok: true,
    json: async () => jobs,
    text: async () => JSON.stringify(jobs),
  }));
  const handle = (dom.window as unknown as { __dashboard: DashboardHandle }).__dashboard;
  await handle.refresh();
  return handle;
}

function doc() {
  return dom.window.document;
}

function jobCards() {
  return [...doc().querySelectorAll(".job")];
}

const baseJob = {
  id: "job-1",
  tool: "run_bash_host",
  status: "waiting-approval",
  reason: "need to list printers",
  summary: "lpstat -p",
  createdAt: 1000,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  dom?.window.close();
});

describe("dashboard page", () => {
  it("renders a job card with its reason and command", async () => {
    await boot([baseJob]);
    const card = jobCards()[0];
    expect(card.querySelector(".tool")!.textContent).toBe("run_bash_host");
    expect(card.querySelector(".status")!.textContent).toBe("waiting-approval");
    expect(card.querySelector(".reason")!.textContent).toBe("need to list printers");
    expect(card.querySelector("pre.detail")!.textContent).toBe("lpstat -p");
  });

  it("shows the rejection-note field immediately, with no toggle to open", async () => {
    await boot([baseJob]);
    const card = jobCards()[0];
    const noteInput = card.querySelector(".note-input") as HTMLInputElement;
    expect(noteInput).toBeTruthy();
    // It lives on the same row as the buttons and is visible from the start.
    expect(noteInput.parentElement!.className).toBe("actions");
    expect(card.querySelector("textarea")).toBeNull();
  });

  it("keeps a typed note across refreshes", async () => {
    const handle = await boot([baseJob]);
    const card = jobCards()[0];
    const noteInput = card.querySelector(".note-input") as HTMLInputElement;
    noteInput.value = "half-typed reason";

    // This is the reported bug: a poll used to wipe the list, losing this.
    await handle.refresh();
    await handle.refresh();

    const cardAfter = jobCards()[0];
    expect(cardAfter).toBe(card); // same element, not rebuilt
    const noteAfter = cardAfter.querySelector(".note-input") as HTMLInputElement;
    expect(noteAfter).toBe(noteInput);
    expect(noteAfter.value).toBe("half-typed reason");
  });

  it("updates status in place without recreating the card", async () => {
    const handle = await boot([baseJob]);
    const card = jobCards()[0];

    jobs = [{ ...baseJob, status: "running" }];
    await handle.refresh();

    expect(jobCards()[0]).toBe(card);
    expect(card.querySelector(".status")!.textContent).toBe("running");
    expect(card.querySelector(".status")!.className).toContain("running");
  });

  it("hides the action buttons once a job is no longer pending", async () => {
    const handle = await boot([baseJob]);
    const card = jobCards()[0];
    expect(card.querySelector(".actions")!.className).not.toContain("hidden");

    jobs = [{ ...baseJob, status: "finished" }];
    await handle.refresh();
    expect(card.querySelector(".actions")!.className).toContain("hidden");
  });

  it("shows the rejection note returned by the server once rejected", async () => {
    const handle = await boot([baseJob]);
    const card = jobCards()[0];

    jobs = [{ ...baseJob, status: "rejected", note: "nope" }];
    await handle.refresh();

    const noteEls = [...card.querySelectorAll(".reason")].map((e) => e.textContent);
    expect(noteEls).toContain("Note: nope");
  });

  it("adds new jobs and removes vanished ones, newest first", async () => {
    const handle = await boot([baseJob]);
    jobs = [baseJob, { ...baseJob, id: "job-2", createdAt: 2000, summary: "echo newer" }];
    await handle.refresh();

    let cards = jobCards();
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".id")!.textContent).toBe("job-2");
    expect(cards[1].querySelector(".id")!.textContent).toBe("job-1");

    jobs = [{ ...baseJob, id: "job-2", createdAt: 2000, summary: "echo newer" }];
    await handle.refresh();
    cards = jobCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector(".id")!.textContent).toBe("job-2");
  });

  it("POSTs approve with the auth key when Approve is clicked", async () => {
    await boot([baseJob]);
    const fetchMock = (dom.window as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    fetchMock.mockClear();

    const card = jobCards()[0];
    const approveBtn = [...card.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    approveBtn.dispatchEvent(new dom.window.Event("click"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/commands/job-1/approve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-auth-key": "testkey" }),
      })
    );
  });

  it("rejects immediately on a single click, sending the typed note", async () => {
    await boot([baseJob]);
    const fetchMock = (dom.window as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    const card = jobCards()[0];

    (card.querySelector(".note-input") as HTMLInputElement).value = "not now";
    fetchMock.mockClear();
    [...card.querySelectorAll("button")]
      .find((b) => b.textContent === "Reject")!
      .dispatchEvent(new dom.window.Event("click"));

    // One click, one POST — no intermediate confirm step.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/commands/job-1/reject",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "not now" }) })
    );
  });

  it("rejects with no note when the field is left empty", async () => {
    await boot([baseJob]);
    const fetchMock = (dom.window as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    fetchMock.mockClear();

    [...jobCards()[0].querySelectorAll("button")]
      .find((b) => b.textContent === "Reject")!
      .dispatchEvent(new dom.window.Event("click"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/commands/job-1/reject",
      expect.objectContaining({ body: JSON.stringify({}) })
    );
  });

  it("Enter in the note field rejects", async () => {
    await boot([baseJob]);
    const fetchMock = (dom.window as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    const noteInput = jobCards()[0].querySelector(".note-input") as HTMLInputElement;
    noteInput.value = "via enter";
    fetchMock.mockClear();

    const ev = new dom.window.KeyboardEvent("keydown", { key: "Enter" });
    noteInput.dispatchEvent(ev);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/commands/job-1/reject",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "via enter" }) })
    );
  });

  it("shows an empty-state message when there are no jobs", async () => {
    await boot([]);
    expect(doc().getElementById("list")!.textContent).toBe("Nothing yet.");
  });
});
