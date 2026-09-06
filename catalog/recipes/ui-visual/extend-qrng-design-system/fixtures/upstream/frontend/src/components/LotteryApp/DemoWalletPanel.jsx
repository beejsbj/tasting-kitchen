import useStore from "../../store";

function shortHash(value) {
  if (!value) return "";
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function promptTitle(prompt) {
  if (!prompt) return "";
  if (prompt.type === "connect") return "Demo Wallet";
  if (prompt.intent.type === "drawWinner") return "Approve Draw";
  return "Approve Ticket";
}

export default function DemoWalletPanel() {
  const prompt = useStore((state) => state.web3Demo.activePrompt);
  const wallet = useStore((state) => state.web3Demo.wallet);
  const connectWallet = useStore((state) => state.web3Demo.connectWallet);
  const closePrompt = useStore((state) => state.web3Demo.closePrompt);
  const approveTransaction = useStore(
    (state) => state.web3Demo.approveTransaction
  );
  const rejectPrompt = useStore((state) => state.web3Demo.rejectPrompt);
  const contractAddress = useStore((state) => state.contractAddress);

  if (!prompt) return null;

  const intent = prompt.intent;

  return (
    <div className="demo-wallet-backdrop">
      <div className="wallet-annotation-layer" aria-hidden="true">
        <span className="wallet-paper-mark wallet-paper-mark-top" />
        <span className="wallet-ink-arrow wallet-ink-arrow-primary" />
        <span className="wallet-ink-arrow wallet-ink-arrow-secondary" />
        <span className="wallet-paper-mark wallet-paper-mark-bottom" />
      </div>
      <aside
        className="demo-wallet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={promptTitle(prompt)}
        aria-live="polite"
      >
        <header>
          <p className="teaser-voice">{promptTitle(prompt)}</p>
          <button
            className="wallet-close"
            onClick={closePrompt}
            type="button"
            aria-label="Close wallet panel"
          >
            x
          </button>
        </header>

        {prompt.type === "connect" && (
          <section className="wallet-connect-body">
            <h2 className="attention-voice">Connect demo wallet</h2>
            <dl className="wallet-contract-slip">
              <div>
                <dt>Network</dt>
                <dd>{wallet.chainName}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>Local receipt simulation</dd>
              </div>
              {intent && (
                <div>
                  <dt>Pending action</dt>
                  <dd>{intent.label}</dd>
                </div>
              )}
            </dl>
            <div className="wallet-actions">
              <button
                className="button outline"
                onClick={rejectPrompt}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button"
                onClick={connectWallet}
                type="button"
                disabled={wallet.status === "connecting"}
              >
                {wallet.status === "connecting" ? "Connecting" : "Connect"}
              </button>
            </div>
          </section>
        )}

        {prompt.type === "transaction" && (
          <section className="wallet-transaction-body">
            <h2 className="attention-voice">{intent.label}</h2>
            <dl className="wallet-contract-slip">
              <div>
                <dt>Contract</dt>
                <dd>{shortHash(contractAddress)}</dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>{intent.signature}</dd>
              </div>
              {intent.type === "ticketPurchase" && (
                <>
                  <div>
                    <dt>Numbers</dt>
                    <dd>{intent.numbers.join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Tickets</dt>
                    <dd>{intent.tickets}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Value</dt>
                <dd>{intent.valueEth} ETH</dd>
              </div>
              <div>
                <dt>Event</dt>
                <dd>{intent.expectedEvent}</dd>
              </div>
            </dl>
            <div className="wallet-actions">
              <button
                className="button outline"
                onClick={rejectPrompt}
                type="button"
              >
                Reject
              </button>
              <button
                className="button"
                onClick={approveTransaction}
                type="button"
              >
                Approve
              </button>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
