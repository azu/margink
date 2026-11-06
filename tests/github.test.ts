import { describe, expect, it } from "vitest";
import { parseComparison, sha256Hex } from "../src/github/comparison";
import { buildCreateCommentBody, classifyResponse } from "../src/github/publish";
import { parsePullUrl } from "../src/github/pull";
import { linesFromBlobHtml } from "../src/github/source";

const base = "a".repeat(40);
const head = "b".repeat(40);
const comparison = { baseOid: base, headOid: head, pathsByDigest: new Map<string, string>() };

describe("pull URLs", () => {
  it("reads pull request pages only", () => {
    expect(parsePullUrl("https://github.com/azu/margink/pull/12/files")).toEqual({ owner: "azu", repo: "margink", number: 12 });
    expect(parsePullUrl("https://github.com/azu/margink/issues/12")).toBeNull();
    expect(parsePullUrl("https://example.com/azu/margink/pull/12")).toBeNull();
  });
});

describe("route data", () => {
  it("finds commits and path digests anywhere in the payload", () => {
    const parsed = parseComparison([
      { payload: { route: { comparison: { fullDiff: { baseOid: base, headOid: head } }, diffSummaries: [{ path: "docs/a.md", pathDigest: "d1" }] } } },
    ]);
    expect(parsed?.baseOid).toBe(base);
    expect(parsed?.headOid).toBe(head);
    expect(parsed?.pathsByDigest.get("d1")).toBe("docs/a.md");
  });

  it("returns null when commits are missing", () => {
    expect(parseComparison([{ nothing: true }])).toBeNull();
  });

  it("hashes paths like GitHub's diff anchors", async () => {
    expect(await sha256Hex("README.md")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("blob pages", () => {
  it("reads rawLines from embedded JSON", () => {
    const html = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { blob: { rawLines: ["# A", "b"] } } })}</script>`;
    expect(linesFromBlobHtml(html)).toEqual(["# A", "b"]);
  });
  it("returns null when no source is present", () => {
    expect(linesFromBlobHtml("<html></html>")).toBeNull();
  });
});

describe("create review comment body", () => {
  it("uses the head commit and right side for one head line", () => {
    const body = buildCreateCommentBody(comparison, { path: "a.md", side: "head", startLine: 4, endLine: 4 }, "hi");
    expect(body).toMatchObject({ comparisonStartOid: base, comparisonEndOid: head, line: 4, side: "right", subjectType: "line", submitBatch: true, text: "hi" });
    expect(body.positioning).toMatchObject({ type: "line", commitOid: head, line: 4, path: "a.md" });
  });

  it("keeps a comment added to the review out of the immediate batch", () => {
    const body = buildCreateCommentBody(comparison, { path: "a.md", side: "head", startLine: 4, endLine: 4 }, "hi", "review");
    expect(body.submitBatch).toBe(false);
  });

  it("uses the base commit and left side for removed text", () => {
    const body = buildCreateCommentBody(comparison, { path: "a.md", side: "base", startLine: 7, endLine: 7 }, "hi");
    expect(body).toMatchObject({ side: "left", line: 7 });
    expect(body.positioning).toMatchObject({ commitOid: base });
  });

  it("sends a line range as a multi-line comment", () => {
    const body = buildCreateCommentBody(comparison, { path: "a.md", side: "head", startLine: 2, endLine: 5 }, "hi");
    expect(body).toMatchObject({ subjectType: "multiline", startLine: 2, line: 5, startSide: "right" });
    expect(body.positioning).toMatchObject({ type: "multiline", startLine: 2, endLine: 5, startCommitOid: head, endCommitOid: head });
  });
});

describe("response classification", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("returns the comment URL on success", async () => {
    const res = json(200, { thread: { commentsData: { comments: [{ url: "https://github.com/o/r/pull/1#discussion_r42" }] } } });
    expect(await classifyResponse(res)).toEqual({ state: "published", url: "https://github.com/o/r/pull/1#discussion_r42" });
  });

  it("explains rejected locations without claiming success", async () => {
    expect(await classifyResponse(json(422, { error: "Line could not be resolved." }))).toEqual({
      state: "failed",
      reason: "GitHub does not accept a comment on this line: Line could not be resolved.",
    });
  });

  it("reports sign-in and permission failures", async () => {
    expect((await classifyResponse(json(401, {}))).state).toBe("failed");
    expect((await classifyResponse(json(403, {}))).state).toBe("failed");
  });

  it("treats server errors and unreadable success as unknown", async () => {
    expect((await classifyResponse(json(502, {}))).state).toBe("unknown");
    expect((await classifyResponse(new Response("<html>", { status: 200 }))).state).toBe("unknown");
  });
});
