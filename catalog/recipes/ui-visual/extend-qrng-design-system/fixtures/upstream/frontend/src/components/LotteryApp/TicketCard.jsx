import useStore from "../../store";

export default function TicketCard() {
  const ticket = useStore((state) => state.ticket.amount);

  const setTicketAmount = useStore((state) => state.ticket.setAmount);

  function ticketDecrement() {
    if (ticket <= 1) return;
    setTicketAmount(ticket - 1);
  }

  function ticketIncrement() {
    if (ticket >= 10) return;
    setTicketAmount(ticket + 1);
  }

  return (
    <ticket-card>
      <header>
        <p className="ticket-kicker">counter 01</p>
        <h2 className="teaser-voice">Buy your Tickets</h2>
      </header>
      <div className="ticket-counter">
        <button
          className={`minus button attention-voice ${
            ticket <= 1 ? "disabled" : ""
          }`}
          onClick={ticketDecrement}
          aria-label="Remove one ticket"
        >
          ﹣
        </button>
        <p className="ticket-box loud-voice heartbeat">
          <span>{ticket}</span>
          <small>tickets</small>
        </p>
        <button
          className={`plus button attention-voice ${
            ticket >= 10 ? "disabled" : ""
          }`}
          onClick={ticketIncrement}
          aria-label="Add one ticket"
        >
          ＋
        </button>
      </div>
      <p className="ticket-limit">max 10 per wallet approval</p>
    </ticket-card>
  );
}
