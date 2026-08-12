"use client";

import { useState, useRef, useEffect } from "react";
import { Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TagMultiSelectProps {
  value: string[];
  onChange: (tags: string[]) => void;
  available: string[];
  disabled?: boolean;
  placeholder?: string;
}

export function TagMultiSelect({
  value,
  onChange,
  available,
  disabled,
  placeholder = "Search tags…",
}: TagMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = available.filter(
    (t) => !value.includes(t) && t.toLowerCase().includes(query.toLowerCase())
  );

  function add(tag: string) {
    onChange([...value, tag]);
    setQuery("");
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="space-y-1.5">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              <Tag className="h-3 w-3 shrink-0" />
              {tag}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(tag)}
                  className="ml-0.5 hover:text-destructive"
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      {!disabled && (
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={value.length === 0 ? placeholder : "Add another tag…"}
            className="h-8 text-sm"
          />
          {open && suggestions.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(t);
                    setOpen(false);
                  }}
                >
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  {t}
                </button>
              ))}
            </div>
          )}
          {open && query.length > 0 && suggestions.length === 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
              <p className="px-3 py-2 text-sm text-muted-foreground">No matching tags.</p>
            </div>
          )}
        </div>
      )}

      {disabled && value.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No tags</p>
      )}
    </div>
  );
}
