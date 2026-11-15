# Cartwise · SanD Hacks

Cartwise compares complete shopping carts across Target and Walmart and tests one flexible preference when the best estimate exceeds the shopper’s budget.

## Start locally

Use Node.js 24.

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). For the production build, run `npm run build` then `npm start` and open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Judge demo · about 90 seconds

1. Click **Try a $37 shopping list**. Target wins at **$40.17**, including **$0.00** shipping. The split has lower item prices, **$39.93**, but adds **$12.98** shipping for **$52.91**.
2. In **One change to your cart**, compare **$40.17 before** and **$36.97 after**. The swap changes only the CeraVe cleanser from 16 fl oz to 8 fl oz.
3. Click **Approve size change**. The updated cart shows **$0.03 budget remaining**.
4. For a live result without a quoted price, use **View at retailer** directly on the row. Open **Listing details** for evidence and any pending price or stock check.

## Build your own cart

1. Search from the shopping input or use **Find listings** on a row. Search for the next item without clearing your picks.
2. Click **Add to cart** on a ready offer. If details are missing, open **Review offer**, confirm the variant and pack, and fill in the price, stock, seller, and shipping eligibility before adding it.
3. Use **Your cart** to change or remove selections. Quantity edits apply to the row. A selection that conflicts with an edit stays visible for review, and the total is pending until every row can be priced.
4. Use **Use recommended cart** to adopt the suggested listings explicitly. With a complete selected cart, approving a budget swap replaces the changed listing and keeps the other selections.

## Compare your own list

1. Start on the blank list or click **New list** from an example. Type the product name or import a shopping list with Gemini. Open **Requirements** to lock a product or mark a preferred brand or size as flexible.
2. Click **Find listings** beside a typed item, or submit the shopping text. Broad items open a questionnaire before retailer search. Choose a preset, **No preference**, or **Type my own**, then click **Apply answers**. **Skip and search** uses the original request. Exact items search immediately. Retailers update independently and verified offers appear as soon as they are ready. Once verified offers arrive, use the feature counts to narrow the results. **Show all matches** clears those filters and keeps typed requirements. Use **Compare carts** to search up to four items at a time.
3. Click **Review offer** on a result. Cartwise fills the link and the facts Bright Data returned. Check the pack, variant, must-haves, seller, stock, and shipping eligibility, then save. The cart recalculates when each eligible offer is saved. **+ Add listing** is also available for a manual quote, and you can edit or remove saved offers.

Without Bright Data, matching products from the demo snapshot can still be found by name, with **Snapshot** shown on the result. For example, try **Aveeno daily moisturizing lotion** on a blank list and click **Compare carts**.

The budget preview explains a lost free-shipping threshold when it raises the cost. A cost-increasing change is shown for comparison and has no approval button. The app keeps edits and offers in memory for the current page.

## Evidence and assumptions

| Offer | Evidence |
| --- | --- |
| Target TI-30XS MultiView, $13.99 | [Listing](https://www.target.com/p/-/A-14773104) |
| Target CeraVe hydrating cleanser, 16 fl oz, $16.19 | [Listing](https://www.target.com/p/-/A-51148016) |
| Target Aveeno fragrance-free daily moisturizing lotion, 18 fl oz, $9.99 | [Listing](https://www.target.com/p/-/A-10801059) |
| Target CeraVe hydrating cleanser, 8 fl oz, $12.99 | [Listing](https://www.target.com/p/-/A-76198439) |
| Target CeraVe hydrating cleanser, 12 fl oz, $13.79 | [Listing](https://www.target.com/p/-/A-13977968) |
| Walmart cleanser, $15.97, supplied snapshot | [Listing](https://www.walmart.com/ip/3HPHLFVA6EJI) |
| Walmart lotion, $9.97, supplied snapshot | [Listing](https://www.walmart.com/ip/10818473) |

The shipping example preserves the supplied snapshot. The budget example uses Target public pages checked **Nov 14, 2026 Pacific** for the exact variant, displayed price, and in-stock status. First-party seller identity is inferred from the first-party return terms and absence of a Target Plus partner label. Walmart offers remain the supplied snapshot. The Walmart cleanser URL could not be revalidated. The snapshot excludes the third-party Walmart calculator.

Totals are estimated before tax for eligible first-party standard shipping in the contiguous U.S. without retailer membership, card benefits, or coupons. Public pages don’t establish checkout stock or the final shipping fee for a specific ZIP. The optimizer charges once per retailer, with estimated free shipping from **$35**. Below that, Target is **$5.99** and Walmart is **$6.99**. [Target fee](https://www.target.com/help/article/000055608) · [Target $35 eligibility](https://www.target.com/help/article/000057407) · [Walmart fee](https://www.walmart.com/help/article/the-walmart-site-and-app-experience/27f2678cb25a40a7b57a359fec3ca67f)

## Provider and checks

Set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` (default `gemini-2.5-flash`). Set `BRIGHT_DATA_API_KEY` and `BRIGHT_DATA_SERP_ZONE` for direct Light JSON search. Keep credentials in `.env.local` or the server process environment and restart after changes. See [.env.example](.env.example).

To enable ShopSavvy, add `SHOPSAVVY_API_KEY=your_key` to `.env.local` in the project folder. Use a key from your own ShopSavvy Data API account. Restart with `PORT=4180 npm start` after `npm run build`, or restart `npm run dev`. The key is server-side. ShopSavvy and Bright Data run independently. ShopSavvy searches a concise query and requests offers for up to three shortlisted identifiers. **Look up listing** can also check a supported retailer URL. [ShopSavvy Data API](https://shopsavvy.com/data/documentation) · [Batch lookup](https://shopsavvy.com/data/documentation/product-batch)

ShopSavvy offers more than **48 hours** old stay out of current totals. An exact listing with verified pack count, a price observed within **14 days**, and evidence for the typed requirements can be selected explicitly in the estimated cart. The offer shows its last-checked date. Stock and shipping stay unconfirmed, and any budget comparison uses the estimated item subtotal before shipping. When Bright Data supplies an observation timestamp, the same rule applies. A Bright Data scrape's retrieval time is displayed separately from any supplied timestamp. Offers with missing seller, required variant, or stock stay out of search results. A missing pack or shipping detail can require offer review or leave the full cart total unconfirmed. A ShopSavvy receipt or product price is not a ZIP-specific quote.

Bright Data automatically tries the retailer catalog once if its SERP hits a CAPTCHA. **Check results** resumes the same in-memory catalog job. An expired or failed job needs an explicit **Search again**. Results from the other provider remain visible. When a retailer has no current quote, the app provides a direct Target or Walmart search link.

### ZIP and fulfillment

In **Fulfillment**, enter a five-digit US ZIP and choose **Shipping**, **Pickup**, or **Local delivery**, then click **Check local availability**. The connected data does not establish ZIP- or store-specific stock or fees, so Cartwise directs the shopper to the retailer. ZIP and method edits reset the fulfillment message and preserve selections. The policy-based standard-shipping estimate is shown separately from local pickup or delivery. Use **View at retailer** from the selected cart to continue on the retailer site.

### Demo data and live search

Use **Try a $37 shopping list** for the labeled Target/Walmart snapshot, shipping comparison, and $36.97 approval flow. Live search verifies the best matching retailer URLs, including leads with only a stale price. The results panel stops waiting after 45 seconds. It shows offers with a current price, stock, and seller, or direct retailer search links and a retry action. Pending checks reuse the same product job. Walmart is the default live check, and **Check Target live** runs the optional Target check. ShopSavvy can return Amazon listings, including by pasting an exact Amazon product link into a shopping field.

### Search checks

- Scooter details: enter `e-scooter` in the main search. Include your requirements in the shopping text, such as “e-scooter for commuting, speed 16–25 mph, commute distance 10 miles.” Commute distance means miles needed between charges. Use **Minimum advertised range** or **Maximum advertised range** to constrain the listing's advertised spec directly. Open **Listing details** for the two specs and the listing evidence. Missing or ambiguous specs stay unconfirmed. **Review & add** opens the cart eligibility fields when an offer needs confirmation.

- Shopping text: enter `shampoo for dry scalp` and click **Find products for me**. Answer any unresolved questions and click **Apply answers** to search. Optional filters on the results come from verified offers.
- Manual: enter `Hand Dish Soap` in Item 1 and click **Find listings**. If multiple verified sizes or scents are available, choose one, then use **Show all matches** to reset the filters.
- Exact: submit `I need one 18 fl oz bottle of Aveeno Daily Moisturizing Body Lotion for dry skin. It must be fragrance-free. I want the regular formula.` Expect a direct search that includes the named product, size and must-haves. A checked title with extra marketing words can still match. The fixtures cover the Target lotion (A-10801059), a same-price Sheer Hydration variant, missing evidence, and a TI-30XS model comparison.
- Item cap: submit `I need a fragrance-free body lotion for dry skin, under $15.` The item cap should be $15 and the whole-cart budget should stay blank.

Run `npm run typecheck && npm run build && npm test` for credential-free fixtures. They cover question batching, item caps, canonical URL deduplication, caching, partial retailer failure, exact variants, evidence, and the shipping and substitution demos. Retailer searches and product-page checks can use provider credits; use fixtures for repeated checks. Run `npx playwright install chromium` and `npm run test:browser` for the 390 px and 1440 px browser fixtures. You can use an existing Chrome installation with `CARTWISE_CHROME_CHANNEL=chrome npm run test:browser`.

The engine ranks only supplied, eligible offers. It supports quantities of 1–99 and whole packs. A search layer retains up to 10,000 subtotal states per line, and the results disclose when that cap can affect the winner.

## One Less Tab presentation demo

Start the local server with `npm run build` and `PORT=4180 npm start`. Open **Try the demo** at `http://127.0.0.1:4180/`. Type a product, answer the questions or choose **Skip and search**, choose **92101** or **92037**, and add an offer. The sample-only cart persists in this browser. Change ZIP to rehearse replacement and delivery fees. The original $37 snapshot remains accessible from the demo header.

For the extension, open `chrome://extensions`, enable **Developer mode**, and use **Load unpacked** on this project's `extension` folder. Click **One Less Tab** in the Chrome toolbar. Click **Open typed sample search**, find a product, and open **Listing details → Open sample product**. Click **Save this item** while that product tab is active. Repeat for a second sample, choose a ZIP, click **Compare saved items**, and use **Send to sample cart** beside an offer. The website opens with the resulting row.

With the local server running, `node test/browser/demo.mjs` verifies the website and `node test/browser/extension.mjs` tests the unpacked extension in headed Chrome for Testing. Install the matching browser with `npx playwright install chromium` or set `DEMO_CHROME_EXECUTABLE` to the absolute path of an existing Chrome for Testing executable.
