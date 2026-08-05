# Kyiv Suburb Townhouses — canonical listing search policy

This file is the mandatory operating policy for every future data-collection, verification, cleanup, QA, and enrichment run for the Townhouse catalog and the connected Supabase database.

## 1. Main objective

The production catalog must contain current, directly verifiable listings and official active project inventory. Old search snippets and category pages may be retained only as research evidence; they are not production listings.

## 2. Strict city order

Finish one city before moving to the next:

1. Буча
2. Ірпінь
3. Гостомель
4. Горенка
5. Вишгород
6. Вишневе
7. Other nearest Kyiv suburbs

A city is considered finished only when all existing review records are resolved and a fresh search of the required sources produces no additional direct active listings.

## 3. Source classes

### A. Direct live source — allowed to create or publish a unit

A source qualifies only when it is one of the following:

- a direct OLX listing URL with a unique listing ID;
- a direct DIM.RIA property URL;
- a direct Online.ua property URL;
- a direct listing on another marketplace with a unique listing identifier;
- an official developer page for a concrete project, unit, section, or floor plan;
- an official project inventory page that clearly identifies a distinct area/section and current availability.

The page must open during the current run and show that the listing or inventory is active.

### B. Search-only evidence — never create a production unit

The following are discovery evidence only:

- city/category/search result pages;
- Google/Bing snippets;
- OLX search pages without a recoverable direct listing URL;
- DIM.RIA city or category pages without a direct property page;
- cached, indexed, preview, or aggregator fragments;
- a title/price seen only in search results;
- a dead direct URL preserved by a search engine.

Search-only evidence may be stored as a source observation or research candidate, but must not create a new `public.units` record and must never be published.

## 4. Rule for creating a new unit

Create a new `public.units` row only when all conditions below are met:

1. A direct live source is available.
2. The object is actually a townhouse, duplex, or clearly eligible attached-house unit.
3. Settlement is verified from the page content, address, map, or official project data.
4. At minimum, area and one of price/address/project are known.
5. A duplicate check has been completed against existing units.
6. The source was opened and checked during the current run.
7. `checked_at` and the source verification evidence are recorded.

If any condition is missing, keep it as a candidate/source observation, not as a unit.

## 5. Duplicate policy

Check similarity using:

- direct source ID and URL;
- project and address;
- area;
- price;
- photos;
- seller/developer;
- phone;
- description and layout;
- land area and room count.

Exact same source ID or same project + same area/section is normally one canonical unit.

When uncertain:

- do not merge automatically;
- set `possible_duplicate`;
- fill `possible_duplicate_of`;
- record a specific `duplicate_reason`.

Archive a duplicate only when the match is sufficiently proven.

## 6. Status rules

### Published

Allowed only when:

- direct live source is accessible;
- object type and settlement are verified;
- no unresolved high-risk duplicate exists;
- required public fields are sufficiently complete;
- photos are usable or the project has valid official imagery.

### Review

Use when the direct page exists but one or more important details remain unresolved, such as price conflict, exact section, seller identity, or duplicate uncertainty.

### Search-only candidate

Use only outside the production-unit layer, preferably in `source_observations` or a candidate queue. A search-only candidate must not be published.

### Archive

Use when:

- the listing is removed or explicitly inactive;
- sales are suspended;
- the record is a confirmed duplicate;
- the object is not an eligible townhouse/duplex;
- the source was materially misclassified;
- the project is historical and retained only for research.

Do not archive merely because a temporary page fetch failed. First mark the source unavailable and recheck through the direct ID, seller profile, official project page, and at least one independent source.

## 7. Old and dead links

Old/dead links are useful only for:

- parser and UI testing;
- duplicate history;
- price-history evidence;
- source-removal behavior;
- regression fixtures.

They must be clearly labeled as test/research/archive data and kept separate from live production inventory.

## 8. Required verification fields

For each processed live listing, record as available:

- direct source URL;
- platform and external listing ID;
- source access status;
- checked date/time;
- settlement and address;
- price and currency;
- area;
- rooms/bedrooms or section count;
- floors and land area;
- seller/developer name;
- phone and seller profile URL when publicly available;
- publication status;
- duplicate status and reason;
- source evidence URLs;
- material changes from the previous check.

Never invent a hidden phone, missing price, address, or room count.

## 9. Per-run procedure

Before every run:

1. Read the latest `verification_runs` entry.
2. Read current unresolved records for the active city.
3. Exclude units already checked in the preceding run.
4. Search direct sources first; use search pages only to discover direct URLs.
5. Process the requested batch completely.
6. Write one canonical verification-run report.

The report must distinguish:

- total checks;
- unique units touched;
- new direct live units inserted;
- existing units updated;
- confirmed duplicates archived;
- possible duplicates retained;
- inactive/removed listings;
- search-only candidates not inserted;
- unavailable platforms;
- next city.

## 10. Non-negotiable rules

- One Supabase Townhouse database only.
- No new unit from a category page or search snippet.
- No publication without a direct live source.
- No automatic merge under uncertainty.
- No switching cities before the current city is complete.
- Search results are discovery tools, not inventory.
- Live links take priority over historical coverage volume.
