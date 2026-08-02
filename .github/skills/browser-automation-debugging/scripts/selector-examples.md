# Common Browser Selectors

Quick reference for selectors to use with click_element, type_in_page, hover_element, and screenshot_page.

## Buttons

By visible text:
```
"button:has-text('Click Me')"
"button:has-text('Save', exact=true)"
```

By aria-label:
```
"button[aria-label='Close']"
"button[aria-label='Delete Item']"
```

By data attribute (test ID):
```
"[data-testid='submit-button']"
"[data-testid='submit']"
```

By CSS class:
```
"button.primary"
"button.btn-submit"
```

## Form Inputs

By placeholder:
```
"input[placeholder='Enter your email']"
"input[type='email']"
```

By label text (accessible):
```
"input:has(+label:has-text('Email'))"
"textarea:has(+label:has-text('Message'))"
```

By name attribute:
```
"input[name='username']"
"input[name='email']"
```

By data-testid:
```
"input[data-testid='password-input']"
```

## Links

By text:
```
"a:has-text('Learn More')"
"a:has-text('Next Page')"
```

By href:
```
"a[href='/about']"
"a[href*='github.com']"  # Contains
"a[href^='https']"       # Starts with
```

## Dropdowns & Selects

By label:
```
"select:has(+label:has-text('Country'))"
```

By name:
```
"select[name='language']"
```

Opening and selecting options:
```
1. click_element to open dropdown
2. click_element with "option:has-text('Option Name')" to select
```

## Modals and Dialogs

Dialog close button:
```
"button[aria-label='Close']"
"button:has-text('Cancel')"
```

Modal backdrop (optional):
```
"[role='dialog']"
"[role='alertdialog']"
```

## Navigation Elements

Menu items:
```
"nav a:has-text('Home')"
"[role='navigation'] button:has-text('Menu')"
```

Tabs:
```
"[role='tab'][aria-label='Settings']"
"button[role='tab']:has-text('Overview')"
```

## Lists and Tables

Row by text:
```
"tr:has-text('John Doe')"
```

Cell in table:
```
"td:has-text('Completed')"
```

List items:
```
"li:has-text('Item Name')"
"[role='listitem']:has-text('Task 1')"
```

## Special Elements

Search input:
```
"input[type='search']"
"input[placeholder*='Search']"
```

Checkboxes:
```
"input[type='checkbox']"
"label:has-text('Accept Terms') input[type='checkbox']"
```

Radio buttons:
```
"input[type='radio'][value='option1']"
"label:has-text('Option 1') input[type='radio']"
```

## Combining Selectors

Multiple conditions (AND):
```
"button.primary:has-text('Save')"
"input[type='text'][placeholder='Email']"
```

First of type:
```
"button:first-child"
"input:has-text('Email'):nth-child(1)"
```

Contains text anywhere:
```
"*:has-text('Error')"
"div:has-text('Please check')"
```

## Tips

- **Prefer text matchers** when possible - they're stable and semantic
- **Use data-testid** if available in the code you're testing
- **Combine strategies** - use aria-label + role: `"button[role='button'][aria-label='Save']"`
- **Test in browser console** before using in automation
- **Avoid index-based** (nth-child) - they're brittle when DOM changes

## Testing Selectors

Before animating, verify a selector works in `run_playwright_code`:

```
Tool: run_playwright_code
pageId: "page-123"
code: |
  const element = await page.locator("button:has-text('Save')").first();
  console.log('Found:', await element.count() > 0);
  console.log('Visible:', await element.isVisible());
```
