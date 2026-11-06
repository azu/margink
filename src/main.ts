import { Controller } from "./ui/controller";

/**
 * Start Margink on a github.com page. Shared by the extension's content
 * script and the userscript build, which run the same code: Margink needs
 * no extension API, only the page and its same-origin requests.
 */
export function startMargink(doc: Document): void {
  const fetchFn = (input: string, init?: RequestInit) => fetch(new URL(input, location.origin).href, init);
  new Controller(doc, fetchFn).start();
}
