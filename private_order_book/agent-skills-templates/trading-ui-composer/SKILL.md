---
name: trading-ui-composer
description: Compose dense trading interfaces with clear panel hierarchy, responsive constraints, and execution-safe controls for order entry, charting, book, and activity views.
---

# Trading UI Composer

Use this skill when building or refactoring a trading interface.

## Layout Standard
Target six-box composition:
- order entry
- order book
- price chart
- trade history
- user activity
- funding/account panel

## Interaction Rules
- Wallet connection must be explicit and visible.
- Disable actions only with actionable error text.
- Avoid redundant controls (for example, side toggle + Buy/Sell buttons).
- Market vs limit behavior must be explicit in UI and payload.

## Data Rules
- Display token names and token IDs together.
- Prefer market identity by token IDs / market ID, not symbol strings.
- Show stale-sync warnings before order submission in real-funds mode.

## Performance Rules
- Poll status/book/trades on short intervals with sane caps.
- Keep table rendering incremental and bounded.
- Persist user selections (market, order type, rows) locally.

## Visual Rules
- Keep high contrast and scanability.
- Keep panel heights and boundaries consistent.
- Preserve key header/nav controls while scrolling.
