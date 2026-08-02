---
name: browser-automation-debugging
description: 'Test and debug web applications using VS Code browser tools. Use when: automating browser interactions, writing Playwright tests, debugging UI behavior, debugging browser state, inspecting elements, capturing screenshots, debugging API responses, monitoring network traffic.'
argument-hint: 'Describe what browser action to automate or debug'
---

# Browser Automation and Debugging

## When to Use

- **Testing**: Define and automate browser interactions, write Playwright test scripts, verify UI functionality.
- **Debugging**: Inspect element state, capture screenshots, read page content, troubleshoot UI behavior
- **Inspection**: Monitor network activity, analyze page structure, verify element properties, debug navigation issues
- **Diagnosis**: Reproduce errors, validate interactions work as expected, trace execution across browser state

## Key Tools Available

The VS Code integrated browser tools provide these capabilities:
- **open_browser_page**: Launch and navigate to URLs
- **read_page**: Get current page structure and element details
- **screenshot_page**: Capture visual state of page or specific elements
- **click_element**: Interact with UI by selector or reference
- **type_in_page**: Enter text or press keys
- **hover_element**: Trigger hover states
- **run_playwright_code**: Execute custom Playwright logic for complex interactions
- **navigate_page**: Manage browser history, reload pages
- **handle_dialog**: Respond to modals (alerts, confirms, prompts)

## Workflow: Test and Verify User Flows

### 1. Setup: Open and Navigate
```
1. Use open_browser_page to launch the application URL
2. Verify page loads by reading page structure with read_page
3. Capture initial state with screenshot_page
4. Note any errors in Problems view
```

### 2. Interact: Simulate User Actions
```
1. Identify target element by selector or accessible name
2. Use click_element to interact (click, double-click)
3. Use type_in_page to fill forms or enter commands
4. Use hover_element to trigger hover states or tooltips
5. Use navigate_page to move through application flows
```

### 3. Verify: Check Results
```
1. Capture screenshot after interaction withscreenshot_page
2. Use read_page to inspect DOM structure and element state
3. Verify expected changes (text, attributes, element visibility)
4. Check for console errors or warnings in output
```

### 4. Debug: Troubleshoot Failures
```
1. Capture screenshot to see current visual state
2. Use read_page to examine element properties and hierarchy
3. Use run_playwright_code for deep inspection or complex queries
4. Check browser console for JavaScript errors
5. Use navigate_page to understand navigation state
```

## Best Practices

### Selector Strategies
- **Prefer accessible labels**: Use `text=` matcher for buttons: `"button:has-text('Submit')"`
- **Use `data-testid`**: If elements have test IDs, use `[data-testid="element-name"]`
- **Fallback to CSS**: Use stable CSS selectors when labels aren't available
- **Avoid brittle selectors**: Don't rely on index positions; use semantic identifiers

### Workflow Patterns

**Verify Form Submission**
1. Click form inputs and type values
2. Capture screenshot of filled form
3. Click submit button
4. Read resulting page to verify success (redirects, confirmations, etc.)

**Debug Element Interaction**
1. Take screenshot to see current state
2. Read page to inspect element properties
3. Click/hover the element
4. Capture screenshot to see what changed
5. If unexpected, use run_playwright_code to inspect event listeners

**Troubleshoot Navigation**
1. Use navigate_page with URLs or history
2. Verify page loaded with read_page
3. Check for error modals with screenshot_page
4. If stuck, use handle_dialog to dismiss alerts

**Capture and Compare**
1. Take screenshot before action
2. Perform interaction
3. Take screenshot after action
4. Visually compare to identify UI changes

### Error Handling
- If modal appears unexpectedly: Use `handle_dialog` to close it
- If element not found: Review screenshot and try alternative selector
- If navigation fails: Check URL in read_page output and use navigate_page
- If timeout occurs: Add delay logic or retry in run_playwright_code

## Debugging Tips

**Inspect Page Structure**
```
Use read_page to understand the DOM, find element references, and identify accessibility information available for selectors.
```

**Verify Selectors Work**
```
In run_playwright_code, use context to test selectors before automating interactions.
```

**Monitor Visual Changes**
```
Screenshot before and after interactions to track what updated on the page.
```

**Trace Browser State**
```
Use read_page repeatedly to watch state changes as you navigate and interact.
```

## References

- [Playwright Documentation](https://playwright.dev) for advanced selector syntax and APIs
- [VS Code Browser Tools Guide](./references/browser-tools-reference.md) - detailed tool parameters
- [Common Selectors](./scripts/selector-examples.md) - copy-paste selector patterns
