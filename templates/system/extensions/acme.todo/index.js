export default function loadExtension(ai) {
  ai.registerWidget({
    id: 'list',
    title: 'Todo List',
    description:
      'Interactive todo list with add/complete/delete. State survives reloads. Renders on the canvas by default.',
    entry: 'ui/list.html',
    preferredSurface: 'widget',
    keywords: ['todo', 'task', 'checklist', 'items', 'list', 'sprint'],
  });

  ai.log.info('acme.todo v1 extension loaded.');
}
