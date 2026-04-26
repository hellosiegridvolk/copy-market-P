# POSITION TRACKING

## Why this exists

If you top up your wallet after buying a copied position, naive sell logic can over-sell because current balance no longer reflects what the bot originally bought.

## Current approach

- On BUY, the bot records `myBoughtSize` for the copied trade
- That tracked purchase size is persisted in the local NeDB activity records
- On SELL, the bot sums prior `myBoughtSize` values for the same market/asset
- Sell sizing is then based on tracked purchased tokens rather than raw wallet balance changes

## Sell-path behavior

- Full close:
  - if the copied trader exits entirely, the bot can sell the corresponding local position
- Partial close:
  - the bot scales the sell amount against the tracked purchased size
  - after the sale, `myBoughtSize` is reduced proportionally across prior BUY records
- Near-complete close:
  - if the bot sells roughly all tracked size, prior `myBoughtSize` values are zeroed out

## Where to inspect it

- BUY/SELL persistence logic: `src/utils/postOrder.ts`
- Activity storage wrapper: `src/models/userHistory.ts`
- Trade lifecycle handling: `src/services/tradeExecutor.ts`

## Validation

- Run in preview mode first
- Inspect recent trade documents after BUY then SELL sequences
- Confirm `myBoughtSize`, `sizeExecuted`, `status`, and `lastError` fields match what happened
