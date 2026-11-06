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

/**
 * Build the request body GitHub's own source-diff UI sends when it creates a
 * review comment that is published immediately.
 */
export function buildCreateCommentBody(comparison: Comparison, target: LineTarget, text: string): Record<string, unknown> {
  const { baseOid, headOid } = comparison;
  const side = target.side === "base" ? "left" : "right";
  const commitOid = target.side === "base" ? baseOid : headOid;
  const common = {
    comparisonStartOid: baseOid,
    comparisonEndOid: headOid,
    path: target.path,
    line: target.endLine,
    side,
    submitBatch: true,
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

export type PublishResult =
  | { state: "published"; url: string | null }
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
    return { state: "published", url: findCommentUrl(json) };
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

/** Publish one review comment through the signed-in GitHub session. */
export async function publishComment(
  pull: PullRef,
  comparison: Comparison,
  target: LineTarget,
  text: string,
  fetchFn: FetchLike,
): Promise<PublishResult> {
  let res: Response;
  try {
    res = await fetchFn(`${pullPath(pull)}/page_data/create_review_comment`, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...PAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(buildCreateCommentBody(comparison, target, text)),
    });
  } catch {
    return { state: "unknown", reason: "The connection to GitHub failed. The comment may have been published; check the pull request before trying again." };
  }
  return classifyResponse(res);
}
