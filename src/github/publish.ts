import { findInJson, isRecord, PAGE_HEADERS } from "./json";
import { pullPath, type PullRef } from "./pull";
import type { Comparison, FetchLike } from "./comparison";
import type { Side } from "../lib/resolve";

export interface LineTarget {
  path: string;
  side: Side;
  startLine: number;
  endLine: number;
}

/** Publish the comment now, or add it to the reviewer's pending review. */
export type Delivery = "publish" | "review";

/**
 * Build the request body GitHub's own source-diff UI sends when it creates a
 * review comment. `submitBatch` is true for "Add single comment" and false
 * for a comment kept in the pending review ("Start a review").
 */
export function buildCreateCommentBody(comparison: Comparison, target: LineTarget, text: string, delivery: Delivery = "publish"): Record<string, unknown> {
  const { baseOid, headOid } = comparison;
  const side = target.side === "base" ? "left" : "right";
  const commitOid = target.side === "base" ? baseOid : headOid;
  const common = {
    comparisonStartOid: baseOid,
    comparisonEndOid: headOid,
    path: target.path,
    line: target.endLine,
    side,
    submitBatch: delivery === "publish",
    text,
  };

  if (target.startLine === target.endLine) {
    return {
      ...common,
      subjectType: "line",
      positioning: {
        type: "line",
        baseCommitOid: baseOid,
        headCommitOid: headOid,
        commitOid,
        line: target.endLine,
        path: target.path,
      },
    };
  }

  return {
    ...common,
    subjectType: "multiline",
    startLine: target.startLine,
    startSide: side,
    positioning: {
      type: "multiline",
      baseCommitOid: baseOid,
      headCommitOid: headOid,
      startPath: target.path,
      startLine: target.startLine,
      startCommitOid: commitOid,
      endPath: target.path,
      endLine: target.endLine,
      endCommitOid: commitOid,
    },
  };
}

/**
 * A published comment Margink can edit or delete: its database ID and the
 * body version GitHub uses to detect conflicting edits, when it sent one.
 */
export interface PostedComment {
  id: string;
  bodyVersion: string | null;
}

export type PublishResult =
  | { state: "published"; url: string | null; comment: PostedComment | null }
  | { state: "failed"; reason: string }
  | { state: "unknown"; reason: string };

/** Turn GitHub's response into a result the comment box can show. */
export async function classifyResponse(res: Response): Promise<PublishResult> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const error = isRecord(json) && typeof json.error === "string" ? json.error : null;

  if (res.ok) {
    if (json === null) {
      return { state: "unknown", reason: "GitHub answered in an unexpected format. The comment may have been published; check the pull request." };
    }
    return { state: "published", url: findCommentUrl(json), comment: findPostedComment(json) };
  }
  switch (res.status) {
    case 401:
      return { state: "failed", reason: "You are signed out of GitHub. Sign in and try again." };
    case 403:
      return { state: "failed", reason: "Your GitHub account cannot comment on this pull request." };
    case 404:
      return { state: "failed", reason: "GitHub could not find this pull request or file. Reload the page and select the text again." };
    case 422:
      return { state: "failed", reason: `GitHub does not accept a comment on this line${error ? `: ${error}` : "."}` };
    default:
      if (res.status >= 500) {
        return { state: "unknown", reason: `GitHub returned ${res.status}. The comment may have been published; check the pull request before trying again.` };
      }
      return { state: "failed", reason: `GitHub rejected the comment (${res.status})${error ? `: ${error}` : "."}` };
  }
}

function findCommentUrl(json: unknown): string | null {
  return (
    findInJson(json, (v) => {
      if (!isRecord(v)) return undefined;
      const url = v.url ?? v.htmlUrl;
      return typeof url === "string" && /#(discussion_)?r\d+$/.test(url) ? url : undefined;
    }) ?? null
  );
}

/**
 * The new comment's ID and body version. The ID is the comment record's
 * `databaseId`, or the number in its `#discussion_r<id>` URL.
 */
export function findPostedComment(json: unknown): PostedComment | null {
  return (
    findInJson(json, (v) => {
      if (!isRecord(v)) return undefined;
      const url = v.url ?? v.htmlUrl;
      const fromUrl = typeof url === "string" ? /#(?:discussion_)?r(\d+)$/.exec(url)?.[1] : undefined;
      // Only the record with the comment's own URL is the comment: other
      // records in the answer, such as the pull request, have IDs too.
      if (!fromUrl) return undefined;
      const id = typeof v.databaseId === "number" || (typeof v.databaseId === "string" && /^\d+$/.test(v.databaseId)) ? String(v.databaseId) : fromUrl;
      const bodyVersion = typeof v.bodyVersion === "string" ? v.bodyVersion : (findInJson(json, (x) => (isRecord(x) && typeof x.bodyVersion === "string" ? x.bodyVersion : undefined)) ?? null);
      return { id, bodyVersion };
    }) ?? null
  );
}

export type ChangeResult =
  | { state: "done"; bodyVersion: string | null }
  | { state: "failed"; reason: string }
  | { state: "unknown"; reason: string };

/** Turn GitHub's answer to an edit or a delete into a result the card can show. */
async function classifyChange(res: Response, action: "edit" | "delete"): Promise<ChangeResult> {
  let json: unknown = null;
  try {
    json = res.status === 204 ? null : await res.json();
  } catch {
    json = null;
  }
  if (res.ok) {
    const bodyVersion = findInJson(json, (x) => (isRecord(x) && typeof x.bodyVersion === "string" ? x.bodyVersion : undefined)) ?? null;
    return { state: "done", bodyVersion };
  }
  const done = action === "edit" ? "updated" : "deleted";
  const error = isRecord(json) && typeof json.error === "string" ? json.error : null;
  switch (res.status) {
    case 401:
      return { state: "failed", reason: "You are signed out of GitHub. Sign in and try again." };
    case 403:
      return { state: "failed", reason: `Your GitHub account cannot ${action} this comment.` };
    case 404:
      return { state: "failed", reason: "GitHub could not find this comment. It may have been deleted; reload the page." };
    case 409:
      return { state: "failed", reason: "The comment changed on GitHub since it was posted. Reload the page and edit it again." };
    default:
      if (res.status >= 500) {
        return { state: "unknown", reason: `GitHub returned ${res.status}. The comment may have been ${done}; check the pull request.` };
      }
      return { state: "failed", reason: `GitHub rejected the ${action} (${res.status})${error ? `: ${error}` : "."}` };
  }
}

/** Replace the body of a comment Margink posted. */
export async function updateComment(pull: PullRef, comment: PostedComment, body: string, fetchFn: FetchLike): Promise<ChangeResult> {
  const query = comment.bodyVersion ? `?body_version=${encodeURIComponent(comment.bodyVersion)}` : "";
  try {
    const res = await fetchFn(`${pullPath(pull)}/page_data/update_review_comment${query}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { ...PAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ body, commentId: comment.id }),
    });
    return await classifyChange(res, "edit");
  } catch {
    return { state: "unknown", reason: "The connection to GitHub failed. The comment may have been updated; check the pull request." };
  }
}

/** Delete a comment Margink posted. */
export async function deleteComment(pull: PullRef, comment: PostedComment, fetchFn: FetchLike): Promise<ChangeResult> {
  try {
    const res = await fetchFn(`${pullPath(pull)}/page_data/review_comments/${comment.id}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: PAGE_HEADERS,
    });
    return await classifyChange(res, "delete");
  } catch {
    return { state: "unknown", reason: "The connection to GitHub failed. The comment may have been deleted; check the pull request." };
  }
}

/** Publish one review comment through the signed-in GitHub session. */
export async function publishComment(
  pull: PullRef,
  comparison: Comparison,
  target: LineTarget,
  text: string,
  fetchFn: FetchLike,
  delivery: Delivery = "publish",
): Promise<PublishResult> {
  let res: Response;
  try {
    res = await fetchFn(`${pullPath(pull)}/page_data/create_review_comment`, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...PAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(buildCreateCommentBody(comparison, target, text, delivery)),
    });
  } catch {
    return { state: "unknown", reason: "The connection to GitHub failed. The comment may have been published; check the pull request before trying again." };
  }
  return classifyResponse(res);
}
