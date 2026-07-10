import type { CSSProperties } from "react";

type RewardConfettiProps = {
  burstId: number;
};

const confettiPieces = Array.from({ length: 18 }, (_, index) => index);

export function RewardConfetti({ burstId }: RewardConfettiProps) {
  if (burstId <= 0) return null;

  return (
    <div className="reward-confetti" aria-hidden="true" key={burstId}>
      {confettiPieces.map((piece) => (
        <span key={piece} style={{ "--piece-index": piece } as CSSProperties} />
      ))}
    </div>
  );
}