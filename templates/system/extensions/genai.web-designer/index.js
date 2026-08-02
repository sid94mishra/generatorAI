export default function loadExtension(ai) {
  ai.registerWidget({
    id: 'designer',
    title: 'Web App Designer',
    description:
      'Describe a web app or page in plain language; the agent designs a real, self-contained HTML/CSS/JS ' +
      'mock and this widget renders a live preview. Iterate together — ask for changes, compare versions, ' +
      'and export the final HTML.',
    entry: 'ui/designer.html',
    preferredSurface: 'widget',
    keywords: ['design', 'web app', 'website', 'landing page', 'ui', 'mockup', 'prototype', 'frontend', 'html', 'css'],
    actions: [
      {
        name: 'updateDesign',
        description:
          'Replace the current design with a new, complete, self-contained HTML document (inline <style> and ' +
          '<script>, no external requests) and a short one-line summary of what changed. This is how you ship ' +
          'both the first draft and every subsequent revision — always send the FULL html, not a diff.',
        argsSchema: {
          type: 'object',
          properties: {
            html: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['html', 'summary'],
        },
      },
      {
        name: 'restoreVersion',
        description: 'Revert the live design to an earlier version from the history by its id.',
        argsSchema: {
          type: 'object',
          properties: { versionId: { type: 'string' } },
          required: ['versionId'],
        },
      },
      {
        name: 'addNote',
        description: 'Leave a short note in the activity log, e.g. explaining a design decision.',
        argsSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
  });

  ai.log.info('Web App Designer loaded.');
}
