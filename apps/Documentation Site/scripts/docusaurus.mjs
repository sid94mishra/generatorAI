// Keep framework update checks from writing into the user's global config.
process.env.NO_UPDATE_NOTIFIER = '1';
await import('../node_modules/@docusaurus/core/bin/docusaurus.mjs');
