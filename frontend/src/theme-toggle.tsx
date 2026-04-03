import type { ThemePreference } from "./theme-context";
import { useTheme } from "./theme-context";
import { classNames } from "./utils";

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle({ className, id }: { className?: string; id?: string }) {
  const { themePreference, setThemePreference } = useTheme();
  const groupId = id ?? "theme-toggle";

  return (
    <div className={classNames("theme-toggle", className)} role="group" aria-labelledby={`${groupId}-label`}>
      <p className="theme-toggle-label" id={`${groupId}-label`}>
        Appearance
      </p>
      <div className="theme-toggle-segments">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={classNames("theme-toggle-btn", themePreference === option.value && "theme-toggle-btn--active")}
            aria-pressed={themePreference === option.value}
            onClick={() => setThemePreference(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
