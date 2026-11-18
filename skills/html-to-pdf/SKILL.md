---
name: html-to-pdf
description: Turn an HTML page into a PDF file. Use it when the user asks for a PDF of something you write (a letter, quote, report, menu, flyer, price list) or of an HTML file in the resources or output folder.
---

# HTML to PDF

This skill has a script, `html-to-pdf.js`, that prints an HTML page to a PDF with the Chrome or Edge browser on this laptop. The PDF lands in the output folder.

## Steps

1. **Write the page.** Make one complete HTML document (`<!doctype html>` with `<style>` inside). Follow the design rules below.
2. **Run the script** with `run_skill_script`:
   - skill: `html-to-pdf`
   - script: `html-to-pdf.js`
   - input: `{ "html": "<the full HTML>", "name": "short-file-name" }`
   - Or, to print a file that already exists: `{ "file": "resources/templates/menu.html", "name": "menu" }`. Only files in `resources/` or `output/` can be used.
3. **Link the result** in your answer, exactly like this: `[menu.pdf](output/menu.pdf)`. Use the file name the script gives back.

If the script says no browser was found, tell the user that a PDF needs Chrome or Edge, and that an HTML file was saved instead which they can open and print to PDF.

## Design rules for a good PDF

- Page size A4: put `@page { size: A4; margin: 16mm; }` in the style.
- Use print-safe fonts: `font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif;` at about 10 to 11pt.
- Keep coloured backgrounds: add `* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`.
- Use one main colour for headings and lines. For the bakery: `#b04e1e`.
- Keep blocks together: `break-inside: avoid;` on cards, tables of totals and signature blocks.
- Money as `€ 12,50`, dates written out (15 December 2026).
- No external images or web fonts: they may not load. Pictures from the resources folder are fine if a tool turns them into data links.
- Never put real customer data in a PDF while you are practising.

## Example input

```json
{
  "name": "price-list-december",
  "html": "<!doctype html><html><head><meta charset='utf-8'><style>@page { size: A4; margin: 16mm; } body { font-family: Arial, sans-serif; } h1 { color: #b04e1e; }</style></head><body><h1>December prices</h1><p>Sourdough loaf: € 4,20</p></body></html>"
}
```
