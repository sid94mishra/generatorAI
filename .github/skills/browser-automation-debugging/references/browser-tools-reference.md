# VS Code Browser Tools Reference

## Tool Summary

These tools control an integrated Chromium browser for testing, debugging, and automation.

## Opening and Navigating

### open_browser_page
Launch a new browser tab at a given URL.

**Parameters:**
- `url` (required): Full URL to open (e.g., `http://localhost:5173/app`)

**Returns:** Page ID for use with other tools

**Example:** Open the application
```
Tool: open_browser_page
url: "http://localhost:3000/workflows"
```

### navigate_page
Move between URLs, history, or refresh current page.

**Parameters:**
- `pageId` (required): Page ID from open_browser_page
- `type` (required): One of: `"url"`, `"back"`, `"forward"`, `"reload"`
- `url`: Required when type is `"url"`

**Example:** Reload page to see fresh state
```
Tool: navigate_page
pageId: "page-123"
type: "reload"
```

## Reading and Inspecting

### read_page
Get the current structure, content, and element information from the page.

**Parameters:**
- `pageId` (required): Page ID from open_browser_page

**Returns:** Structured data including:
- Page title and URL
- Element tree with text, attributes, and references
- Form fields and values
- Links and buttons

**When to use:** Verify page state after navigation, inspect form inputs, find element references, validate content

**Example:** Check what's currently on the page
```
Tool: read_page
pageId: "page-123"
```

### screenshot_page
Capture visual state of entire page or specific element.

**Parameters:**
- `pageId` (required): Page ID from open_browser_page
- `selector` (optional): Playwright selector to capture single element
- `ref` (optional): Element reference from read_page
- `scrollIntoViewIfNeeded` (optional): Scroll element into view before capture (default: false)

**Returns:** Image file

**When to use:** Before/after comparisons, validate visual state, debug layout issues, document test coverage

**Example:** Screenshot the entire page
```
Tool: screenshot_page
pageId: "page-123"
```

**Example:** Screenshot a specific button
```
Tool: screenshot_page
pageId: "page-123"
selector: "button:has-text('Submit')"
```

## Interacting

### click_element
Click elements, with optional double-click support.

**Parameters:**
- `pageId` (required): Page ID from open_browser_page
- `selector` or `ref`: Element to click (use selector string or ref from read_page)
- `button` (optional): `"left"` (default), `"right"`, `"middle"`
- `dblClick` (optional): Set to true for double-click

**Example:** Click a button by text
```
Tool: click_element
pageId: "page-123"
selector: "button:has-text('Save')"
```

### type_in_page
Type text or press keyboard keys.

**Parameters:**
- `pageId` (required): Page ID from open_browser_page
- `text` or `key`: Text to type OR key combination to press (e.g., `"Enter"`, `"Escape"`, `"Control+c"`)
- `selector` or `ref` (optional): Target element; if omitted, types into focused element

**Example:** Type into a form field
```
Tool: type_in_page
pageId: "page-123"
selector: "input[placeholder='Search']"
text: "my search term"
```

**Example:** Press Enter to submit
```
Tool: type_in_page
pageId: "page-123"
key: "Enter"
```

### hover_element
Move mouse over element to trigger hover states.

**Parameters:**
- `pageId` (required): Page ID from open_browser_page
- `selector` or `ref`: Element to hover over

**Example:** Hover over element to reveal tooltip
```
Tool: hover_element
pageId: "page-123"
selector: "button[title='Help']"
```

## Advanced Interactions

### run_playwright_code
Execute custom Playwright code for complex interactions.

**Parameters:**
- `pageId` (required): Page ID from open_browser_page
- `code` (required): Playwright code snippet using provided `page` object

**Available:** `page` object with full Playwright API ([docs](https://playwright.dev/docs/api/class-page))

**Example:** Complex query and interaction
```
Tool: run_playwright_code
pageId: "page-123"
code: |
  const elements = await page.locator('button').all();
  for (const el of elements) {
    if (await el.textContent() === 'Delete') {
      await el.click();
      break;
    }
  }
```

### handle_dialog
Respond to browser modals (alerts, confirm dialogs, prompts).

**Parameters:**
- `pageId` (required): Page ID from open_browser_page
- `acceptModal` (optional): true to accept (default), false to dismiss
- `promptText` (optional): Text to enter in a prompt dialog
- `selectFiles` (optional): File paths for file chooser dialogs

**Example:** Dismiss an alert
```
Tool: handle_dialog
pageId: "page-123"
acceptModal: false
```

## Selector Syntax

Playwright supports multiple selector strategies:

| Strategy | Example | Use Case |
|----------|---------|----------|
| Text content | `"button:has-text('Save')"` | Buttons/links with visible text |
| Exact text | `"button:has-text('Save', exact=true)"` | When partial text matches aren't desired |
| CSS selector | `"input.email-field"` | Standard CSS |
| Placeholder | `"input[placeholder='Email']"` | Form inputs |
| Role + name | `"button[aria-label='Close']"` | Accessible elements |
| Attribute | `"[data-testid='submit-btn']"` | Test IDs |
| XPath | `"//button[contains(text(), 'Save')]"` | Complex DOM queries |

## Common Patterns

### Wait for Navigation
After clicking a link that navigates:
```
1. click_element to initiatenavigation
2. navigate_page "reload" or use run_playwright_code with page.waitForNavigation()
3. read_page to verify new page loaded
```

### Fill and Submit Form
```
1. read_page to see form fields
2. type_in_page into each input
3. click_element on submit button
4. read_page or screenshot_page to verify result
```

### Debug Element Not Found
```
1. screenshot_page to see visual state
2. read_page to inspect element tree and references
3. Try alternative selector based on visible attributes
4. Use run_playwright_code to test selector before automating
```
