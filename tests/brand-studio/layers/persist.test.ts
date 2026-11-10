import { describe, expect, it } from "vitest";
import { addLayer, createImageLayer, createShapeLayer, createTextLayer, emptyDoc, type LayerDoc } from "@/components/brand-studio/layers/model";
import {
  DRAFT_MAX_CHARS,
  DRAFT_PREFIX,
  RECENT_COLORS_MAX,
  clearDraft,
  draftKey,
  loadDraft,
  loadRecentColors,
  parseDraft,
  pruneDrafts,
  safeUrl,
  sanitizeLayer,
  saveDraft,
  saveRecentColors,
  serializeDraft,
  type StorageLike,
} from "@/components/brand-studio/layers/persist";

const ASSET = "0b9f1c7e-1d2a-4c55-9a3e-7f1e2d3c4b5a";
const BASE = "o:5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function sample(): LayerDoc {
  let doc = emptyDoc(1200, 1500);
  doc = addLayer(doc, createImageLayer(doc, { url: "/api/brand-studio/media/st/abc.png", ref: { assetId: ASSET }, name: "logo", natural: { width: 300, height: 100 }, id: "img1" }));
  doc = addLayer(doc, createTextLayer(doc, { text: "봄 신상 20%", name: "제목", id: "txt1" }));
  doc = addLayer(doc, createShapeLayer(doc, { shape: "ellipse", name: "원", id: "shp1" }));
  return doc;
}

const expected = { baseKey: BASE, width: 1200, height: 1500 };

describe("draft storage", () => {
  it("round-trips a document for the same picture", () => {
    const doc = sample();
    const back = parseDraft(serializeDraft(doc, BASE), expected);
    expect(back).toEqual(doc);
  });

  it("refuses a draft for another picture, another version or broken JSON", () => {
    const raw = serializeDraft(sample(), BASE);
    expect(parseDraft(raw, { ...expected, baseKey: "o:other" })).toBeNull();
    expect(parseDraft(raw.replace('"v":1', '"v":2'), expected)).toBeNull();
    expect(parseDraft("{not json", expected)).toBeNull();
    expect(parseDraft(null, expected)).toBeNull();
  });

  it("scales the layers when the same picture comes back at another size", () => {
    const doc = sample();
    const back = parseDraft(serializeDraft(doc, BASE), { ...expected, width: 600, height: 750 })!;
    expect(back.width).toBe(600);
    const text = back.layers[1]!;
    const original = doc.layers[1]!;
    expect(text.x).toBeCloseTo(original.x / 2);
    if (text.kind !== "text" || original.kind !== "text") throw new Error("expected text layers");
    expect(text.size).toBeCloseTo(original.size / 2);
  });

  it("drops layers it cannot trust and never keeps image bytes", () => {
    expect(sanitizeLayer({ id: "a", kind: "image", src: { url: "data:image/png;base64,AAAA" } })).toBeNull();
    expect(sanitizeLayer({ id: "a", kind: "image", src: { url: "javascript:alert(1)" } })).toBeNull();
    expect(sanitizeLayer({ id: "a", kind: "video", src: { url: "/x.mp4" } })).toBeNull();
    expect(sanitizeLayer({ id: "bad id!", kind: "shape" })).toBeNull();
    const shape = sanitizeLayer({ id: "s", kind: "shape", fill: "red", stroke: "#abc", x: "1", w: 10, h: 10 });
    expect(shape).toMatchObject({ kind: "shape", fill: null, stroke: "#AABBCC", x: 0 });
    const text = sanitizeLayer({ id: "t", kind: "text", text: 42, color: "#123456", font: "comic", align: "justify" });
    expect(text).toMatchObject({ kind: "text", text: "", color: "#123456", font: "pretendard", align: "center" });
    const image = sanitizeLayer({ id: "i", kind: "image", src: { url: "/api/brand-studio/media/st/a.png", ref: { assetId: "not-a-uuid" } } });
    expect(image).toMatchObject({ kind: "image", src: { ref: null } });
  });

  it("drops duplicate ids", () => {
    const doc = sample();
    const raw = JSON.parse(serializeDraft(doc, BASE)) as { layers: unknown[] };
    raw.layers.push(raw.layers[0]);
    expect(parseDraft(JSON.stringify(raw), expected)!.layers).toHaveLength(3);
  });

  it("allows only same-site paths and web addresses", () => {
    expect(safeUrl("/api/brand-studio/media/st/a.png")).toBe("/api/brand-studio/media/st/a.png");
    expect(safeUrl("https://media.example.com/st/a.png")).toBe("https://media.example.com/st/a.png");
    expect(safeUrl("//evil.example/a.png")).toBeNull();
    expect(safeUrl("blob:https://x/1")).toBeNull();
  });

  it("saves, loads, and removes an emptied draft", () => {
    const storage = memoryStorage();
    expect(saveDraft(storage, BASE, sample())).toBe(true);
    expect(storage.map.has(draftKey(BASE))).toBe(true);
    expect(loadDraft(storage, expected)?.layers).toHaveLength(3);
    expect(saveDraft(storage, BASE, emptyDoc(1200, 1500))).toBe(true);
    expect(storage.map.has(draftKey(BASE))).toBe(false);
    saveDraft(storage, BASE, sample());
    clearDraft(storage, BASE);
    expect(loadDraft(storage, expected)).toBeNull();
  });

  it("refuses an oversized draft and survives a storage that throws", () => {
    const storage = memoryStorage();
    // Built by hand: the editor's own limits keep a real document well under the cap.
    const empty = emptyDoc(1200, 1500);
    const doc: LayerDoc = { ...empty, layers: Array.from({ length: 50 }, (_, i) => ({ ...createTextLayer(empty, { text: "", name: `t${i}`, id: `t${i}` }), text: "x".repeat(5000) })) };
    expect(serializeDraft(doc, BASE).length).toBeGreaterThan(DRAFT_MAX_CHARS);
    expect(saveDraft(storage, BASE, doc)).toBe(false);
    const broken: StorageLike = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(saveDraft(broken, BASE, sample())).toBe(false);
    expect(loadDraft(broken, expected)).toBeNull();
    expect(saveDraft(null, BASE, sample())).toBe(false);
  });

  it("keeps only the most recent drafts on a device", () => {
    const storage = memoryStorage();
    for (let i = 0; i < 5; i++) storage.setItem(`${DRAFT_PREFIX}o:${i}`, JSON.stringify({ savedAt: i }));
    storage.setItem("unrelated", "1");
    pruneDrafts(storage, 2);
    expect([...storage.map.keys()].sort()).toEqual([`${DRAFT_PREFIX}o:3`, `${DRAFT_PREFIX}o:4`, "unrelated"]);
  });

  it("stores recent colours as clean hex, at most eight", () => {
    const storage = memoryStorage();
    saveRecentColors(storage, ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888", "#999999"]);
    expect(loadRecentColors(storage)).toHaveLength(RECENT_COLORS_MAX);
    storage.setItem("twings_studio_layers_colors_v1", JSON.stringify(["#abc", "nope", 5]));
    expect(loadRecentColors(storage)).toEqual(["#AABBCC"]);
    storage.setItem("twings_studio_layers_colors_v1", "{");
    expect(loadRecentColors(storage)).toEqual([]);
  });
});
