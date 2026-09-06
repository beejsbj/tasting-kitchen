# Fake Web3 Flow Spec: QRNG Lottery

## Purpose

Design a convincing fake Web3 flow for the current QRNG Lottery app without depending on live chain infrastructure.

The goal is not to pretend the old API3 contract is still alive. The goal is to preserve the feeling of the original contract-backed app: connect a wallet, approve a ticket purchase, submit a transaction, wait through confirmations, see contract-like state changes, request QRNG fulfillment, and leave behind inspectable hashes/receipts/history.

This spec is for the flow track. Visual polish should stay faithful to the existing paper/ink/carnival lottery-machine language described in `docs/CLAUDE_DESIGN_HANDOFF.md`.

## Experience Principle

The current app already has spectacle: animated number slips, chaotic motion, paper texture, star stamps, and loud buttons.

The missing layer is evidence.

Every important action should produce an artifact the user can inspect:

- connected wallet identity
- simulated chain/network
- transaction hash
- pending confirmation state
- receipt
- contract event
- QRNG request id
- lottery week/state change
- final entry history

This is what makes the demo feel like a dApp instead of a random toy with a loading screen.

## Primary User Flow

1. User lands on the lottery page.
2. App shows a disconnected wallet state.
3. User selects or rolls five lottery numbers.
4. User chooses ticket quantity.
5. User clicks `SUBMIT`.
6. If disconnected, the fake wallet extension opens.
7. User connects the demo wallet.
8. User clicks `SUBMIT` again, or the app resumes the pending intent.
9. Fake wallet opens a transaction approval panel.
10. User approves or rejects.
11. On approve, app creates a fake transaction hash and timeline entry.
12. App shows pending submission.
13. App advances through block confirmations.
14. App commits ticket entry to local lottery state.
15. Pot increases.
16. Receipt appears in transaction history.
17. Loading UI closes into a compact receipt/contract log, not just "Completed!".

## Secondary Flow: Lottery Reset / QRNG Fulfillment

When the countdown ends:

1. Lottery state becomes `ended`.
2. User sees reset/close-week action.
3. User clicks `Reset Lottery` or `Draw Winner`.
4. Fake wallet opens a higher-stakes contract call approval.
5. User approves or rejects.
6. On approve, app creates a fake transaction hash.
7. App emits `RequestedRandomNumber(requestId)`.
8. App shows QRNG fulfillment pending.
9. App reveals winning number with the app's existing stamp/star/lottery-machine language.
10. App emits `ReceivedRandomNumber(requestId, winningNumber)`.
11. App updates past winners.
12. App starts the next week/countdown.
13. App stores the draw receipt in history.

## State Machine

Use one explicit simulator state machine instead of scattered loading messages.

Suggested high-level states:

```text
idle
walletConnectPrompt
walletConnecting
walletConnected
txApprovalPrompt
txRejected
txSubmitted
txPending
txConfirming
txConfirmed
contractEvent
qrngRequested
qrngFulfilled
receiptReady
error
```

Suggested lottery states:

```text
open
entryPending
entryConfirmed
ended
drawApprovalPending
drawPending
randomnessPending
drawFulfilled
resetting
```

Keep wallet/transaction state separate from lottery state. They interact, but they are not the same thing.

## Fake Wallet Behavior

### Disconnected

Visible state:

- `Connect Wallet`
- optional small network hint: `Demo Chain`
- submit attempts should not silently proceed

Behavior:

- clicking `Connect Wallet` opens the fake wallet extension panel
- clicking `SUBMIT` while disconnected opens the same panel with context: "Connect to buy tickets"

### Connect Panel

Should feel like an extension popup rather than a generic modal:

- compact floating panel near top/right on desktop
- full-width bottom sheet or centered panel on mobile
- MetaMask-like but not a clone
- account preview after connection
- clear demo language without killing the illusion

Actions:

- `Connect`
- `Cancel`

On connect, generate:

- wallet address, for example `0x7A4c...91F2`
- balance, for example `1.842 demo ETH`
- network, for example `QRNG Demo Chain`
- chain id, for example `1337`

Persisting the fake wallet is a product choice:

- Option A: persist in `localStorage` so refresh feels wallet-like.
- Option B: reset on refresh so demos always start clean.

Recommendation: persist connected state, but include a visible disconnect/reset control.

## Transaction Approval Panel

For ticket purchase, show:

- method: `enter(uint256[] numbers, uint256 numberOfTickets)`
- contract: shortened existing demo address from store
- account: shortened fake wallet address
- numbers: selected five numbers
- tickets: quantity
- value: `0.001 ETH * tickets`
- estimated gas: fake but plausible
- nonce: incrementing integer

Actions:

- `Reject`
- `Approve`

Reject should create a lightweight rejected history entry, not just close.

For draw/reset, show:

- method: `getWinningNumber()`
- value: sponsor/top-up style fake amount, if desired
- expected event: `RequestedRandomNumber`

## Transaction Timeline

After approval, show an inspectable sequence. Keep durations short enough for demos.

Suggested purchase timeline:

```text
0.0s  Wallet approved
0.2s  Transaction submitted
0.8s  Hash generated
1.6s  Pending in mempool
2.4s  Block confirmation 1/3
3.2s  Block confirmation 2/3
4.0s  Block confirmation 3/3
4.5s  Contract event: TicketEntered
5.0s  Receipt ready
```

Suggested draw timeline:

```text
0.0s  Wallet approved
0.4s  Transaction submitted
1.2s  Contract event: RequestedRandomNumber
2.2s  Waiting for QRNG fulfillment
3.4s  Oracle callback received
4.0s  Contract event: ReceivedRandomNumber
4.6s  Winning number stamped
5.2s  Week reset
```

Do not use one full-screen overlay for the entire flow if it hides the app too long. Prefer a wallet panel plus a transaction rail/receipt panel that lets the board remain visible.

## Data Model

Add a simulator slice rather than expanding `ticket.loadingContract` and `reset.loadingContract` strings forever.

Suggested store shape:

```js
web3Demo: {
  wallet: {
    status: "disconnected" | "connecting" | "connected",
    address: null,
    balance: null,
    chainId: 1337,
    chainName: "QRNG Demo Chain"
  },
  activePrompt: null | {
    type: "connect" | "transaction",
    intentId: string,
    method?: string
  },
  activeTransactionId: null,
  transactions: []
}
```

Transaction shape:

```js
{
  id: "tx_...",
  type: "ticketPurchase" | "drawWinner",
  status: "draft" | "approved" | "submitted" | "pending" | "confirmed" | "rejected" | "failed",
  hash: "0x...",
  blockNumber: 4823912,
  confirmations: 0,
  nonce: 4,
  from: "0x...",
  to: "0x690B73FD0A7f922802C4E79f2465fd86C78b2Eee",
  method: "enter",
  args: {
    numbers: [3, 12, 19, 27, 44],
    numberOfTickets: 2
  },
  valueEth: "0.002",
  gasUsed: "85421",
  createdAt: "...",
  updatedAt: "...",
  events: [
    {
      name: "TicketEntered",
      args: {}
    }
  ]
}
```

Lottery shape:

```js
lotteryDemo: {
  week: 12,
  status: "open",
  endTime: 1234567890,
  potEth: "553",
  entries: [],
  lastDraw: null,
  winners: []
}
```

Entry shape:

```js
{
  id: "entry_...",
  week: 12,
  wallet: "0x...",
  numbers: [3, 12, 19, 27, 44],
  tickets: 2,
  txHash: "0x...",
  createdAt: "..."
}
```

## Components To Add Or Refactor

Likely new components:

- `DemoWalletPanel.jsx`
- `TransactionApproval.jsx`
- `TransactionRail.jsx`
- `ReceiptCard.jsx`
- `ContractEventLog.jsx`

Likely store files:

- `frontend/src/store/web3Demo.jsx`
- `frontend/src/store/lotteryDemo.jsx`

Likely integration points:

- `frontend/src/App.jsx`
- `frontend/src/components/LotteryApp/ConnectButton.jsx`
- `frontend/src/components/LotteryApp/Lottery.jsx`
- `frontend/src/components/LotteryApp/ResetLottery.jsx`
- `frontend/src/components/LotteryApp/Loading.jsx`
- `frontend/src/components/LotteryApp/BidCard.jsx`
- `frontend/src/components/LotteryApp/PastWinners.jsx`

## Current Code To Replace Carefully

The existing timed message flow lives in:

- `frontend/src/store/ticket.jsx`
- `frontend/src/store/reset.jsx`
- `frontend/src/components/LotteryApp/Loading.jsx`

Do not just add more strings there. The next implementation should move from message-only loading to event-backed transaction state.

The current wallet surface uses RainbowKit/Wagmi in:

- `frontend/src/main.jsx`
- `frontend/src/components/LotteryApp/ConnectButton.jsx`
- `frontend/src/App.jsx`
- `frontend/src/components/LotteryApp/Lottery.jsx`

Product choice:

- Keep RainbowKit as an optional "real wallet" curiosity.
- Or remove it from the primary demo path and make fake wallet the main flow.

Recommendation: make the fake wallet primary. The old infrastructure is gone; controlling the demo path matters more than preserving real wallet dependency.

## Flow Copy

Avoid apologetic copy like "if it was real" during the main flow. It punctures the demo at the exact wrong time.

Better:

- `Demo wallet approval`
- `Submitting ticket purchase`
- `Waiting for block confirmation`
- `TicketEntered event received`
- `Requesting QRNG winner`
- `QRNG fulfillment pending`
- `ReceivedRandomNumber event received`
- `Receipt ready`

Use "Demo" in labels or small metadata, not as a joke in the core moment.

## Implementation Slices

### Slice 1: Wallet Gate And Pending Intent

Goal:

- disconnected submit opens fake wallet panel
- connecting creates a fake account
- pending submit intent can resume after connect

Verification:

- `SUBMIT` while disconnected no longer starts ticket loading
- connect panel appears
- cancel returns to idle
- connect updates wallet UI
- selected numbers/ticket quantity remain intact

### Slice 2: Ticket Transaction Timeline

Goal:

- approving ticket purchase creates transaction object
- hash/confirmations/events render in a transaction rail
- pot and entry state update only after confirmation

Verification:

- every purchase has unique hash
- receipt shows selected numbers and tickets
- rejecting creates rejected entry or visible rejection state
- pot increments after confirmed, not before

### Slice 3: Receipt And History

Goal:

- confirmed transactions remain inspectable
- latest receipt is visible after overlay closes
- history can show purchase and draw events

Verification:

- reload behavior matches chosen persistence rule
- multiple purchases create multiple receipts
- long hashes truncate gracefully on mobile

### Slice 4: Draw / QRNG Fulfillment

Goal:

- countdown end moves lottery to ended state
- reset/draw flow creates request id
- winning number updates past winners and starts next week

Verification:

- cannot draw before lottery ends
- draw emits `RequestedRandomNumber` and `ReceivedRandomNumber`
- past winners update from local state
- new end time starts after draw fulfillment

### Slice 5: Remove Confusing Live-Chain Runtime Dependency

Goal:

- primary app no longer depends on live wallet/network for demo flow
- stale imports are removed where safe
- historical contract artifacts remain available as reference

Verification:

- `yarn build`
- browser console pass
- no external wallet required for core demo

## Open Product Decisions

These should be decided before implementation:

1. Should fake wallet state persist across refresh?
2. Should RainbowKit remain accessible anywhere, or should fake wallet fully replace it?
3. Should the draw happen only after the countdown, or should demo mode include a "fast forward" control?
4. Should receipts persist in localStorage, or reset per session?
5. Should ticket purchase allow fewer than five selected numbers for demo convenience, or enforce the contract rule?

My recommendations:

1. Persist wallet and receipts in localStorage.
2. Make fake wallet primary; remove RainbowKit from the main path.
3. Add a subtle demo fast-forward only if needed for presentations.
4. Persist receipts, but include a reset demo state control.
5. Enforce exactly five numbers. Contract realism is part of the spell.

## Verification Checklist

Before calling the flow done:

- `yarn build` passes
- desktop screenshot shows full board and transaction rail
- mobile screenshot around 390px wide has no horizontal scroll
- disconnected submit opens wallet, not loading overlay
- approve path creates hash/receipt/event
- reject path is visible and recoverable
- draw flow creates QRNG request id and winning number
- no copy says the app is broken, fake in a sheepish way, or dependent on dead infrastructure

