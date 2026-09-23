/**
 * Renders a JSON-LD block.
 *
 * Server component, no `"use client"`: structured data has to be in the HTML a
 * crawler receives. A crawler that does not run JavaScript sees nothing from a
 * client component, and that is the one audience this markup exists for.
 *
 * ## The escaping matters
 *
 * `JSON.stringify` does not escape `<`, so a product name containing
 * `</script>` — or any `<` at all — would close the tag early and inject the
 * remainder as markup. The catalogue is editable through `/admin`, which makes
 * this a real injection path and not a theoretical one. Replacing `<` with its
 * `\u003c` escape is valid JSON, parses identically, and cannot terminate the
 * element.
 *
 * `&` and `>` are escaped too. Neither can break out on its own, but both
 * appear in HTML-sensitive positions often enough that escaping all three is
 * the version that stays correct when somebody edits this later.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data)
    // Double backslash on purpose. `"\u003c"` in a JS string literal IS the
    // character `<`, so the single-backslash version replaced each character
    // with itself and escaped nothing (§43). `"\\u003c"` is the six characters
    // backslash-u-0-0-3-c, which is what JSON needs.
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return (
    <script
      type="application/ld+json"
      // Safe: the value is JSON with every HTML-significant character escaped
      // above, so it cannot leave the script element.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
