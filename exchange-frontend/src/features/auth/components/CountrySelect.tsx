import type { ChangeEvent } from "react";
import { countryOptions, type CountryOption } from "../data/countries";

type CountrySelectProps = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
};

const CountrySelect = ({ value, onChange, disabled, required, name, id, className = "" }: CountrySelectProps) => {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className="relative">
      <select
        id={id}
        name={name}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        required={required}
        className={`w-full appearance-none rounded-xl border border-slate-500/40 bg-slate-900/80 px-3 py-2 text-sm text-white shadow-sm outline-none transition focus:border-slate-400/70 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        style={{ backgroundColor: "rgba(15,23,42,0.85)", color: "#f8fafc" }}
      >
        <option value="" disabled style={{ backgroundColor: "#0f172a", color: "#cbd5f5" }}>
          Select country
        </option>
        {countryOptions.map((option: CountryOption) => (
          <option
            key={option.code}
            value={option.code}
            style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
          >
            {option.flag} {option.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
        v
      </span>
    </div>
  );
};

export default CountrySelect;
