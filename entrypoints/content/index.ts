import { startMargink } from "../../src/main";

export default defineContentScript({
  // GitHub navigates between pages without reloading, so the script runs on
  // every github.com page and checks for a pull request when text is selected.
  matches: ["https://github.com/*"],
  main() {
    startMargink(document);
  },
});
