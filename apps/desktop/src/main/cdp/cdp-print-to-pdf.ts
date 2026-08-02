// ────────────────────────────────────────────────────────────────
// CDP `Page.printToPDF` is not available for Electron webview/WebContentsView
// guests via `webContents.debugger`. Electron's native `printToPDF()` is the
// reliable equivalent — this maps CDP params to Electron's option shape.
//
// Unlike a real Chromium target, we never support `transferMode:
// "ReturnAsStream"` (Playwright's `page.pdf()` doesn't request it — it always
// reads `result.data` directly), so the proxy always returns inline base64.
// ────────────────────────────────────────────────────────────────

import type { PrintToPDFOptions } from 'electron';

const PDF_DEFAULT_MARGIN_INCHES = 1 / 2.54;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildPrintToPdfOptions(params: Record<string, unknown>): PrintToPDFOptions {
  const options: PrintToPDFOptions = {};

  if (typeof params.landscape === 'boolean') options.landscape = params.landscape;
  if (typeof params.displayHeaderFooter === 'boolean') options.displayHeaderFooter = params.displayHeaderFooter;
  if (typeof params.printBackground === 'boolean') options.printBackground = params.printBackground;
  if (typeof params.preferCSSPageSize === 'boolean') options.preferCSSPageSize = params.preferCSSPageSize;
  if (typeof params.generateTaggedPDF === 'boolean') options.generateTaggedPDF = params.generateTaggedPDF;
  if (typeof params.generateDocumentOutline === 'boolean') options.generateDocumentOutline = params.generateDocumentOutline;

  const scale = finiteNumber(params.scale);
  if (scale !== null && scale > 0) options.scale = scale;

  const paperWidth = finiteNumber(params.paperWidth);
  const paperHeight = finiteNumber(params.paperHeight);
  if (paperWidth !== null && paperHeight !== null && paperWidth > 0 && paperHeight > 0) {
    options.pageSize = { width: paperWidth, height: paperHeight };
  }

  const marginTop = finiteNumber(params.marginTop);
  const marginBottom = finiteNumber(params.marginBottom);
  const marginLeft = finiteNumber(params.marginLeft);
  const marginRight = finiteNumber(params.marginRight);
  if ([marginTop, marginBottom, marginLeft, marginRight].some((margin) => margin !== null)) {
    options.margins = {
      marginType: 'custom',
      top: marginTop ?? PDF_DEFAULT_MARGIN_INCHES,
      bottom: marginBottom ?? PDF_DEFAULT_MARGIN_INCHES,
      left: marginLeft ?? PDF_DEFAULT_MARGIN_INCHES,
      right: marginRight ?? PDF_DEFAULT_MARGIN_INCHES,
    };
  }

  if (typeof params.pageRanges === 'string') options.pageRanges = params.pageRanges;
  if (typeof params.headerTemplate === 'string') options.headerTemplate = params.headerTemplate;
  if (typeof params.footerTemplate === 'string') options.footerTemplate = params.footerTemplate;

  return options;
}
