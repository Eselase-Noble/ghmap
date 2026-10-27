import { useEffect, useRef, useState } from "react";
import { searchPlaces, type Graph, type PlaceNode } from "@ghmap/core";

interface Props {
  graph: Graph;
  value: string | null;
  placeholder: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  /** Optional "use my location" affordance shown at the top of the dropdown. */
  onUseMyLocation?: () => void;
}

/** A search box with live place suggestions, backed by @ghmap/core search. */
export function PlaceInput({
  graph,
  value,
  placeholder,
  onSelect,
  onClear,
  onUseMyLocation,
}: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Reflect the externally selected value as the input text.
  useEffect(() => {
    if (value) setText(graph.getNode(value)?.name ?? "");
    else setText("");
  }, [value, graph]);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const suggestions: PlaceNode[] = open && text.trim() ? searchPlaces(graph, text, 7) : [];

  function choose(node: PlaceNode) {
    onSelect(node.id);
    setText(node.name);
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

      {open && (suggestions.length > 0 || onUseMyLocation) ? (
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
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              className={`suggestion ${i === highlight ? "active" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={() => choose(s)}
            >
              <span className="name">{s.name}</span>
              <span className="region">{s.region}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
