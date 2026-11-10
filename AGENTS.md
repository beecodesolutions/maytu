# Español de Maytu

- Escribe todos los textos dirigidos al usuario en español neutro. Usa el tuteo (tú) y evita el voseo (vos) y los regionalismos. Aplica esta regla a la interfaz y a los mensajes de validación y error de la API.

# MUI theme and visual styles

- Define all visual styling in `ui/src/app/theme.ts` and `ui/src/app/theme/`. Both light and dark themes must use the same shared definitions; keep palette values mode-specific where needed.
- Components select semantic MUI `variant`, `color` and `size` values, and reference shared `uiStyles` / `uiProps` from the theme. Do not define inline `sx`, `style`, local style objects, raw colors, font sizes/families/weights, spacing, dimensions, borders or state styling inside components. This includes slot props, charts and illustrations. SVG paths and viewBox geometry remain in the asset.
- Every text role has a named typography variant with an explicit font family and size in `theme/typography.ts`. Use editorial serif for prominent headings/branding; use sans-serif and tabular numerals for metrics, money and operational data. Never override typography locally to make a heading variant serve as a metric.
- Reuse existing theme styles first. If a role is missing, add a semantic variant, component override or shared named style to the theme instead of duplicating a component-specific definition. Parameterized theme styles accept only the state/data they need.
- Keep hover, focus, selected and disabled states in the theme. Preserve keyboard focus and check contrast in both modes, including hover states.
- After theme changes, run UI typecheck, lint and relevant tests. Keep `themeArchitecture.test.ts` enforcing the boundary; do not weaken it to permit local styles. Visually verify affected desktop/mobile layouts when browser tooling is available.
