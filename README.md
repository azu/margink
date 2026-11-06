# Margink

Margink is a browser extension for commenting on rendered Markdown in GitHub pull requests.
Select text in a rendered Markdown diff, write a comment beneath it, and publish it as a GitHub line comment with your existing GitHub sign-in.

The specifications live in [docs/](docs/README.md).

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

## Status

This is an early version. It covers selecting rendered text, resolving it to a source line, and publishing a line comment.
Stock-and-copy mode, existing thread display, and shortcut settings are planned.
GitHub's page endpoints that Margink uses are not a public API, so behavior on github.com must be checked with a signed-in account.
