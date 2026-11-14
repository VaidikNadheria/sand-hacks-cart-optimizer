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

1. Click **Try example cart**. Target wins at **$40.17**. Open **Best Target + Walmart split** to see $39.93 in items and $12.98 in shipping, for **$52.91**. This split also serves as the lowest-item-price baseline. The all-Target cart saves **$12.74**.
2. Click **Try budget example**. The same cart is **$3.17** over a **$37.00** budget. Open **Preview changed cart** to inspect the 8 fl oz CeraVe cleanser and its listing.
3. Click **Approve size change**. The total becomes **$36.97**, saving **$3.20** on items with **$0.00** shipping change. The locked calculator and fragrance-free lotion stay in the basket.
4. If asked about Gemini, open **Import shopping text with Gemini** and submit the sample from the provider section below. Show how the follow-up changes packaging eligibility while the requested quantity stays at two. If the provider is slow, open **Requirements** and show **Multipacks allowed** directly. That control uses the same cart rules.

## Compare your own list

1. Start on the blank list or click **New list** from an example. Add items and open **Requirements** to lock a product or mark a preferred brand or size as flexible.
2. Click **+ Add listing** on an item. Paste the retailer URL and enter the price per pack, units per pack, seller, stock, and shipping eligibility. If configured, **Look up listing** fills the fields returned by Bright Data. Confirm the exact variant and record any matching must-haves before saving. Click a saved offer chip to edit or remove it.
3. Click **Compare carts**. When a quote is missing or unpriceable, the result names the item and offers a shortcut to add or review a quote. Once you compare, quantity, budget, requirement, and quote edits refresh the result. Quotes attach to the individual line. Use **New list** to clear the example and its offers.

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

Set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in the process environment or a local `.env.local`. The default model is `gemini-2.5-flash`. The local server sends shopping text and clarification answers to Gemini only when the user submits the import. Gemini drafts structured fields and can ask one question per turn. For a quick test, request an exact TI-30XS MultiView and two bottles of Aveeno fragrance-free daily moisturizing lotion, 18 fl oz each. Ask Gemini to clarify whether a two-pack is acceptable. Answer that it is, then open the lotion’s **Requirements** and confirm the quantity is still two and **Multipacks allowed** is checked. The draft can match the example’s listing snapshot and any manual offers attached to the current lines. If the request fails, the existing cart stays editable. TypeScript makes all eligibility and price decisions. See [.env.example](.env.example).

To enable **Look up listing**, use the event’s Bright Data credits with a Web Scraper API token. Add `BRIGHT_DATA_API_KEY` to `.env.local` and restart the server. Copy the dataset ID for **Target products by URL** from the Bright Data API code example into `BRIGHT_DATA_TARGET_DATASET_ID`. For Walmart, Cartwise defaults to the documented product-by-URL dataset. Change `BRIGHT_DATA_WALMART_DATASET_ID` if your provider configuration specifies a different one. Keep the token server-side and make sure the account has credit before running live lookups.

To test, add an item, open **+ Add listing**, paste a known Target or Walmart product URL from the table above, and click **Look up listing**. Review the retrieved fields, complete pack, size, must-haves, and shipping as applicable, then save and compare. The lookup does not confirm the exact variant, pack count, ZIP-specific stock, or shipping eligibility. Prices only prefill when the provider returns a recognized USD final or current price. Failed or pending provider jobs leave the form available for manual entry. The snapshot demo works without either provider.

`npm run typecheck`, `npm run build`, and `npm test` check the build and cart logic. The included cases cover totals, both shipping thresholds, multipacks, split quantities, wrong variants, locked requirements, missing quotes, unknown fees, and a shipping charge that cancels most of a substitution’s savings.

The engine ranks only supplied, eligible offers. It supports quantities of 1–99 and whole packs. A search layer retains up to 10,000 subtotal states per line, and the results disclose when that cap can affect the winner.
