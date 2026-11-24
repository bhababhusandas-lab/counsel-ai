/**
 * The Counsel AI seal: a guilloché rosette like the security pattern on Indian
 * stamp paper, drawn in ink. It replaces the old glowing orb as the voice button.
 *
 * States:
 *  - idle      still rosette, ink
 *  - listening outer ring turns red-tape, gently breathes
 *  - thinking  rosette turns slowly
 *  - speaking  waveform bars in the centre move
 */
type SealState = 'idle' | 'listening' | 'thinking' | 'speaking';

const SIZE = 200;
const C = SIZE / 2;

// Precompute the rosette: 36 ellipses rotated about the centre.
const PETALS = Array.from({ length: 36 }, (_, i) => (i * 360) / 36);
const INNER_PETALS = Array.from({ length: 24 }, (_, i) => (i * 360) / 24 + 7.5);

const Seal = ({ state, className = '' }: { state: SealState; className?: string }) => {
  const live = state !== 'idle';

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`seal seal--${state} ${className}`}
      aria-hidden="true"
    >
      <defs>
        <path
          id="seal-text-path"
          d={`M ${C},${C} m -78,0 a 78,78 0 1,1 156,0 a 78,78 0 1,1 -156,0`}
        />
      </defs>

      {/* Paper disc */}
      <circle cx={C} cy={C} r={96} className="seal__paper" />

      {/* Outer double rule */}
      <circle cx={C} cy={C} r={94} className="seal__ring seal__ring--outer" />
      <circle cx={C} cy={C} r={89} className="seal__ring" />

      {/* Circular legend, set like a court stamp */}
      <text className="seal__legend">
        <textPath href="#seal-text-path" startOffset="0" textLength={480} lengthAdjust="spacing">
          Counsel AI  ·  Ask in any Indian language  ·  Counsel AI  ·  Ask in any Indian language  ·
        </textPath>
      </text>

      <circle cx={C} cy={C} r={68} className="seal__ring" />

      {/* Guilloché rosette */}
      <g className="seal__rosette">
        {PETALS.map((a) => (
          <ellipse
            key={`o${a}`}
            cx={C}
            cy={C}
            rx={62}
            ry={22}
            transform={`rotate(${a} ${C} ${C})`}
            className="seal__petal"
          />
        ))}
        {INNER_PETALS.map((a) => (
          <ellipse
            key={`i${a}`}
            cx={C}
            cy={C}
            rx={40}
            ry={13}
            transform={`rotate(${a} ${C} ${C})`}
            className="seal__petal seal__petal--inner"
          />
        ))}
      </g>

      {/* Centre boss with waveform */}
      <circle cx={C} cy={C} r={24} className="seal__boss" />
      <g className="seal__wave">
        {[-12, -6, 0, 6, 12].map((x, i) => (
          <rect
            key={x}
            x={C + x - 1.5}
            y={C - 7}
            width={3}
            height={14}
            rx={1.5}
            className="seal__bar"
            style={{ animationDelay: `${i * 0.11}s`, transform: live ? undefined : 'scaleY(0.3)' }}
          />
        ))}
      </g>
    </svg>
  );
};

export default Seal;
