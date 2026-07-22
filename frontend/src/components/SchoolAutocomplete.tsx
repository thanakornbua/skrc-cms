import { useEffect, useMemo, useRef, useState } from "react";

const MAX_SUGGESTIONS = 8;

let schoolsPromise: Promise<string[]> | null = null;
function loadSchools(): Promise<string[]> {
  if (!schoolsPromise) {
    schoolsPromise = fetch("/schools.json")
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => []);
  }
  return schoolsPromise;
}

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  lang?: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export default function SchoolAutocomplete({ id, value, onChange, required, lang, ...aria }: Props) {
  const [schools, setSchools] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = `${id}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Loaded eagerly but off the critical path — the field stays usable as
    // plain free text before this resolves.
    loadSchools().then(setSchools);
  }, []);

  const suggestions = useMemo(() => {
    const query = value.trim();
    if (!schools || !query) return [];
    return schools.filter((name) => name.includes(query)).slice(0, MAX_SUGGESTIONS);
  }, [schools, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestions]);

  useEffect(() => {
    function onOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  function select(name: string) {
    onChange(name);
    setOpen(false);
  }

  return (
    <div className="combobox" ref={containerRef}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        required={required}
        lang={lang}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            select(suggestions[activeIndex]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        {...aria}
      />
      {open && suggestions.length > 0 && (
        <ul className="combobox-list" id={listboxId} role="listbox">
          {suggestions.map((name, index) => (
            <li
              key={name}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                select(name);
              }}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
