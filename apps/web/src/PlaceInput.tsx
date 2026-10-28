import { useEffect, useRef, useState } from "react";
import type { Gazetteer, GazPlace } from "@ghmap/core";
import { geocodeGhana, type OnlineResult } from "./geocode.ts";

interface Props {
  gazetteer: Gazetteer;
  value: string | null;
  placeholder: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onUseMyLocation?: () => void;
  saved?: string[];
  recent?: string[];
  onToggleSaved?: (id: string) => void;
  /** Register an online (Nominatim) result as a selectable place; returns its id. */
  registerOnline?: (r: OnlineResult) => string;
}

/** A search box with live suggestions, recent searches, and saved places. */
export function PlaceInput({
  gazetteer,
  value,
  placeholder,
  onSelect,
  onClear,
  onUseMyLocation,
  saved = [],
  recent = [],
  onToggleSaved,
  registerOnline,
}: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [online, setOnline] = useState<OnlineResult[]>([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) setText(gazetteer.get(value)?.name ?? "");
    else setText("");
  }, [value, gazetteer]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Debounced live OpenStreetMap search for anything not in the local dataset.
  useEffect(() => {
    if (!open || !registerOnline) {
      setOnline([]);
      return;
    }
    const q = text.trim();
    if (q.length < 3) {
      setOnline([]);
      return;
    }
    const ctl = new AbortController();
    setSearching(true);
    const t = window.setTimeout(async () => {
      const r = await geocodeGhana(q, ctl.signal);
      setOnline(r);
      setSearching(false);
    }, 450);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [text, open, registerOnline]);

  const typing = text.trim().length > 0;
  const suggestions: GazPlace[] = open
    ? typing
      ? gazetteer.search(text, 7)
      : [...recent, ...saved]
          .filter((id, i, a) => a.indexOf(id) === i)
          .map((id) => gazetteer.get(id))
          .filter((p): p is GazPlace => !!p)
          .slice(0, 8)
    : [];

  function choose(place: GazPlace) {
    onSelect(place.id);
    setText(place.name);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[highlight];
      if (pick) choose(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showRecentHeader = open && !typing && suggestions.length > 0;

  return (
    <div className="place-input" ref={boxRef}>
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHighlight(0);
          if (!e.target.value && onClear) onClear();
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {value && onClear ? (
        <button
          className="clear"
          title="Clear"
          onClick={() => {
            setText("");
            onClear();
          }}
        >
          ×
        </button>
      ) : null}

      {open && (suggestions.length > 0 || onUseMyLocation || online.length > 0 || (typing && searching)) ? (
        <ul className="suggestions">
          {onUseMyLocation ? (
            <li
              className="suggestion mylocation"
              onMouseDown={() => {
                onUseMyLocation();
                setOpen(false);
              }}
            >
              <span className="dot">◎</span> Use my location
            </li>
          ) : null}
          {showRecentHeader ? <li className="sug-head">Recent &amp; saved</li> : null}
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              className={`suggestion ${i === highlight ? "active" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={() => choose(s)}
            >
              <span className="name">
                {saved.includes(s.id) ? "★ " : ""}
                {s.name}
              </span>
              <span className="region">{s.region ?? s.kind}</span>
              {onToggleSaved ? (
                <button
                  className="star"
                  title={saved.includes(s.id) ? "Unsave" : "Save"}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleSaved(s.id);
                  }}
                >
                  {saved.includes(s.id) ? "★" : "☆"}
                </button>
              ) : null}
            </li>
          ))}

          {typing && registerOnline ? (
            <>
              <li className="sug-head">
                Found online {searching ? "…" : online.length === 0 ? "— nothing in OpenStreetMap" : ""}
              </li>
              {online.map((r, i) => (
                <li
                  key={`on-${i}`}
                  className="suggestion online"
                  onMouseDown={() => {
                    const id = registerOnline(r);
                    onSelect(id);
                    setText(r.name);
                    setOpen(false);
                  }}
                >
                  <span className="name">🌐 {r.name}</span>
                  <span className="region">{r.region}</span>
                </li>
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
