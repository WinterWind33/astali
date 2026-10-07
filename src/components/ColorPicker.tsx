import { Check, Pencil, Pipette, Star, Trash2, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { type Hsv, contrastText, hexToHsv, hexToRgb, hsvToHex, normalizeHex, rgbToHex } from "../lib/color";
import { addFavoriteColor, removeFavoriteColor, renameFavoriteColor, useStore } from "../lib/store";
import type { Color, FavoriteColor } from "../lib/types";
import { COLOR_KEYS, colorHex, cx, isPreset } from "../lib/util";

/**
 * Preset swatches, the user's favorites, and a custom-color editor (HSV area, hue slider,
 * HEX / RGB / HSV inputs). `picked` is true for a deliberate swatch click and false while a
 * custom color is being dialed in, so callers can close a popover only on the former.
 */
export function ColorPicker({ value, onChange }: { value: Color; onChange: (c: Color, picked: boolean) => void }) {
  const favorites = useStore((s) => s.config.favoriteColors);
  const custom = !isPreset(value);
  const hex = colorHex(value);
  const [editing, setEditing] = useState(false);

  return (
    <div className="color-picker-wrap">
      <div className="color-picker">
        {COLOR_KEYS.map((c) => (
          <Swatch key={c} hex={colorHex(c)} title={c} selected={value === c} onClick={() => onChange(c, true)} />
        ))}
        {favorites.length > 0 && <span className="color-picker-sep" />}
        {favorites.map((f) => (
          <Swatch
            key={f.id}
            hex={f.hex}
            title={`${f.name} (${f.hex})`}
            selected={custom && hex === f.hex}
            onClick={() => onChange(f.hex, true)}
          />
        ))}
        <button
          type="button"
          className={cx("color-swatch custom", custom && "selected", editing && "open")}
          style={{ "--c": custom ? hex : undefined } as React.CSSProperties}
          onClick={() => setEditing(!editing)}
          title="Custom color…"
        >
          <Pipette size={12} strokeWidth={2.5} style={{ color: custom ? contrastText(hex) : undefined }} />
        </button>
      </div>
      {editing && <ColorEditor hex={hex} onChange={(h) => onChange(h, false)} />}
    </div>
  );
}

function Swatch({
  hex,
  title,
  selected,
  onClick,
}: {
  hex: string;
  title: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx("color-swatch", selected && "selected")}
      style={{ "--c": hex } as React.CSSProperties}
      onClick={onClick}
      title={title}
    >
      {selected && <Check size={12} strokeWidth={3} style={{ color: contrastText(hex) }} />}
    </button>
  );
}

// ---------------------------------------------------------------- editor

/** Tracks pointer drags over an element, reporting the position as fractions in [0, 1]. */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: ReactPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    );
  };
  const props = {
    ref,
    onPointerDown: (e: ReactPointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
    },
  };
  return props;
}

function ColorEditor({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) {
  // HSV is the source of truth while editing so hue/saturation survive passing through grays and black.
  const [hsv, setHsvState] = useState<Hsv>(() => hexToHsv(hex));
  useEffect(() => {
    if (hsvToHex(hsv) !== hex) setHsvState(hexToHsv(hex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  const setHsv = (next: Hsv) => {
    setHsvState(next);
    const h = hsvToHex(next);
    if (h !== hex) onChange(h);
  };
  const setHex = (h: string) => {
    setHsvState(hexToHsv(h));
    if (h !== hex) onChange(h);
  };

  const area = useDrag((x, y) => setHsv({ ...hsv, s: x * 100, v: (1 - y) * 100 }));
  const hue = useDrag((x) => setHsv({ ...hsv, h: Math.min(x * 360, 359.999) }));
  const rgb = hexToRgb(hex);
  const pure = hsvToHex({ h: hsv.h, s: 100, v: 100 });

  return (
    <div className="color-editor" onPointerDown={(e) => e.stopPropagation()}>
      <div className="color-area" style={{ background: pure }} {...area}>
        <div className="color-area-white" />
        <div className="color-area-black" />
        <span className="color-thumb" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hex }} />
      </div>
      <div className="color-hue" {...hue}>
        <span className="color-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: pure }} />
      </div>

      <div className="color-fields">
        <span className="color-preview" style={{ background: hex }} />
        <label className="color-field hex">
          <span>HEX</span>
          <HexInput value={hex} onCommit={setHex} />
        </label>
      </div>
      <div className="color-fields">
        <span className="color-fields-label">RGB</span>
        <NumField label="R" value={rgb.r} max={255} onCommit={(r) => setHex(rgbToHex({ ...rgb, r }))} />
        <NumField label="G" value={rgb.g} max={255} onCommit={(g) => setHex(rgbToHex({ ...rgb, g }))} />
        <NumField label="B" value={rgb.b} max={255} onCommit={(b) => setHex(rgbToHex({ ...rgb, b }))} />
      </div>
      <div className="color-fields">
        <span className="color-fields-label">HSV</span>
        <NumField label="H" value={hsv.h} max={360} suffix="°" onCommit={(h) => setHsv({ ...hsv, h: h % 360 })} />
        <NumField label="S" value={hsv.s} max={100} suffix="%" onCommit={(s) => setHsv({ ...hsv, s })} />
        <NumField label="V" value={hsv.v} max={100} suffix="%" onCommit={(v) => setHsv({ ...hsv, v })} />
      </div>

      <Favorites hex={hex} onPick={setHex} />
    </div>
  );
}

function stopEnter(e: React.KeyboardEvent<HTMLInputElement>, commit: () => void) {
  if (e.key === "Enter") {
    // Don't submit an enclosing form (e.g. the project dialog).
    e.preventDefault();
    commit();
  }
}

function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const commit = () => {
    const h = normalizeHex(draft);
    if (h) onCommit(h);
    else setDraft(value);
  };
  return (
    <input
      value={focused ? draft : value}
      spellCheck={false}
      maxLength={7}
      className={cx(focused && !normalizeHex(draft) && "invalid")}
      onFocus={(e) => {
        setFocused(true);
        setDraft(value);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        // Apply as soon as the text is a full color, so the preview follows typing.
        const h = e.target.value.replace(/^#/, "").length === 6 ? normalizeHex(e.target.value) : null;
        if (h) onCommit(h);
      }}
      onBlur={() => {
        commit();
        setFocused(false);
      }}
      onKeyDown={(e) => stopEnter(e, commit)}
    />
  );
}

function NumField({
  label,
  value,
  max,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  onCommit: (n: number) => void;
}) {
  const shown = String(Math.round(value));
  const [draft, setDraft] = useState<string | null>(null);
  const apply = (text: string) => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) onCommit(Math.min(max, Math.max(0, n)));
  };
  return (
    <label className="color-field" title={suffix ? `${label} (0–${max}${suffix})` : `${label} (0–${max})`}>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={draft ?? shown}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          apply(e.target.value);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => stopEnter(e, () => setDraft(null))}
      />
    </label>
  );
}

// ---------------------------------------------------------------- favorites

function Favorites({ hex, onPick }: { hex: string; onPick: (hex: string) => void }) {
  const favorites = useStore((s) => s.config.favoriteColors);
  const [naming, setNaming] = useState<string | null>(null);
  const save = () => {
    if (naming === null) return;
    addFavoriteColor(naming, hex);
    setNaming(null);
  };

  return (
    <div className="color-favorites">
      <div className="color-favorites-head">
        <span>Favorites</span>
        {naming === null && (
          <button type="button" className="btn ghost small" onClick={() => setNaming("")}>
            <Star size={13} /> Save color
          </button>
        )}
      </div>
      {naming !== null && (
        <div className="input-row">
          <span className="color-preview small" style={{ background: hex }} />
          <input
            autoFocus
            placeholder={`Name (optional, e.g. “Brand blue”)`}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              stopEnter(e, save);
              if (e.key === "Escape") {
                e.stopPropagation();
                setNaming(null);
              }
            }}
          />
          <button type="button" className="btn primary small" onClick={save}>
            Save
          </button>
          <button type="button" className="icon-btn small" onClick={() => setNaming(null)} title="Cancel">
            <X size={14} />
          </button>
        </div>
      )}
      {favorites.length === 0 && naming === null ? (
        <p className="faint small">Save colors you use often; they appear next to the presets everywhere.</p>
      ) : (
        <div className="color-favorites-list">
          {favorites.map((f) => (
            <FavoriteRow key={f.id} fav={f} selected={f.hex === hex} onPick={() => onPick(f.hex)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FavoriteRow({ fav, selected, onPick }: { fav: FavoriteColor; selected: boolean; onPick: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const commit = () => {
    if (renaming !== null && renaming.trim() !== fav.name) renameFavoriteColor(fav.id, renaming);
    setRenaming(null);
  };

  return (
    <div className={cx("color-fav", selected && "selected")}>
      <button type="button" className="color-fav-pick" onClick={onPick} title={`Use ${fav.hex}`}>
        <span className="color-preview small" style={{ background: fav.hex }} />
        {renaming === null && (
          <>
            <span className="color-fav-name">{fav.name}</span>
            <span className="color-fav-hex mono">{fav.hex}</span>
          </>
        )}
      </button>
      {renaming !== null ? (
        <input
          autoFocus
          className="color-fav-input"
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            stopEnter(e, commit);
            if (e.key === "Escape") {
              e.stopPropagation();
              setRenaming(null);
            }
          }}
        />
      ) : (
        <>
          <button type="button" className="icon-btn tiny" onClick={() => setRenaming(fav.name)} title="Rename">
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className="icon-btn tiny danger"
            onClick={() => removeFavoriteColor(fav.id)}
            title="Remove from favorites"
          >
            <Trash2 size={12} />
          </button>
        </>
      )}
    </div>
  );
}
