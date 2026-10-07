import type { ReactNode } from "react";
import type { Season } from "../lib/season";

/* Holiday illustrations drawn behind the app while a seasonal theme is on: a scene in the corner and a few
   small motifs scattered above. "hero" is for the vault and project lists, "faint" for everything inside a
   project, where it must stay out of the way of the boards. */

export function SeasonArt({ season, variant }: { season: Season; variant: "hero" | "faint" }) {
  const { scene, motif, scatter } = ART[season];
  return (
    <div className={`season-art ${variant}`} aria-hidden>
      {variant === "hero" &&
        scatter.map((s, i) => (
          <svg
            key={i}
            className="season-motif"
            viewBox="-50 -50 100 100"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              rotate: `${s.r ?? 0}deg`,
              animationDelay: `${-i * 1.7}s`,
            }}
          >
            {motif}
          </svg>
        ))}
      <svg className="season-scene" viewBox="0 0 400 320">
        {scene}
      </svg>
    </div>
  );
}

interface Spot {
  x: number;
  y: number;
  size: number;
  r?: number;
}

/* ---------------------------------- Halloween ---------------------------------- */

const pumpkin = (dx: number, dy: number, s: number, face: boolean) => (
  <g transform={`translate(${dx} ${dy}) scale(${s})`}>
    <path d="M-4 -52 C-6 -66 -2 -78 10 -84 L16 -76 C8 -72 6 -64 8 -52 Z" fill="#5f7a2c" />
    <path
      d="M8 -70 C22 -84 40 -80 46 -68 C34 -72 22 -70 14 -62"
      fill="none"
      stroke="#6f8f34"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <ellipse cx="-44" cy="0" rx="38" ry="50" fill="#d9661a" />
    <ellipse cx="44" cy="0" rx="38" ry="50" fill="#d9661a" />
    <ellipse cx="-22" cy="0" rx="40" ry="54" fill="#ea7a22" />
    <ellipse cx="22" cy="0" rx="40" ry="54" fill="#ea7a22" />
    <ellipse cx="0" cy="0" rx="34" ry="56" fill="#f59234" />
    {face && (
      <g fill="#ffd36b">
        <path d="M-40 -14 L-18 -14 L-29 -34 Z" />
        <path d="M18 -14 L40 -14 L29 -34 Z" />
        <path d="M-6 0 L6 0 L0 -11 Z" />
        <path d="M-46 12 C-30 34 30 34 46 12 L36 16 L30 26 L22 18 L12 28 L4 19 L-6 28 L-14 18 L-24 27 L-30 17 L-38 20 Z" />
      </g>
    )}
  </g>
);

const bat = (
  <path
    fill="var(--art-ink)"
    d="M0 -4 C2 -9 5 -9 6 -5 C12 -12 24 -14 36 -7 C31 -5 29 0 30 5 C25 1 20 1 17 5 C14 1 9 1 6 5 C3 8 -3 8 -6 5 C-9 1 -14 1 -17 5 C-20 1 -25 1 -30 5 C-29 0 -31 -5 -36 -7 C-24 -14 -12 -12 -6 -5 C-5 -9 -2 -9 0 -4 Z"
  />
);

const halloweenScene = (
  <>
    <mask id="season-moon">
      <rect width="400" height="320" fill="#fff" />
      <circle cx="320" cy="68" r="42" fill="#000" />
    </mask>
    <circle cx="300" cy="80" r="46" fill="#fbe7a8" opacity="0.7" mask="url(#season-moon)" />
    <g transform="translate(150 70) scale(0.9)">{bat}</g>
    <g transform="translate(210 40) scale(0.6) rotate(-10)">{bat}</g>
    <path d="M0 312 C80 296 180 300 400 306 L400 320 L0 320 Z" fill="#3a2a40" opacity="0.55" />
    {pumpkin(120, 250, 0.62, false)}
    {pumpkin(270, 230, 1, true)}
  </>
);

/* ---------------------------------- Christmas ---------------------------------- */

const tier = (y: number, half: number, h: number) => (
  <path
    d={`M200 ${y - h} C212 ${y - h * 0.5} ${200 + half * 0.7} ${y - 8} ${200 + half} ${y} C${200 + half * 0.4} ${y + 10} ${200 - half * 0.4} ${y + 10} ${200 - half} ${y} C${200 - half * 0.7} ${y - 8} 188 ${y - h * 0.5} 200 ${y - h} Z`}
  />
);

const star = (cx: number, cy: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  });
  return <polygon points={pts.join(" ")} fill={fill} />;
};

const gift = (x: number, y: number, w: number, h: number, box: string, ribbon: string) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx="3" fill={box} />
    <rect x={x - 3} y={y - 8} width={w + 6} height="10" rx="2" fill={box} />
    <rect x={x + w / 2 - 4} y={y - 8} width="8" height={h + 8} fill={ribbon} />
    <path
      d={`M${x + w / 2} ${y - 8} C${x + w / 2 - 16} ${y - 24} ${x + w / 2 - 20} ${y - 6} ${x + w / 2} ${y - 8} C${x + w / 2 + 20} ${y - 6} ${x + w / 2 + 16} ${y - 24} ${x + w / 2} ${y - 8} Z`}
      fill="none"
      stroke={ribbon}
      strokeWidth="4"
    />
  </g>
);

const snowflake = (
  <g stroke="var(--art-ink)" strokeWidth="5" strokeLinecap="round" fill="none">
    {[0, 60, 120].map((a) => (
      <g key={a} transform={`rotate(${a})`}>
        <path d="M0 -40 L0 40" />
        <path d="M-10 -30 L0 -20 L10 -30 M-10 30 L0 20 L10 30" />
      </g>
    ))}
  </g>
);

const christmasScene = (
  <>
    <rect x="186" y="268" width="28" height="36" rx="3" fill="#7a4a2a" />
    <g fill="#176c43">
      {tier(270, 120, 90)}
      {tier(210, 95, 80)}
      {tier(152, 70, 72)}
    </g>
    <g fill="#1f8a55">
      {tier(262, 104, 80)}
      {tier(203, 80, 70)}
      {tier(146, 56, 62)}
    </g>
    <g fill="none" stroke="#f5c542" strokeWidth="3.5" strokeLinecap="round" opacity="0.9">
      <path d="M150 128 C180 148 222 146 244 122" />
      <path d="M128 188 C168 212 236 208 272 178" />
      <path d="M110 246 C160 274 244 270 292 236" />
    </g>
    <g>
      <circle cx="176" cy="108" r="7" fill="#e5484d" />
      <circle cx="226" cy="132" r="7" fill="#f2f2f2" />
      <circle cx="160" cy="168" r="8" fill="#f5c542" />
      <circle cx="214" cy="178" r="8" fill="#e5484d" />
      <circle cx="252" cy="196" r="7" fill="#f2f2f2" />
      <circle cx="140" cy="226" r="8" fill="#e5484d" />
      <circle cx="196" cy="238" r="9" fill="#f2f2f2" />
      <circle cx="262" cy="250" r="8" fill="#f5c542" />
      <circle cx="122" cy="262" r="7" fill="#f5c542" />
    </g>
    {star(200, 66, 22, "#f8d24a")}
    {gift(240, 278, 52, 30, "#e5484d", "#f5c542")}
    {gift(98, 284, 40, 24, "#4c7fd9", "#f2f2f2")}
    {gift(300, 290, 30, 18, "#f5c542", "#e5484d")}
    <g transform="translate(60 80) scale(0.35)">{snowflake}</g>
    <g transform="translate(340 60) scale(0.28)">{snowflake}</g>
    <g transform="translate(350 170) scale(0.22)">{snowflake}</g>
  </>
);

/* ---------------------------------- Easter ---------------------------------- */

const EGG = "M0 -50 C28 -50 40 -12 40 14 C40 38 22 52 0 52 C-22 52 -40 38 -40 14 C-40 -12 -28 -50 0 -50 Z";

const egg = (
  id: string,
  x: number,
  y: number,
  s: number,
  r: number,
  base: string,
  deco: string,
  pattern: "zig" | "dots" | "bands",
) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
    <clipPath id={id}>
      <path d={EGG} />
    </clipPath>
    <path d={EGG} fill={base} />
    <g clipPath={`url(#${id})`} fill={deco} stroke={deco}>
      {pattern === "zig" && (
        <path
          d="M-44 4 L-33 -8 L-22 4 L-11 -8 L0 4 L11 -8 L22 4 L33 -8 L44 4"
          fill="none"
          strokeWidth="6"
          strokeLinejoin="round"
        />
      )}
      {pattern === "zig" && <rect x="-44" y="22" width="88" height="7" stroke="none" />}
      {pattern === "dots" &&
        [
          [-16, -22],
          [12, -12],
          [-22, 10],
          [6, 16],
          [24, 30],
          [-8, 36],
          [26, -2],
        ].map(([cx, cy]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="5.5" stroke="none" />)}
      {pattern === "bands" && (
        <>
          <rect x="-44" y="-24" width="88" height="9" stroke="none" />
          <rect x="-44" y="2" width="88" height="14" stroke="none" opacity="0.6" />
          <rect x="-44" y="28" width="88" height="6" stroke="none" />
        </>
      )}
    </g>
  </g>
);

const bunny = (
  <g transform="translate(276 196)">
    <g fill="#f4eff6" stroke="#cbbfd2" strokeWidth="2.5">
      <ellipse cx="-16" cy="-108" rx="13" ry="40" transform="rotate(-10 -16 -108)" />
      <ellipse cx="16" cy="-108" rx="13" ry="40" transform="rotate(10 16 -108)" />
    </g>
    <g fill="#f7b6cf">
      <ellipse cx="-16" cy="-104" rx="6" ry="28" transform="rotate(-10 -16 -104)" />
      <ellipse cx="16" cy="-104" rx="6" ry="28" transform="rotate(10 16 -104)" />
    </g>
    <g fill="#f4eff6" stroke="#cbbfd2" strokeWidth="2.5">
      <ellipse cx="0" cy="34" rx="52" ry="58" />
      <ellipse cx="-26" cy="88" rx="22" ry="10" />
      <ellipse cx="26" cy="88" rx="22" ry="10" />
      <circle cx="0" cy="-44" r="36" />
    </g>
    <ellipse cx="0" cy="44" rx="30" ry="36" fill="#fbf8fc" />
    <circle cx="-13" cy="-50" r="4" fill="#3b2f40" />
    <circle cx="13" cy="-50" r="4" fill="#3b2f40" />
    <path d="M-5 -38 L5 -38 L0 -32 Z" fill="#f08bb4" />
    <path
      d="M0 -32 C-2 -26 -8 -26 -10 -29 M0 -32 C2 -26 8 -26 10 -29"
      fill="none"
      stroke="#b79fbf"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="-22" cy="-36" r="6" fill="#f7b6cf" opacity="0.6" />
    <circle cx="22" cy="-36" r="6" fill="#f7b6cf" opacity="0.6" />
  </g>
);

const grass = (
  <path
    fill="#6cc58e"
    d="M0 320 L0 300 L10 284 L16 300 L26 280 L32 298 L44 286 L50 300 L64 282 L70 298 L84 288 L90 300 L104 280 L110 298 L124 286 L130 300 L146 282 L150 298 L166 286 L172 300 L186 280 L192 298 L206 288 L212 300 L228 282 L232 298 L248 286 L254 300 L268 282 L274 298 L290 286 L296 300 L310 280 L316 298 L330 288 L336 300 L352 282 L356 298 L372 286 L378 300 L392 282 L400 296 L400 320 Z"
  />
);

const easterScene = (
  <>
    {bunny}
    {egg("season-egg-1", 92, 272, 0.62, -12, "#f7b6cf", "#e05c96", "zig")}
    {egg("season-egg-2", 150, 282, 0.5, 10, "#b9e4c9", "#3fa66b", "dots")}
    {egg("season-egg-3", 196, 280, 0.56, -4, "#cdbdf7", "#7c6cf0", "bands")}
    {egg("season-egg-4", 62, 290, 0.42, 16, "#fbe39a", "#e8a21c", "dots")}
    {grass}
  </>
);

const smallEgg = (
  <g>
    <clipPath id="season-motif-egg">
      <path d={EGG} />
    </clipPath>
    <path d={EGG} fill="#f7b6cf" />
    <path
      d="M-44 4 L-33 -8 L-22 4 L-11 -8 L0 4 L11 -8 L22 4 L33 -8 L44 4"
      clipPath="url(#season-motif-egg)"
      fill="none"
      stroke="#fff"
      strokeWidth="6"
    />
  </g>
);

// Motif spots in % of the page, kept to the right side below the header, clear of the lists and the welcome card.
const ART: Record<Season, { scene: ReactNode; motif: ReactNode; scatter: Spot[] }> = {
  halloween: {
    scene: halloweenScene,
    motif: <g transform="scale(1.3)">{bat}</g>,
    scatter: [
      { x: 74, y: 32, size: 44, r: -8 },
      { x: 84, y: 20, size: 30, r: 6 },
      { x: 92, y: 40, size: 36, r: -4 },
    ],
  },
  christmas: {
    scene: christmasScene,
    motif: snowflake,
    scatter: [
      { x: 72, y: 30, size: 30 },
      { x: 78, y: 46, size: 18, r: 20 },
      { x: 84, y: 22, size: 24, r: 10 },
      { x: 90, y: 38, size: 20 },
      { x: 95, y: 18, size: 28, r: 25 },
    ],
  },
  easter: {
    scene: easterScene,
    motif: smallEgg,
    scatter: [
      { x: 76, y: 32, size: 30, r: -14 },
      { x: 86, y: 22, size: 22, r: 12 },
      { x: 93, y: 40, size: 26, r: -6 },
    ],
  },
};
