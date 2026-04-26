import { describe, expect, it } from "vitest";
import { extractEmbeddedArticleFromHtml } from "./embedded-article.js";

describe("extractEmbeddedArticleFromHtml", () => {
  it("extracts Apollo paywalled content", () => {
    const html = `
      <html>
        <body>
          <script>
            window.__APOLLO_STATE__ = {
              "Article:abc": {
                "paywalledContent": {
                  "json": [
                    {
                      "children": [
                        { "attributes": { "value": "First paragraph." } },
                        { "attributes": { "value": " More text." } }
                      ]
                    },
                    {
                      "attributes": { "value": "Second paragraph." }
                    }
                  ]
                }
              }
            };
          </script>
        </body>
      </html>
    `;

    expect(extractEmbeddedArticleFromHtml(html)).toBe(
      "First paragraph. More text.\n\nSecond paragraph.",
    );
  });

  it("extracts JSON-LD articleBody from graph data", () => {
    const articleBody =
      "JSON-LD article body ".repeat(20);
    const html = `
      <script type="application/ld+json">
        {
          "@graph": [
            { "@type": "WebPage" },
            {
              "@type": "NewsArticle",
              "articleBody": "${articleBody}"
            }
          ]
        }
      </script>
    `;

    expect(extractEmbeddedArticleFromHtml(html)).toBe(
      articleBody,
    );
  });

  it("extracts article body from __NEXT_DATA__ script", () => {
    const articleBody = "Next article body ".repeat(20);
    const html = `
      <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "pageProps": {
              "article": {
                "body": "${articleBody}"
              }
            }
          }
        }
      </script>
    `;

    expect(extractEmbeddedArticleFromHtml(html)).toBe(
      articleBody,
    );
  });

  it("returns null when embedded article data is absent or malformed", () => {
    const html = `
      <script type="application/ld+json">{not json}</script>
      <script>window.__APOLLO_STATE__ = {</script>
      <main>No embedded article data.</main>
    `;

    expect(extractEmbeddedArticleFromHtml(html)).toBeNull();
  });
});
