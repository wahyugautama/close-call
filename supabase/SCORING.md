# Close Call scoring

## Previous formula

The pre-Stage 6.2 implementation calculated percentage error as
`abs(guess - answer) / max(abs(answer), 1)` and awarded:

| Accuracy | Earned points |
| --- | ---: |
| Exact | `500 + (stake × 2)` |
| Within 5% | `350 + stake` |
| Within 15% | `200` |
| Within 30% | `100 - stake` |
| Otherwise | `-stake` |

Player scores were floored at zero. Missing guesses earned zero.

This made stakes inconsistent: some accuracy bands added a stake without a
corresponding downside, while other bands ignored the selected stake.

## Stage 6.2 formula

Accuracy uses `abs(guess - answer) / abs(answer)`:

| Accuracy | Base points |
| --- | ---: |
| Exact | 300 |
| Within 5% | 200 |
| Within 15% | 120 |
| Within 30% | 60 |
| Otherwise | 0 |

Stake adjustments are applied after base points:

| Stake | Success | Failure |
| ---: | --- | ---: |
| 0 | Base points only | No loss |
| 100 | `+100` when within 15% | `-100` |
| 250 | `+250` when within 5% | `-250` |

An exact zero guess for a zero answer receives exact-answer points and can win
a stake. A nonzero guess against a zero answer is outside every accuracy band.
Missing guesses earn zero. The existing zero-point score floor is preserved.

The authoritative calculation is `public.calculate_close_call_points`. The
client displays the persisted `game_submissions.earned` value and never sends
or calculates multiplayer earned points.

## Stage 6.3 comeback bonus

At the creation of rounds 5–7, every player’s score and that round’s highest
score are stored in `game_round_start_scores`. A player is eligible when the
leader has a positive score and the player starts at or below 70% of that
score. Leaders and players tied for first are never eligible.

An eligible player receives 100 additional points for a submitted guess within
15%, including the boundary. The bonus is independent of stake, is stored in
`game_submissions.comeback_bonus`, and is included once in `earned`. Missing
guesses and nonzero guesses against a correct answer of zero receive no bonus.
