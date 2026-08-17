import type { KeyboardEvent } from "react";
import { COMPETITOR_ID_PREFIX, competitorIdDigits } from "../competitorId";

interface Props {
  id: string;
  label: string;
  /** Digits only — the `C-` is rendered as an affix, never held in the value. */
  value: string;
  onChange: (digits: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * A competitor number field with a fixed `C-` affix, so operators type digits
 * only. Everything entered is filtered through `competitorIdDigits`, which is
 * what makes a badge scan safe: the scanner types the full `C-0042`, the `C-`
 * is stripped, and the field ends up holding `0042` rather than `C-C-0042`.
 */
export default function CompetitorIdInput({
  id, label, value, onChange, onEnter, placeholder = "0042", autoFocus, inputRef,
}: Props) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="competitor-id-input">
        <span className="competitor-id-affix technical" aria-hidden="true">{COMPETITOR_ID_PREFIX}</span>
        <input
          id={id}
          ref={inputRef}
          className="technical"
          value={value}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(event) => onChange(competitorIdDigits(event.target.value))}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter" && onEnter) { event.preventDefault(); onEnter(); }
          }}
        />
      </div>
    </div>
  );
}
