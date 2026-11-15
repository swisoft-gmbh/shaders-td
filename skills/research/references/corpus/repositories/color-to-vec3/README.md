# Color to vec3

A Raycast extension to convert CSS colors into normalized `vec3` values for GLSL and WGSL shader code.

Examples:

- `#ff8000` → `vec3(1.0, 0.502, 0.0)`
- `rgb(50% 25% 0%)` → `vec3(0.502, 0.251, 0.0)`
- `hsl(280 100% 70%)` → `vec3(0.8, 0.4, 1.0)`
- `oklch(62.8% 0.2577 29.23)` → `vec3(1.0, 0.0, 0.0)`
- `rebeccapurple` → `vec3(0.4, 0.2, 0.6)`

The parser is dependency-free and supports hex colors, legacy and modern
`rgb()`/`rgba()` and `hsl()`/`hsla()` syntax, `hwb()`, `oklch()`, and CSS named colors.
Alpha channels are validated but ignored because a `vec3` has no alpha channel.

The form also integrates with the open-source Raycast Color Picker extension.
The **Pick Color** action opens its system picker and receives the selected hex
color back through Raycast's cross-extension callback convention.
