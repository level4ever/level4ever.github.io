// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/app/App";
import { loadGuides } from "../src/app/storage";
import { useApp } from "../src/app/store";
import { insertItems, newGuide } from "../src/lib/editor";
import { exportGuide, importGuide } from "../src/lib/guideString";
import { DATA } from "./sampleData";

const MAPS = {
  client: "test",
  maps: [{ id: 1411, name: "Durotar", type: "zone", parent: 1414, file: "1411.webp", width: 1002, height: 668 }],
};

const ADDON_GUIDES: { name: string; export: string }[] = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "addon-guides.json"), "utf8"),
);

// jsdom has <dialog> but not showModal; browsers do.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string) => ({
    ok: true,
    json: async () => (String(url).endsWith("maps.json") ? MAPS : DATA),
  }));
  useApp.setState({
    loaded: false,
    guides: {},
    activeId: undefined,
    data: {},
    cursor: undefined,
    selectedItemId: undefined,
    findText: "",
    history: { past: [], future: [] },
    deleted: undefined,
  });
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  for (const id of Object.keys(useApp.getState().guides)) {
    useApp.getState().removeGuide(id);
  }
  localStorage.clear();
});

async function newOrcGuide() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Start a new guide" }));
  const dialog = screen.getByRole("dialog", { name: "New guide" });
  await user.type(within(dialog).getByLabelText("Name"), "Orc 1-6");
  await user.click(within(dialog).getByRole("button", { name: "Orc" }));
  await user.click(within(dialog).getByRole("button", { name: "Create guide" }));
  await screen.findByText(/Can be picked up here/);
  return user;
}

const card = (name: string) => screen.getAllByText(name).map((el) => el.closest(".quest-card")).find(Boolean) as HTMLElement;
const steps = () => within(screen.getByRole("list", { name: /Steps in/ })).queryAllByRole("listitem");

describe("the guide builder", () => {
  test("makes a guide and adds a quest's steps where they go", async () => {
    const user = await newOrcGuide();
    // Quests are listed lowest level first.
    const names = [...document.querySelectorAll(".quest-card .name")].map((el) => el.textContent);
    expect(names.slice(0, 3)).toEqual(["Your Place in the World", "Cutting Teeth", "Either Way"]);
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "Pick up" }));
    expect(steps().map((li) => li.textContent)).toEqual([
      expect.stringContaining("Your Place in the World"),
      "new steps go here",
    ]);
    // It's in the log after that step, to do and turn in.
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "Do + turn in" }));
    // Its chain's next quest can now be picked up.
    await user.click(within(card("Cutting Teeth")).getByRole("button", { name: "Pick up" }));

    const guide = Object.values(useApp.getState().guides)[0]!.guide;
    expect(guide.items).toEqual([
      { id: 1, chapterId: 1, type: "quest", quest: 1, pickup: true },
      { id: 2, chapterId: 1, type: "quest", quest: 1, objectives: true, turnin: true },
      { id: 3, chapterId: 1, type: "quest", quest: 2, pickup: true },
    ]);
    expect(guide.questCoords[1]).toEqual({ mapID: 1411, x: 0.4329, y: 0.6853 });
    expect(guide.questPrereqs[2]).toEqual([1]);
  });

  test("a new guide's zone filter starts where its race starts; one with steps shows all zones", async () => {
    const user = await newOrcGuide();
    expect(screen.getByRole("combobox", { name: "Zone" })).toHaveValue("Durotar");
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "Pick up" }));
    // It stays while steps are added, and through the other tab.
    await user.dblClick(steps()[0]!);
    await user.click(screen.getByRole("tab", { name: "Add quests" }));
    expect(screen.getByRole("combobox", { name: "Zone" })).toHaveValue("Durotar");
    // Opened again later, with steps in it: all zones.
    act(() => useApp.getState().open(useApp.getState().activeId));
    expect(screen.getByRole("combobox", { name: "Zone" })).toHaveValue("");
  });

  test("the zone filter lists each zone once, by where quests are picked up", async () => {
    const user = await newOrcGuide();
    const zone = screen.getByRole("combobox", { name: "Zone" });
    const labels = [...zone.querySelectorAll("option")].map((o) => o.textContent);
    expect(labels).toEqual(["All zones", "Durotar (6)"]);
    await user.selectOptions(zone, "");
    expect(document.querySelectorAll(".quest-card")).toHaveLength(6);
    await user.selectOptions(zone, "Durotar");
    expect(document.querySelectorAll(".quest-card")).toHaveLength(6);
  });

  test("batches steps with the batch button, as the addon does", async () => {
    const user = await newOrcGuide();
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "Pick up" }));
    await user.click(within(card("Call of Earth")).getByRole("button", { name: "Pick up" }));
    await user.click(within(card("Either Way")).getByRole("button", { name: "Pick up" }));
    const rows = () => steps().filter((li) => li.classList.contains("step"));
    const guide = () => useApp.getState().guides[useApp.getState().activeId!]!.guide;

    // Batch the first step with the third: the third moves up beside it.
    await user.click(within(rows()[0]!).getByTitle(/^Batch/));
    expect(screen.getByRole("status")).toHaveTextContent(/Click steps to do them together with step 1/);
    await user.click(rows()[2]!);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(guide().items.map((item) => [item.type === "quest" && item.quest, item.batch])).toEqual([
      [1, 1],
      [8, 1],
      [3, undefined],
    ]);
    expect(rows()[0]).toHaveTextContent("Batch · 2 steps");
    expect(rows()[0]).toHaveClass("batch-first");
    expect(rows()[1]).toHaveClass("batch-last");

    // The same button takes a step out again.
    await user.click(within(rows()[1]!).getByTitle("Take this out of its batch"));
    expect(guide().items.every((item) => item.batch === undefined)).toBe(true);
  });

  test("shows problems on the step, and moves steps", async () => {
    const user = await newOrcGuide();
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "All" }));
    await user.click(within(card("Cutting Teeth")).getByRole("button", { name: "Pick up" }));
    // Untick the first step's turn-in: the second quest's chain isn't done.
    const [firstStep] = steps();
    await user.click(within(firstStep!).getByRole("button", { name: "T" }));
    expect(steps()[1]).toHaveTextContent(/Needs "Your Place in the World" turned in first, but this guide never turns it in/);
    // Open the step to see everything about it.
    await user.dblClick(steps()[1]!);
    expect(screen.getByRole("tab", { name: "Selected step" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Quest 2 in this guide")).toBeInTheDocument();
  });

  test("undo and redo, by button and keyboard", async () => {
    const user = await newOrcGuide();
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "All" }));
    await user.click(within(card("Cutting Teeth")).getByRole("button", { name: "Pick up" }));
    expect(steps()).toHaveLength(3); // two steps and the "new steps go here" line

    const undo = screen.getByRole("button", { name: /Undo/ });
    const redo = screen.getByRole("button", { name: /Redo/ });
    expect(redo).toBeDisabled();
    await user.click(undo);
    expect(steps()).toHaveLength(2);
    await user.click(redo);
    expect(steps()).toHaveLength(3);

    // Deleting a chapter with steps in it, undone with Ctrl+Z.
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    const first = screen.getAllByText("Chapter 1")[0]!.closest(".chapter") as HTMLElement;
    await user.click(within(first).getByTitle(/Delete chapter/));
    expect(useApp.getState().guides[useApp.getState().activeId!]!.guide.items).toHaveLength(0);
    await user.click(document.body);
    await user.keyboard("{Control>}z{/Control}");
    expect(useApp.getState().guides[useApp.getState().activeId!]!.guide.items).toHaveLength(2);
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(useApp.getState().guides[useApp.getState().activeId!]!.guide.items).toHaveLength(0);
    await user.keyboard("{Control>}y{/Control}"); // nothing left to redo
    expect(useApp.getState().history.future).toHaveLength(0);
  });

  test("typing in a field undoes in one go", async () => {
    const user = await newOrcGuide();
    const name = screen.getByLabelText("Chapter name");
    await user.clear(name);
    await user.type(name, "Valley of Trials");
    expect(name).toHaveValue("Valley of Trials");
    await user.click(screen.getByRole("button", { name: /Undo/ }));
    expect(screen.getByLabelText("Chapter name")).toHaveValue("Chapter 1");
  });

  test("an edit waiting to be saved is written when the page is closed", async () => {
    const user = await newOrcGuide();
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "All" }));
    // Saved straight away when made; the step is still waiting.
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(async () => expect((await loadGuides())[0]!.guide.items).toHaveLength(1));
  });

  test("a deleted guide can be brought back", async () => {
    const user = await newOrcGuide();
    await user.click(screen.getByRole("button", { name: /All guides|Level4ever Guide Builder/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("heading", { name: "Orc 1-6" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("heading", { name: "Orc 1-6" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("the map is shown beside the steps, with the route, where new steps go, and a quest being looked at", async () => {
    const user = await newOrcGuide();
    // Before any steps: the map of where the race starts, with the start marked.
    expect(await screen.findByRole("application", { name: "Map of Durotar" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".here-marker")).toHaveLength(1));
    // Looking at a quest shows where it's picked up.
    await user.hover(card("Cutting Teeth"));
    await waitFor(() => expect(document.querySelectorAll(".preview-marker").length).toBeGreaterThan(0));
    await user.unhover(card("Cutting Teeth"));
    await waitFor(() => expect(document.querySelectorAll(".preview-marker")).toHaveLength(0));

    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "All" }));
    // Picked up at Kaltunk's, turned in at Gornek's (from the quest data, so dashed).
    await waitFor(() => expect(document.querySelectorAll(".pin")).toHaveLength(2));
    expect(document.querySelectorAll(".pin.guessed")).toHaveLength(1);
    await user.click(steps()[0]!);
    expect(screen.getByRole("button", { name: "Pick-up spot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn-in spot" })).toBeInTheDocument();
  });

  test("showing a chapter selects its first step, with new steps still going at its end", async () => {
    const user = await newOrcGuide();
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "All" }));
    await user.click(within(card("Cutting Teeth")).getByRole("button", { name: "Pick up" }));
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    expect(useApp.getState().selectedItemId).toBeUndefined(); // the new chapter has no steps
    await user.click(screen.getAllByText("Chapter 1")[0]!.closest(".chapter")!);
    expect(useApp.getState().selectedItemId).toBe(1);
    expect(useApp.getState().cursor).toEqual({ itemId: 2 });
  });

  test("finds a quest by ID or name: only its chapters listed, the other steps dimmed", async () => {
    const user = await newOrcGuide();
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    await user.click(within(card("Cutting Teeth")).getByRole("button", { name: "Pick up" }));
    await user.click(within(card("Call of Earth")).getByRole("button", { name: "Pick up" }));
    const chapters = () => [...document.querySelectorAll(".chapter .chapter-name")].map((el) => el.textContent);
    const find = screen.getByRole("searchbox", { name: "Find quest" });

    await user.type(find, "2"); // Cutting Teeth
    expect(chapters()).toEqual(["Chapter 2"]);
    expect(screen.getByText("1 of 2 steps")).toBeInTheDocument();
    expect(steps().filter((li) => li.classList.contains("found"))).toHaveLength(1);
    expect(steps().filter((li) => li.classList.contains("not-found"))).toHaveLength(1);

    // By name; clicking a chapter selects its first found step.
    await user.clear(find);
    await user.type(find, "place in the");
    expect(chapters()).toEqual(["Chapter 1"]);
    await user.click(screen.getByText("Chapter 1").closest(".chapter")!);
    expect(useApp.getState().selectedItemId).toBe(1);

    await user.clear(find);
    await user.type(find, "999");
    expect(chapters()).toEqual([]);
    expect(screen.getByText("No chapter has that quest.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(chapters()).toEqual(["Chapter 1", "Chapter 2"]);
    expect(steps().some((li) => li.classList.contains("not-found"))).toBe(false);
  });

  test("exports a string the addon's import reads back", async () => {
    const user = await newOrcGuide();
    await user.click(within(card("Your Place in the World")).getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Export string" }));
    const text = (screen.getByLabelText("Export string") as HTMLTextAreaElement).value;
    const stored = Object.values(useApp.getState().guides)[0]!;
    expect(importGuide(text)).toEqual({ guide: stored.guide });
  });

  test("a guide imported before the data loads gets its professions from its quests", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Start a new guide" });
    // A guide with the sample data's Fishing quest, imported with no data loaded yet.
    const guide = { ...newGuide("Fishing", "Horde") };
    insertItems(guide, [{ type: "quest", quest: 6, pickup: true }], { chapterId: 1, index: 0 });
    const result = useApp.getState().importString(exportGuide(guide));
    expect(Object.values(useApp.getState().guides)[0]).toMatchObject({ guessProfile: true, profile: { professions: [] } });
    act(() => useApp.getState().open("id" in result ? result.id : undefined));
    await waitFor(() => expect(Object.values(useApp.getState().guides)[0]!.profile.professions).toEqual([356]));
    expect(Object.values(useApp.getState().guides)[0]!.guessProfile).toBeUndefined();
  });

  test("imports a guide from the addon and keeps it after a reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Import from the addon" }));
    await user.type(screen.getByPlaceholderText("L4G1:..."), "nonsense");
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByText("That isn't a Level4ever guide string.")).toBeInTheDocument();

    const textbox = screen.getByPlaceholderText("L4G1:...");
    await user.clear(textbox);
    await user.click(textbox);
    await user.paste(ADDON_GUIDES[1]!.export);
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByLabelText("Guide name")).toHaveValue("Horde 12-30");
    expect(screen.getAllByRole("navigation", { name: "Chapters" })[0]).toHaveTextContent("Barrens Start");
    // Imported before the data loaded, its profile is guessed once it has.
    expect(Object.values(useApp.getState().guides)[0]!.guessProfile).toBeUndefined();

    // Saved to IndexedDB (writes are queued briefly).
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    await waitFor(async () => expect((await loadGuides()).map((g) => g.guide.name)).toEqual(["Horde 12-30"]));
  });
});
