import { AvatarStack } from "./avatars";
import { LocalTime } from "./local-time";
import { formatMinutes } from "@/lib/length";
import type { ParticipantView } from "@/lib/nights";
import { SubmitButton } from "./submit-button";

type Props = {
  startsAt: Date;
  durationMin: number;
  hostZone: string;
  voters: ParticipantView[];
  total: number;
  voted: boolean;
  best: boolean;
  /** Present while voting is open. Renders the Vote toggle. */
  voteAction?: () => Promise<void>;
  /** Present for the host while voting is open. Renders "Pick this time". */
  pickAction?: () => Promise<void>;
};

/** One suggested time: the day and hour, who can make it, and the Vote button. */
export function TimeOption({ startsAt, durationMin, hostZone, voters, total, voted, best, voteAction, pickAction }: Props) {
  const iso = startsAt.toISOString();
  return (
    <div className="ch-time">
      <div>
        <p className="ch-time__day">
          <LocalTime iso={iso} hostZone={hostZone} part="day" /> · {formatMinutes(durationMin)}
        </p>
        <p className="ch-time__at">
          <LocalTime iso={iso} hostZone={hostZone} part="time" />
        </p>
        <div className="ch-time__votes">
          {voters.length > 0 && <AvatarStack people={voters.map((v) => ({ userId: v.id, displayName: v.name, avatarTone: v.avatarTone }))} size="sm" max={4} />}
          <span className="ch-caption">
            {voters.length} of {total}
            {best ? " · most votes" : ""}
          </span>
        </div>
      </div>
      <div className="stack" style={{ gap: "var(--space-2)", alignItems: "stretch" }}>
        {voteAction && (
          <form action={voteAction}>
            <SubmitButton className="ch-btn ch-btn--pill ch-vote" aria-pressed={voted}>
              {voted ? "Voted" : "Vote"}
            </SubmitButton>
          </form>
        )}
        {pickAction && (
          <form action={pickAction}>
            <SubmitButton className="ch-btn ch-btn--pill is-accent">Pick this</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
