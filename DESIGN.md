---
name: SWM Structured
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1b1c1c'
  surface-container: '#1f2020'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e4e2e1'
  on-surface-variant: '#c6c6d0'
  inverse-surface: '#e4e2e1'
  inverse-on-surface: '#303030'
  outline: '#90909a'
  outline-variant: '#45464f'
  surface-tint: '#b8c4f9'
  primary: '#b8c4f9'
  on-primary: '#212e59'
  primary-container: '#010f3b'
  on-primary-container: '#707cac'
  inverse-primary: '#505c8a'
  secondary: '#dec664'
  on-secondary: '#3a3000'
  secondary-container: '#726000'
  on-secondary-container: '#f5dc78'
  tertiary: '#bec5eb'
  on-tertiary: '#272f4d'
  tertiary-container: '#09112f'
  on-tertiary-container: '#757ca0'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b8c4f9'
  on-primary-fixed: '#091843'
  on-primary-fixed-variant: '#384571'
  secondary-fixed: '#fce27d'
  secondary-fixed-dim: '#dec664'
  on-secondary-fixed: '#221b00'
  on-secondary-fixed-variant: '#544600'
  tertiary-fixed: '#dde1ff'
  tertiary-fixed-dim: '#bec5eb'
  on-tertiary-fixed: '#121a37'
  on-tertiary-fixed-variant: '#3e4565'
  background: '#131313'
  on-background: '#e4e2e1'
  surface-variant: '#353535'
typography:
  headline-xl:
    fontFamily: DM Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: DM Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-md:
    fontFamily: DM Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: DM Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-lg:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
  label-md:
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
  headline-lg-mobile:
    fontFamily: DM Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.2'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 24px
  margin: 32px
---

## Brand & Style

This design system is built for a highly technical ecosystem where precision meets playfulness. It draws heavily from **Brutalism** and **Tactile Modernism**, prioritizing physical depth and structural integrity. The interface should feel like a series of tangible plates or blocks stacked in a digital space. 

The target audience consists of developers, designers, and tech-savvy professionals who value clarity and a distinct architectural identity. The UI evokes a sense of "engineered fun"—it is robust and reliable, yet utilizes high-contrast accents and aggressive offsets to maintain a high-energy, modern aesthetic. Key traits include heavy solid borders, sharp corners, and deep isometric-style shadow offsets that simulate physical thickness.

## Colors

The palette is anchored by a **Deep Navy (#010f3b)**, providing a sophisticated, low-fatigue backdrop for technical environments. 

- **Primary Surfaces:** Deep Navy is used for global backgrounds and container surfaces.
- **Vibrant Accents:** The **Yellow (#ffe580)** is used sparingly for primary actions and highlighted "internship" or "featured" modules. Green and Purple serve as functional accents for secondary categories or status indicators.
- **High Contrast:** White (#FFFFFF) is reserved for high-priority typography and icons, while the light lavender tint (#c7cef5) provides a softer alternative for secondary text and borders.
- **Deep Shadows:** Deep, dark offsets use #000000 or a darkened version of the navy to ensure the "layered" effect remains grounded and high-contrast.

## Typography

The typography system relies almost exclusively on **DM Sans**, a geometric sans-serif that balances modern clean lines with a slight technical "boxy" feel that complements the UI shapes.

- **Headlines:** Use heavy weights (700) with tight letter-spacing for a bold, impactful presence.
- **Body Text:** Standard body text uses regular weights (400) with generous line heights to ensure readability against the dark navy backgrounds.
- **Labels:** Meta-information and category headers (like "HR" or "PROJECT MANAGEMENT") are set in bold, uppercase DM Sans with increased letter-spacing to create clear sectional hierarchy.
- **Scale:** On mobile, large display text scales down significantly to fit within the constrained width of inset cards.

## Layout & Spacing

This design system employs a **fixed-width container** for desktop (max-width 1280px) and a **fluid grid** for mobile. The layout is built on an 8px base grid, ensuring all components, paddings, and margins are multiples of 8.

- **Grid:** A 12-column grid is used for desktop, collapsing to 4 columns on mobile devices.
- **Gutter & Margins:** Gutters are fixed at 24px. Page margins start at 32px on desktop and reduce to 16px on mobile.
- **Rhythm:** Vertical spacing between cards and sections is aggressive (48px to 80px) to allow the "shadow offsets" breathing room without visually colliding with other elements.

## Elevation & Depth

Depth is not communicated through soft, atmospheric shadows, but through **hard-edged physical offsets**. This creates a "slab" aesthetic.

- **Card Layers:** Every card consists of a foreground plate and a background "shadow" plate. The shadow plate is actually a solid fill (often #FFFFFF or #000000 at low opacity) offset by 6px to 10px on both the X and Y axes.
- **Inset Effects:** Interactive elements may "sink" on press by reducing the offset distance, simulating a button being pushed into a surface.
- **Borders:** All primary containers feature a thick, solid 2px border. This border defines the perimeter of the "plate" before the shadow offset begins.
- **Background Sections:** Large background blocks of color (like the light blue or purple seen in the reference) act as the lowest layer, while navy cards sit on top of them.

## Shapes

The shape language is strictly **geometric and boxy**. 

- **Corners:** A minimal rounding of 4px-8px is applied to all cards and buttons to prevent the UI from feeling sharp and hostile, while maintaining a predominantly "square" silhouette.
- **Buttons:** Follow the same logic as cards—rectangular with slight rounding. Circular buttons are reserved exclusively for icon-only actions (like the arrow navigation buttons).
- **Physicality:** The "thickness" of a shape is always visible via the offset, reinforcing the idea that every UI element has a physical Z-axis dimension.

## Components

- **Cards:** The signature component. They must have a 2px solid border and a solid-fill offset shadow (usually 8px right, 8px down). Content should have generous internal padding (min 24px).
- **Buttons:** 
  - *Primary:* Solid black background with white text, 8px rounding, and a small 4px offset shadow.
  - *Iconic:* Circular buttons with a light blue background and a subtle inset border, used for navigation.
- **Inputs:** High-contrast borders (2px) with sharp corners. The focus state should utilize the accent yellow for the border color.
- **Accordions:** Clean horizontal dividers (1px) with DM Sans typography. Expansion should feel like a physical sliding down of the "plate" below it.
- **Chips/Badges:** Small, pill-shaped or slightly rounded rectangles used for categories. Use the secondary colors (Yellow, Green, Purple) for background fills with high-contrast text.
- **Newsletter Card:** A specialized large-format card using the #ffe580 background to draw immediate attention.