import ResetLottery from "./ResetLottery";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Howl } from "howler";
import useStore from "../../store";
import stampSound from "../../assets/stamp.mp3";

const FIRST_ROLL_STAMP_DELAY = 260;
const STAMP_STAGGER_DELAY = 115;
const ROLL_SETTLE_DELAY = 1180;

export default function Lottery(props) {
  const max = 5; //total number of dials to check
  let dialsArr = Array.from(Array(50).keys());
  dialsArr = dialsArr.map((dial) => {
    return {
      number: dial + 1,
      checked: false,
    };
  });

  const [dials, setDials] = useState(dialsArr);
  const [isRolling, setIsRolling] = useState(false);
  const selectedNumbers = useStore((state) => state.numbers.selected);
  const setNumbers = useStore((state) => state.numbers.setNumbers);
  const buyTicket = useStore((state) => state.web3Demo.startTicketPurchase);
  const hasLotteryEnded = useStore((state) => state.hasLotteryEnded);
  const rollTimers = useRef([]);

  useEffect(() => {
    setNumbers(dials.filter((dial) => dial.checked).map((dial) => dial.number));
  }, [dials]);

  const controlSound = useMemo(() => new Howl({
    src: ["/click.wav"],
    volume: 0.16,
    rate: 1.08,
  }), []);
  const stamp = useMemo(() => new Howl({
    src: [stampSound],
    volume: 0.42,
  }), []);

  const playControlSound = useCallback(
    (rate = 1.08) => {
      controlSound.rate(rate);
      controlSound.stop();
      controlSound.play();
    },
    [controlSound]
  );

  const playStampSound = useCallback(() => {
    stamp.stop();
    stamp.play();
  }, [stamp]);

  const clearRollTimers = useCallback(() => {
    rollTimers.current.forEach((timer) => clearTimeout(timer));
    rollTimers.current = [];
  }, []);

  useEffect(() => {
    const handleControlPress = (event) => {
      if (!(event.target instanceof Element)) return;

      const button = event.target.closest("button");

      if (!button || button.disabled) return;
      if (!button.closest("lottery-module, bid-card, .reset-lottery")) return;

      const rate = button.classList.contains("plus")
        ? 1.18
        : button.classList.contains("minus")
        ? 0.98
        : 1.08;

      playControlSound(rate);
    };

    document.addEventListener("pointerdown", handleControlPress, true);

    return () => {
      document.removeEventListener("pointerdown", handleControlPress, true);
    };
  }, [playControlSound]);

  useEffect(() => clearRollTimers, [clearRollTimers]);

  function maxLimit() {
    const checked = dials.filter((dial) => dial.checked);
    return checked.length < max;
  }

  function resetDials() {
    const updatedDials = dials.map((dial) => ({
      ...dial,
      checked: false,
      class: "",
    }));
    setDials(updatedDials);
  }

  function removeRollClass() {
    setDials((currentDials) =>
      currentDials.map((dial) => ({ ...dial, class: "" }))
    );
  }

  function rollChecked() {
    const toChecks = getRndIntArr();
    toChecks.forEach((dialIndex, stampIndex) => {
      const timer = setTimeout(() => {
        setDials((currentDials) =>
          currentDials.map((dial, i) =>
            i === dialIndex
              ? {
                  ...dial,
                  checked: true,
                  class: `punched-slip punch-${stampIndex}`,
                }
              : dial
          )
        );
        playStampSound();
      }, stampIndex * STAMP_STAGGER_DELAY);
      rollTimers.current.push(timer);
    });
  }

  function getRndIntArr() {
    const numbers = [];
    for (let i = 0; i < max; i++) {
      let randomNum = Math.floor(Math.random() * dials.length);
      while (numbers.includes(randomNum)) {
        randomNum = Math.floor(Math.random() * dials.length);
      }
      numbers.push(randomNum);
    }
    return numbers;
  }

  //event handler
  function toggleChecked(number, event) {
    playControlSound(event.target.checked ? 1.12 : 0.95);
    if (event.target.checked && !maxLimit()) {
      alert("Can only Select " + max);
      return;
    }
    const updatedDials = dials.map((dial) => {
      if (dial.number == number) {
        return {
          ...dial,
          checked: event.target.checked,
          class: event.target.checked ? "punched-slip" : "",
        };
      }
      return dial;
    });
    setDials(updatedDials);
  }

  async function handleRoll(event) {
    event.preventDefault();

    const rollButton = event.currentTarget;
    clearRollTimers();
    setIsRolling(true);
    rollButton.style.pointerEvents = "none";
    resetDials();

    const updatedDials = dials.map((dial) => ({
      ...dial,
      checked: false,
      class:
        dial.number % 2 == 0 ? "rotate-center" : "rotate-center-reverse",
    }));

    setDials(updatedDials);
    rollTimers.current.push(setTimeout(rollChecked, FIRST_ROLL_STAMP_DELAY));
    rollTimers.current.push(setTimeout(() => {
      removeRollClass();
      rollButton.style.pointerEvents = "auto";
      setIsRolling(false);
    }, ROLL_SETTLE_DELAY));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (selectedNumbers.length < max) {
      buyTicket();
      return;
    }
    buyTicket();
  }

  const boardStatus = isRolling
    ? "shaking slips"
    : selectedNumbers.length >= max
    ? "wallet approval next"
    : `${selectedNumbers.length} / ${max} punched`;

  return (
    <lottery-module
      class={`${
        hasLotteryEnded ? "lottery-ended slide-in-right" : "slide-in-right"
      }`}
    >
      <ResetLottery shakeConnectButton={props.shakeConnectButton} />
      <form>
        <ul className={isRolling ? "dial-board is-rolling" : "dial-board"}>
          {dials.map((dial) => (
            <li key={`dialKey-${dial.number}`}>
              <input
                type="checkbox"
                id={`dial-${dial.number}`}
                className="dials"
                checked={dial.checked}
                onChange={(event) => {
                  toggleChecked(dial.number, event);
                }}
              />
              <label
                htmlFor={`dial-${dial.number}`}
                className={dial.class}
                //  onMouseEnter={() => sound.play()}
                //  onMouseLeave={() => sound.pause()}
              >
                <span>{dial.number}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="board-status" aria-live="polite">
          <span>{boardStatus}</span>
        </div>
        <div className="buttons">
          <button
            className={`roll attention-voice button`}
            onClick={handleRoll}
          >
            ROLL
          </button>
          <button
            className="submit attention-voice button contained"
            onClick={handleSubmit}
          >
            SUBMIT
          </button>
        </div>
      </form>
    </lottery-module>
  );
}
