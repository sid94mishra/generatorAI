// Reference v2 extension — imperative registrations via `loadExtension(ai)`.
// This file is loaded by ExtensionManager after manifest validation.
//
// Note: shipped as .js (not .ts) so the runtime can dynamic-import it
// without a TS loader dependency at server-boot time.

/** @type {import('@generatorai/core').ExtensionAPI extends infer T ? (ai: T) => void : never} */
export default function loadExtension(ai) {
  // ── Counter widget — small inline confirm-style ─────────────
  ai.registerWidget({
    id: 'counter',
    title: 'Counter',
    description: 'A stateful counter with +/− and reset. Small; renders on the canvas.',
    entry: 'ui/counter.html',
    preferredSurface: 'widget',
    keywords: ['count', 'counter', 'number', 'tally', 'increment'],
  });

  // ── Feedback form ────────────────────────────────────────────
  ai.registerWidget({
    id: 'form',
    title: 'Feedback Form',
    description: 'A single-field form that posts a message back to the chat as if the user typed it.',
    entry: 'ui/form.html',
    preferredSurface: 'inline',
    keywords: ['form', 'feedback', 'input', 'prompt'],
  });

  // ── Notes canvas app ─────────────────────────────────────────
  ai.registerWidget({
    id: 'canvas-notes',
    title: 'Notes Canvas',
    description: 'A minimal Markdown notes app rendered on the right-pane canvas.',
    entry: 'ui/notes.html',
    preferredSurface: 'widget',
    keywords: ['notes', 'markdown', 'text', 'writing', 'editor'],
  });

  ai.log.info(
    'Hello-world v2 extension loaded (counter + form + canvas-notes + reload-test).',
  );

  // Optional disposer — called before unregistration on reload/uninstall.
  return () => {
    ai.log.info('Hello-world extension disposing.');
  };
}
