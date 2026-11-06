import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  manifest: ({ browser }) => ({
    name: "Margink",
    description: "Comment on rendered Markdown in GitHub pull requests.",
    host_permissions: ["https://github.com/*"],
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              // Mozilla signs and updates an add-on by this ID; never change it.
              id: "margink@azu.github.io",
              // Margink sends nothing to its developer or third parties; it
              // posts the user's comments to GitHub, the site being reviewed.
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : {}),
  }),
});
