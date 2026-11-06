# Margink

[日本語](product.ja.md)

## Overview

Margink is a browser extension for reviewing Markdown in GitHub pull requests as a rendered document. Reviewers can attach feedback to the passage they are reading, publish it to GitHub, or collect it for copying elsewhere.

Chrome is the primary browser. Development should allow support for other extension browsers, including Firefox, without changing the product's purpose.

## Background and problems

### Background

GitHub provides source and rendered views for prose changes. Its documentation describes rendered differences and distinguishes them from source-view features such as line linking. See [Working with non-code files](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files).

### Problems to solve

Reviewers want to comment on Markdown while reading its rendered headings, paragraphs, and lists. Locating the corresponding Markdown source interrupts that reading. Feedback also needs to retain the passage it refers to when it is shared through GitHub or copied into another conversation.

## Target users

### Reviewers of Markdown pull requests

- **Characteristics:** Read and discuss Markdown changes in GitHub pull requests.
- **Problems:** Want to associate feedback with rendered passages without switching to source text to compose every comment.
- **Usage context:** Reviewing a document change in a browser where they already use GitHub.

## Value provided

### Comment in the context being read

- **Recipient:** Reviewers of Markdown documents.
- **Offering:** Select a rendered passage, compose feedback near it, and continue reading after completing the comment.
- **Reason:** The visible document provides the context for the reviewer's feedback.

### Deliver feedback through the reviewer's chosen channel

- **Recipient:** Reviewers sharing feedback with collaborators or another tool.
- **Offering:** Publish comments to GitHub by default, with an alternative mode for collecting and copying feedback.
- **Reason:** Both workflows should retain the connection between a comment and the passage it addresses.

## Definition of success

A reviewer can read Markdown changes, comment on the passages that matter, and deliver the feedback through GitHub or copying without manually reconstructing its context. Using the extension does not require obtaining a separate GitHub access token.

## Development principles

Keep reading and commenting close together. Make the destination of a comment clear before it is confirmed. Preserve feedback when publishing or copying fails, and distinguish successful delivery from an attempted delivery.

Use the supplied screenshot as the interaction reference for text selection and an input beneath the selected passage. Detailed behavior belongs in the [rendered Markdown commenting Requirements](features/rendered-markdown-comments/requirements.md); the screenshot does not define unrelated product capabilities.

## SLA, SLI, and SLO

### SLA

No contractual service guarantee is defined. This product extends a GitHub browser workflow and does not operate an independent hosted service.

### SLI and SLO

No numerical reliability targets or production measurements are established. Observable completion and failure behavior is defined in the feature's acceptance criteria. Quantitative targets can be considered when there is evidence from actual use.

## Open questions

The browser support commitment beyond Chrome remains open. Firefox is an intended extension path, not a claim of support at the first release; decide its release scope with the product owner before advertising compatibility.
