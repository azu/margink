# Margink

Margink is a browser extension for commenting on rendered Markdown in GitHub pull requests.
Select text in a rendered Markdown diff, write a comment beneath it, and publish it as a GitHub line comment with your existing GitHub sign-in.

https://github.com/user-attachments/assets/5fc70416-2244-4af6-8469-163f23dd22e0


The specifications live in [docs/](docs/README.md).

## Install

Margink is not in the Chrome Web Store or on addons.mozilla.org. Download it from the [latest release](https://github.com/azu/margink/releases/latest).

### Userscript (Chrome and Firefox)

This is the easiest way to install Margink and keep it updated.

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. In Chrome 138 or later, open the manager's details page in `chrome://extensions` and turn on **Allow User Scripts**. Older Chrome needs **Developer mode** instead. See [Tampermonkey's FAQ](https://www.tampermonkey.net/faq.php?q=Q209).
3. Open [margink.user.js](https://github.com/azu/margink/releases/latest/download/margink.user.js) and confirm the install in the manager.

The manager checks the latest release for a newer version.

### Chrome extension

Chrome installs extensions from outside the Chrome Web Store only as an unpacked folder. Dropping the `.zip` onto `chrome://extensions` does not work, and neither does a `.crx` made with "Pack extension" on Windows or macOS.

1. Download the latest release and unzip it into a data folder, `~/.local/share/margink` (or `$XDG_DATA_HOME/margink` when that is set). Chrome reads the extension from this folder every time it starts, so do not move or delete it. The command prints the folder's path at the end.

   ```sh
   dir="${XDG_DATA_HOME:-$HOME/.local/share}/margink" \
     && curl -fsSL -o /tmp/margink-chrome.zip https://github.com/azu/margink/releases/latest/download/margink-chrome.zip \
     && mkdir -p "$dir" && unzip -oq /tmp/margink-chrome.zip -d "$dir" && echo "$dir"
   ```

2. Open `chrome://extensions` and turn on **Developer mode** in the top right.
3. Choose **Load unpacked** and select the printed folder. The folder is hidden, so in the macOS file dialog press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> and paste the path.

To update, run the same command again, then press the reload button on Margink's card in `chrome://extensions`. Loading a different folder instead adds a second copy of Margink, because Chrome tells unpacked extensions apart by their folder.

### Firefox add-on

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
npm run build:userscript  # .output/margink.user.js
npm test             # unit tests
npm run test:e2e     # runs the extension and the userscript against a stand-in GitHub page
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

## Status

This is an early version. It covers selecting rendered text, resolving it to a source line, and publishing a line comment.
Stock-and-copy mode, existing thread display, and shortcut settings are planned.
GitHub's page endpoints that Margink uses are not a public API, so behavior on github.com must be checked with a signed-in account.
