export default function loadExtension(ai) {
  ai.registerWidget({
    id: 'studio',
    title: 'Document Studio',
    description:
      'Draft and edit PDF, Word (.docx), PowerPoint (.pptx), and Excel (.xlsx) documents together — ' +
      'block-based editor with a live preview, and a real, downloadable file on export.',
    entry: 'ui/studio.html',
    preferredSurface: 'widget',
    keywords: ['pdf', 'docx', 'word', 'document', 'powerpoint', 'pptx', 'slides', 'presentation', 'excel', 'xlsx', 'spreadsheet', 'report', 'export', 'file'],
    actions: [
      // ── Cross-document ──
      {
        name: 'setActiveType',
        description: 'Switch which document type is currently shown/edited (each type keeps its own independent content).',
        argsSchema: {
          type: 'object',
          properties: { docType: { type: 'string', enum: ['pdf', 'docx', 'pptx', 'xlsx'] } },
          required: ['docType'],
        },
      },
      {
        name: 'setTitle',
        description: 'Set the title of a document (used as the exported filename and, for pdf/docx, as its heading).',
        argsSchema: {
          type: 'object',
          properties: {
            docType: { type: 'string', enum: ['pdf', 'docx', 'pptx', 'xlsx'] },
            title: { type: 'string' },
          },
          required: ['docType', 'title'],
        },
      },
      {
        name: 'addNote',
        description: 'Leave a short note in the activity log (e.g. explaining a batch of changes you just made).',
        argsSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
      {
        name: 'exportDocument',
        description:
          'Generate the real file (actual .pdf/.docx/.pptx/.xlsx bytes) for a document and download it in the ' +
          "user's browser. Call this whenever the user asks to export/download/save/finish the document.",
        argsSchema: {
          type: 'object',
          properties: { docType: { type: 'string', enum: ['pdf', 'docx', 'pptx', 'xlsx'] } },
          required: ['docType'],
        },
        returns: '{ filename, sizeBytes } once the file has been generated and the download has started',
      },

      // ── PDF / DOCX — both are flow documents made of the same block types:
      //    heading | paragraph | bullets | table | divider ──
      {
        name: 'addBlock',
        description:
          "Add a content block to the pdf or docx document. Block shapes: " +
          "heading {type:'heading',level:1|2|3,text}, paragraph {type:'paragraph',text}, " +
          "bullets {type:'bullets',items:[string,...]}, table {type:'table',rows:[[string,...],...],header?:boolean}, " +
          "divider {type:'divider'}.",
        argsSchema: {
          type: 'object',
          properties: {
            docType: { type: 'string', enum: ['pdf', 'docx'] },
            index: { type: 'number' },
            block: { type: 'object' },
          },
          required: ['docType', 'block'],
        },
      },
      {
        name: 'updateBlock',
        description: 'Patch an existing block (e.g. change its text, level, items, or rows) by id.',
        argsSchema: {
          type: 'object',
          properties: {
            docType: { type: 'string', enum: ['pdf', 'docx'] },
            blockId: { type: 'string' },
            patch: { type: 'object' },
          },
          required: ['docType', 'blockId', 'patch'],
        },
      },
      {
        name: 'removeBlock',
        description: 'Remove a block by id.',
        argsSchema: {
          type: 'object',
          properties: { docType: { type: 'string', enum: ['pdf', 'docx'] }, blockId: { type: 'string' } },
          required: ['docType', 'blockId'],
        },
      },
      {
        name: 'reorderBlock',
        description: 'Move a block to a new position (0-based index) in the document.',
        argsSchema: {
          type: 'object',
          properties: {
            docType: { type: 'string', enum: ['pdf', 'docx'] },
            blockId: { type: 'string' },
            toIndex: { type: 'number' },
          },
          required: ['docType', 'blockId', 'toIndex'],
        },
      },

      // ── PPTX — slides made of elements: title | body | bullets | table ──
      {
        name: 'addSlide',
        description: 'Add a new slide to the presentation.',
        argsSchema: {
          type: 'object',
          properties: { index: { type: 'number' }, title: { type: 'string' } },
        },
      },
      {
        name: 'updateSlide',
        description: 'Rename a slide (patch its title).',
        argsSchema: {
          type: 'object',
          properties: { slideId: { type: 'string' }, patch: { type: 'object' } },
          required: ['slideId', 'patch'],
        },
      },
      {
        name: 'removeSlide',
        description: 'Remove a slide by id.',
        argsSchema: {
          type: 'object',
          properties: { slideId: { type: 'string' } },
          required: ['slideId'],
        },
      },
      {
        name: 'reorderSlide',
        description: 'Move a slide to a new position (0-based index).',
        argsSchema: {
          type: 'object',
          properties: { slideId: { type: 'string' }, toIndex: { type: 'number' } },
          required: ['slideId', 'toIndex'],
        },
      },
      {
        name: 'addSlideElement',
        description:
          "Add an element to a slide. Element shapes: title {type:'title',text}, body {type:'body',text}, " +
          "bullets {type:'bullets',items:[string,...]}, table {type:'table',rows:[[string,...],...]}.",
        argsSchema: {
          type: 'object',
          properties: {
            slideId: { type: 'string' },
            element: { type: 'object' },
            index: { type: 'number' },
          },
          required: ['slideId', 'element'],
        },
      },
      {
        name: 'updateSlideElement',
        description: 'Patch an existing slide element by id.',
        argsSchema: {
          type: 'object',
          properties: {
            slideId: { type: 'string' },
            elementId: { type: 'string' },
            patch: { type: 'object' },
          },
          required: ['slideId', 'elementId', 'patch'],
        },
      },
      {
        name: 'removeSlideElement',
        description: 'Remove an element from a slide by id.',
        argsSchema: {
          type: 'object',
          properties: { slideId: { type: 'string' }, elementId: { type: 'string' } },
          required: ['slideId', 'elementId'],
        },
      },

      // ── XLSX — workbook made of named sheets, each a 2D grid of strings ──
      {
        name: 'addSheet',
        description: 'Add a new sheet (tab) to the workbook.',
        argsSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
      {
        name: 'removeSheet',
        description: 'Remove a sheet by id.',
        argsSchema: {
          type: 'object',
          properties: { sheetId: { type: 'string' } },
          required: ['sheetId'],
        },
      },
      {
        name: 'setCell',
        description: 'Set a single cell value (0-based row/col). Grows the sheet automatically if out of bounds.',
        argsSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            row: { type: 'number' },
            col: { type: 'number' },
            value: { type: 'string' },
          },
          required: ['sheetId', 'row', 'col', 'value'],
        },
      },
      {
        name: 'setSheetRows',
        description: 'Bulk-replace an entire sheet’s data with a 2D array of row arrays (fastest way to populate a table).',
        argsSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            rows: { type: 'array' },
            headerRow: { type: 'boolean' },
          },
          required: ['sheetId', 'rows'],
        },
      },
    ],
  });

  ai.log.info('Document Studio loaded.');
}
