import { useEffect } from "react";
import useStore from "../../store";

export default function PastWinners() {
  //winning number of last N weeks
  const getWinningNumbers = useStore(
    (state) => state.winner.getLastNWeeksWinningNumber
  );
  const WinningNumbers = useStore(
    (state) => state.winner.LastNWeeksWinningNumber
  );

  //winning pot of last N weeks
  const getWinningPots = useStore(
    (state) => state.winner.getLastNWeeksWinningPot
  );
  const WinningPots = useStore((state) => state.winner.LastNweeksWinningPot);

  useEffect(() => {
    getWinningNumbers();
    getWinningPots();
  }, []);

  return (
    <past-card class="slide-in-left">
      <header>
        <p className="ticket-kicker">ledger</p>
        <h2 className="teaser-voice">past winners</h2>
      </header>

      <ol className="winner-board">
        {WinningNumbers.map((WinningNumber, i) => {
          const winningNumber = String(WinningNumber).padStart(2, "0");
          const winningPot = WinningPots[i] ?? "--";
          return (
            <li
              key={i}
              className={i == 0 ? "winner-row latest" : "winner-row"}
            >
              <span className="winner-rank">#{i + 1}</span>
              <span className="winner-number">{winningNumber}</span>
              <span className="winner-pot">Ξ {winningPot}</span>
              <span className="winner-week">week {3 - i}</span>
            </li>
          );
        })}
      </ol>
    </past-card>
  );
}
