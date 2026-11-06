import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "Margink",
    description: "Comment on rendered Markdown in GitHub pull requests.",
    host_permissions: ["https://github.com/*"],
  },
});
