# Margink

Margink is a browser extension for commenting on rendered Markdown in GitHub pull requests.
Select text in a rendered Markdown diff, write a comment beneath it, and publish it as a GitHub line comment with your existing GitHub sign-in.

The specifications live in [docs/](docs/README.md).

## Install

Margink is not in the Chrome Web Store or on addons.mozilla.org. Download it from the [latest release](https://github.com/azu/margink/releases/latest).

### Chrome

1. Download `margink-<version>-chrome.zip` and unzip it into a folder you keep. Chrome loads the extension from that folder, so do not delete it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the unzipped folder.

To update, unzip the newer release over the same folder and press the reload button on Margink's card in `chrome://extensions`.

### Firefox

Firefox support is experimental.

1. Download `margink-<version>-firefox.xpi`. It is signed by Mozilla for self-distribution.
2. Open `about:addons`, choose the gear menu, then **Install Add-on from file…**, and select the downloaded file.

To update, install the newer `.xpi` the same way.

## Development

```sh
npm install
npm run dev          # Chrome with the extension loaded
npm run build        # .output/chrome-mv3
npm run build:firefox
npm test             # unit tests
npm run test:e2e     # builds and runs the extension against a stand-in GitHub page
```

To try the build in Chrome, open `chrome://extensions`, turn on Developer mode, choose "Load unpacked", and select `.output/chrome-mv3`.

## Releasing

Releases are made from a release pull request.

1. Run the **Create Release PR** workflow from the Actions tab and choose `patch`, `minor`, or `major`. It bumps `package.json` and opens a draft pull request labeled `Type: Release` whose description is the release notes.
2. Edit the notes if needed, mark the pull request ready, and merge it.
3. The **Release** workflow tests and builds the extension, then creates the `v<version>` tag and a GitHub release with the packages attached.

One-time setup:

- In Settings → Actions → General, allow GitHub Actions to create pull requests.
- Create the `Type: Release` label.
- For the Firefox package, create API credentials at [addons.mozilla.org](https://addons.mozilla.org/developers/addon/api/key/) and save them as the repository secrets `AMO_API_KEY` and `AMO_API_SECRET`. Without them, releases include only the Chrome package.

Mozilla can take up to a day to sign a version, and longer if it is chosen for manual review, while the workflow waits only 15 minutes. If signing does not finish in time, the release is still made with the Chrome package and the pull request comment says so. Once the version is signed, download the `.xpi` from the [Developer Hub](https://addons.mozilla.org/developers/) and attach it with `gh release upload v<version> <file>.xpi`.

## Status

This is an early version. It covers selecting rendered text, resolving it to a source line, and publishing a line comment.
Stock-and-copy mode, existing thread display, and shortcut settings are planned.
GitHub's page endpoints that Margink uses are not a public API, so behavior on github.com must be checked with a signed-in account.
