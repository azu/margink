import { Controller } from "../../src/ui/controller";

export default defineContentScript({
  // GitHub navigates between pages without reloading, so the script runs on
  // every github.com page and checks for a pull request when text is selected.
  matches: ["https://github.com/*"],
  main() {
    const fetchFn = (input: string, init?: RequestInit) => fetch(new URL(input, location.origin).href, init);
    new Controller(document, fetchFn).start();
  },
});
