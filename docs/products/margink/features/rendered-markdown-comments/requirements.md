# Comments on rendered Markdown

[日本語](requirements.ja.md)

## About this document

This feature lets a reviewer select text in a rendered Markdown change, write a comment beneath the passage, and either publish it to GitHub or collect it for copying. Its parent is the [Margink Product](../../product.md).

This draft defines the behavior for the initial Chrome extension. Implementation methods belong in the corresponding Design.

### Scope

The starting point is a GitHub pull request containing Markdown changes, viewed in Chrome. The extension covers all displayed text in the rendered diff, including added, deleted, and unchanged passages. It provides passage selection, nearby comment entry, immediate publication as GitHub line comments by default, an alternative collection-and-copy mode, existing comment display, and configurable keyboard shortcuts.

The reviewer uses their existing GitHub sign-in. They do not need to create or enter a separate access token for the extension.

### Out of scope

This feature does not edit or commit the document being reviewed. Replies, comment editing and deletion, resolving threads, and submitting an overall review use GitHub's standard UI. It does not add a separate review service or require the repository to adopt a new document format. Selecting a cross-browser development toolkit belongs in Design; Firefox release support is not yet committed.

## User stories

### Comment without leaving the rendered passage

As a Markdown reviewer, I want to select the words I am reading and comment beside them so that I do not have to find the corresponding source text to compose feedback.

**Acceptance criteria:**

Scenario: When a supported passage is selected, the reviewer can compose a comment in its context

- Given: A Markdown file in a pull request is displayed as rendered content.
- When: The reviewer selects a supported text range and starts commenting.
- Then: The selected text remains identifiable, and a comment input appears beneath its passage while the document stays rendered.

Scenario: When deleted text is selected, the comment refers to the version before the change

- Given: A rendered diff contains deleted Markdown text and GitHub permits a comment at its corresponding source location.
- When: The reviewer selects that text and confirms a comment in GitHub mode.
- Then: A line comment is published at that location in the version before the change, without being attached to a similar phrase in the version after the change.

Scenario: When an unchanged passage is selected, it remains a valid comment target

- Given: A changed Markdown file contains a displayed passage that was not changed and GitHub permits a line comment at its corresponding location.
- When: The reviewer selects that passage and confirms a comment in GitHub mode.
- Then: A line comment is published at the corresponding location; the extension does not restrict commenting to added or deleted words.

Scenario: When the reviewer starts a comment on a whole block, it refers to that block's source lines

- Given: A rendered diff shows a paragraph, heading, list item, table row, or code block, and GitHub permits a line comment at its corresponding source lines.
- When: The reviewer starts a comment on that block from beside it, as GitHub's source diff offers beside a line, without selecting text, and confirms the comment in GitHub mode.
- Then: A line comment is published on the source lines of that block in one version; a block that mixes deleted and added words is commented on in the version after the change.

Scenario: When the reviewer clicks in a block and types, a comment on that block starts

- Given: A rendered diff shows a commentable block and no text is selected.
- When: The reviewer clicks in that block and starts typing, including through an input method.
- Then: A comment input for that whole block appears with the typed text, while a click without typing changes nothing on screen and keys that scroll the page keep scrolling it.

Scenario: When a selection cannot be published as a line comment, the text is retained

- Given: The selection combines incompatible document versions, has no reliably identified source location, or refers to a location GitHub does not accept.
- When: The reviewer attempts to publish a comment for the selection.
- Then: No comment is attached to a guessed location or posted to the PR conversation; the extension explains the unavailable target and retains the text so the reviewer can reselect or explicitly collect it for copying.

Scenario: When the comment is empty, confirming it does not create a comment

- Given: The comment input contains no text other than whitespace.
- When: The reviewer attempts to confirm the comment.
- Then: No GitHub comment or collected item is created, and the input remains available.

### Publish each confirmed comment to GitHub

As a reviewer collaborating through GitHub, I want confirmation to publish my comment immediately so that collaborators can read it through the pull request.

**Acceptance criteria:**

Scenario: When a comment is successfully published, the input closes and the published comment can be found

- Given: GitHub publication mode is selected, the reviewer is signed in and permitted to comment, and the input contains a nonempty comment on a supported passage.
- When: The reviewer confirms the comment.
- Then: One GitHub review comment is published on the source line or line range corresponding to that passage, the input closes after publication succeeds, and the reviewer can identify the successful publication and open the resulting GitHub comment.

Scenario: When publication fails, the reviewer retains the comment

- Given: A nonempty comment is ready for publication.
- When: The reviewer confirms it and GitHub rejects the request or the connection fails.
- Then: The comment text and its passage remain available, an error is shown, and the extension does not report publication as successful.

Scenario: When publication has not finished, repeated confirmation does not deliberately send another comment

- Given: A comment is being published.
- When: The reviewer repeats the confirmation action.
- Then: The extension continues the existing attempt and shows its pending state instead of starting another publication of the same comment.

Scenario: When the publication result is unknown, the extension does not claim success or retry automatically

- Given: GitHub may have accepted a comment, but the extension cannot determine the outcome.
- When: The publication attempt ends without a confirmed result.
- Then: The extension retains the comment, shows that publication could not be confirmed, and lets the reviewer check GitHub before deciding whether to send it again.

Scenario: When the reviewer adds a comment to the review, it waits for the review submission

- Given: GitHub publication mode is selected, the reviewer is signed in and permitted to comment, and the input contains a nonempty comment on a supported passage.
- When: The reviewer uses the add-to-review action instead of the publish action.
- Then: The comment is added to the reviewer's pending GitHub review on the same source line or range, other people cannot read it until the reviewer submits the review in GitHub's standard UI, and the input shows that it was added to the review rather than published.

### Collect feedback and copy it with context

As a reviewer using another conversation or tool, I want to collect comments and copy them with their passages so that the recipient can understand each comment.

**Acceptance criteria:**

Scenario: When collection mode is selected, confirmation stores feedback without publishing it

- Given: The reviewer has selected collection mode and entered a nonempty comment on a passage.
- When: The reviewer confirms the comment.
- Then: A collected item contains the comment and its passage, the input closes after collection succeeds, and no GitHub comment is created.

Scenario: When collected comments are copied, their document context is included

- Given: The current pull request has collected comments.
- When: The reviewer copies the collection.
- Then: The copied text contains each comment, its selected passage, the file path, and the pull request reference, and the collection is not erased by copying.

Scenario: When copying fails, the collection remains available

- Given: There are collected comments.
- When: The reviewer attempts to copy them but the browser cannot complete the operation.
- Then: The extension reports that copying failed and keeps the collected items available.

Scenario: When the page reloads in the same tab, the collection remains available

- Given: A tab has collected comments for a pull request.
- When: The reviewer reloads that pull request in the same tab.
- Then: Those collected comments and their context are still available to copy.

Scenario: When the tab is closed, its collection ends

- Given: A tab has collected comments.
- When: The reviewer closes the tab.
- Then: The collection is discarded and is not restored by opening a new tab for the same pull request. Comments already published to GitHub remain on GitHub.

### Read existing comments in the rendered view

As a reviewer, I want existing GitHub feedback beside the relevant passage so that I can understand earlier discussion without switching away from the rendered document.

**Acceptance criteria:**

Scenario: When an existing GitHub comment has a matching passage, the reviewer can read it in context

- Given: The pull request contains a line-comment thread whose location can be associated with displayed Markdown text.
- When: The reviewer opens the rendered file.
- Then: The passage indicates that comments exist, the reviewer can open the thread content and identify its authors, and a link opens that thread in GitHub's standard UI for replies or resolution.

Scenario: When an old comment cannot be associated with the current document, its location is not guessed

- Given: A GitHub thread belongs to an older version or has no reliable match in the displayed text.
- When: The reviewer opens comments for the file.
- Then: The thread remains accessible with its available file and version context and a GitHub link, and it is not displayed as attached to an arbitrary current passage.

Scenario: When existing comments cannot be loaded, the failure is visible

- Given: The rendered document is available but existing GitHub comments cannot be retrieved.
- When: The reviewer opens the file's comments.
- Then: The extension reports that comments could not be loaded instead of presenting the failure as an empty discussion, and retains any local input or collection.

### Use configurable shortcuts while writing

As a reviewer, I want configurable shortcuts for completing comments so that keyboard operation fits my editing habits.

**Acceptance criteria:**

Scenario: When a confirmation shortcut is configured, it confirms the focused comment

- Given: The reviewer has selected a supported confirmation shortcut and is editing a nonempty comment.
- When: The reviewer presses that shortcut outside text composition.
- Then: The focused comment is confirmed using the currently selected destination, with the same completion and failure behavior as the visible action.

Scenario: When default keys are used, Enter adds a newline and the platform confirmation shortcut completes the comment

- Given: The comment editor uses its default key settings, contains nonempty text, and no input-method composition is active.
- When: The reviewer uses Enter and then the platform confirmation shortcut.
- Then: Enter inserts a newline; Command+Enter on macOS or Control+Enter on other supported desktop platforms confirms the comment.

Scenario: When Enter confirms Japanese text composition, it does not publish the comment

- Given: The reviewer is composing text with an input method in the comment input.
- When: The reviewer presses Enter to confirm the composed text.
- Then: Text composition completes without publishing or collecting the comment.

## KPIs

No numerical usage KPI is established for this draft. The acceptance scenarios define the intended observable outcomes; completion rates and time savings have not been measured. Set any quantitative target with the product owner after the workflow and measurement purpose are agreed.

## Functional requirements

### Select a rendered passage and enter a comment

**Overview:** Keep the selected words and the comment input in the reading context.

**Input:** The current pull request, Markdown file, selected text, and comment text.

**Output:** A comment associated with the passage the reviewer selected.

#### Applicable conditions

The interaction follows the supplied visual reference: selected text is highlighted and an input appears directly beneath the passage. Finishing a comment closes the input; it does not mean that the feedback is deleted. A compact comment indicator lets the reviewer reopen feedback without keeping completed inputs expanded.

All displayed text in a changed Markdown file is eligible for selection, including added, deleted, and unchanged passages. Text in headings, paragraphs, lists, tables, and code blocks is included when it is selectable in the rendered view. A selection can span multiple blocks in the same file; a line comment must refer to a compatible line range in one document version. Selection does not cross files. Images and diagrams without selectable text do not require image-region annotation.

#### Exceptional behavior

If the passage cannot be identified reliably, do not attach the comment to a guessed location. Preserve entered text and explain that the selected target is unavailable. Repeated identical phrases must not be treated as interchangeable. If a document update invalidates the selected location, require the reviewer to select its target again before publication. An unsupported document or selection must not appear to accept feedback that it cannot retain or deliver.

### Publish or collect the confirmed comment

**Overview:** GitHub publication is the default; the reviewer can choose collection for copying instead.

**Input:** A nonempty comment, its passage, and the selected destination.

**Output:** Either a published GitHub comment with an identifiable result or a collected item available to copy.

#### Applicable conditions

Show the active destination before confirmation. In GitHub mode, the publish action publishes that comment, and the add-to-review action adds it to the reviewer's pending review, as GitHub's "Add single comment" and "Start a review" do. Neither action silently chooses the other. Submitting the pending review, with its approve, comment, or request-changes outcome, stays in GitHub's standard UI. In collection mode, confirmation has no GitHub publication side effect. Switching modes does not itself send collected items.

The GitHub destination is a review comment on the source line or range corresponding to the selection. Preserve the selected quotation in the comment so a GitHub reader can distinguish a phrase within that line. Deleted passages refer to the version before the change; added passages refer to the version after it. An unavailable line target is not replaced with a PR conversation comment.

Publication must use the account currently signed in to GitHub and respect that account's access to the repository and permission to comment. No separate token setup is part of the user workflow. The distinction between individual comments and a pending review is documented by [GitHub's commenting guide](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request).

#### Exceptional behavior

Expired sign-in, insufficient permission, an unavailable target, or a rejected request leaves the comment available and explains why it was not published. Failure must not silently change the destination to a different GitHub comment type or a local collection. The reviewer can explicitly choose collection and copying.

### Copy collected feedback

**Overview:** Copy the collected comments for the current pull request as text with their context.

**Input:** The current collection.

**Output:** Text containing the pull request reference, file paths, selected passages, and comment bodies.

#### Applicable conditions

Keep comments associated with their own files and passages. Copying must not publish to GitHub, combine unrelated pull requests, or erase the collection. The exact text formatting belongs in Design.

Collections last for the lifetime of their browser tab. They survive page reloads and navigation back to the same pull request within that tab, but end when the tab closes. Separate tabs have separate collections, even when displaying the same pull request. Opening or restoring a tab starts a new collection. Closing a tab never deletes comments published to GitHub. Show the temporary nature of the collection where the reviewer selects that mode.

#### Exceptional behavior

Report a failed copy without claiming that the clipboard was updated. Retain the collection so the reviewer can try again.

### Display existing GitHub comments

**Overview:** Make existing line-comment threads readable from the rendered Markdown file.

**Input:** GitHub comments available to the current reviewer and their file and version context.

**Output:** Comment indicators, readable thread content, and links to the corresponding GitHub threads.

#### Applicable conditions

Include comments created through GitHub as well as those published by this extension, and show replies that are part of those threads. Preserve the author and GitHub's resolved or outdated status when available. Opening a comment reveals its associated text when the location can be identified. Reading a thread does not change its state. Replying, editing, deleting, and resolving use GitHub's standard UI.

#### Exceptional behavior

Keep unmatched or outdated threads discoverable without assigning a guessed passage. Distinguish a retrieval failure from a file with no comments. A failed refresh must not erase locally collected or in-progress feedback.

### Configure comment shortcuts

**Overview:** Allow the reviewer to change the key combination used to confirm a comment.

**Input:** The chosen shortcut and keyboard input in the comment editor.

**Output:** The corresponding comment action, or a message explaining that a requested shortcut cannot be used.

#### Applicable conditions

By default, Command+Enter on macOS and Control+Enter on other supported desktop platforms confirm the comment; Enter inserts a newline. Allow the reviewer to choose Enter alone or Enter with combinations of Command or Control, Shift, and Alt. When Enter alone confirms, Shift+Enter provides a newline; other confirmation choices must also leave a visible, documented way to insert a newline.

Keyboard confirmation and the visible confirmation control perform the same action. Input-method composition takes precedence over confirmation. Keep the chosen settings available on subsequent use and provide a way to return to the defaults. This preference lifetime is separate from the temporary collection lifetime.

#### Exceptional behavior

A shortcut must not publish a comment while the reviewer is typing in an unrelated GitHub input. An unsupported or conflicting configuration must not appear to have been applied successfully.

## Data requirements

### Required data

- **Review context:** The GitHub host, repository, pull request, file, and document version being reviewed, sufficient to distinguish feedback for different documents and versions.
- **Selected passage:** The selected words and enough surrounding context to identify which occurrence the reviewer means.
- **Comment:** The entered feedback, chosen destination, and whether delivery is pending, successful, failed, or uncertain.
- **Collection:** Comments retained for copying, together with their review context and selected passages, until their browser tab closes.
- **Existing GitHub threads:** Published comments and replies, authors, location, available resolved or outdated status, and a reference to the native thread.
- **Preferences:** The selected destination and confirmation shortcut, remembered for subsequent use and resettable to defaults.

### Relationships

Each comment belongs to one passage in one file and pull request context. A collection groups comments without losing those individual associations. A published comment has a GitHub reference; a locally collected item must not be presented as published.

### Personal information

Document passages, repository names, comment text, and the signed-in account can contain or identify personal and nonpublic information. They are used for the requested commenting and copying workflow. A copied result may contain private text, so the reviewer initiates copying explicitly.

## External service dependencies

- **GitHub**
  - **Related user stories:** Reading rendered changes, publishing confirmed comments, and reading existing threads.
  - **Reason for dependency:** GitHub hosts the pull request and the comments to be shared with its participants.
  - **Contractual and usage decisions:** Use the reviewer's existing access. Do not introduce a separate account, token purchase, or paid external service as a prerequisite. Connection details belong in Design.

## Security considerations

The extension must respect the current GitHub account's access and must not expose private document content to another repository or pull request. Comments and selected passages are sent only for an explicit publication or copy action. Do not send repository content or comments to an unrelated service for this workflow.

Retaining drafts or collections must not store a reusable copy of the reviewer's authentication credentials. GitHub publication must identify the intended pull request and target; a matching phrase elsewhere is not sufficient evidence that it is the same target.

## Open questions

No blocking behavior decisions remain for this draft. Browser support beyond Chrome is tracked in the Product. Before implementation, Design must establish how the existing GitHub session can support line-comment publication and reading without a separate token, and how rendered passages can be associated with the correct GitHub locations. An unverified implementation route is not evidence that these capabilities already work.
