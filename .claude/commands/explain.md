---
description: Generate visual explanations of code - ASCII diagrams, HTML presentations, architecture walkthroughs
argument-hint: "[file, feature, or concept to explain]"
---

Generate a visual explanation of: $ARGUMENTS

## Approach

Choose the best format based on what's being explained:

### For Architecture / Data Flow
Draw an ASCII diagram showing how components connect:
```
[Component A] --props--> [Component B]
       |                       |
       v                       v
  [Zustand Store]        [API Service]
       |                       |
       +--------> [Server] <---+
```

### For Complex Features
Generate an HTML presentation file at `/tmp/explain-[topic].html`:
- Clean dark theme matching Spectre's design (bg: #09090b, text: #f5f5f7)
- Slide-based layout with keyboard navigation (arrow keys)
- Code snippets with syntax highlighting
- Diagrams using CSS/SVG (no external dependencies)
- Save to `/tmp/` and tell the user to open in browser

### For Code Flow / Logic
Trace the execution path step by step:
1. Entry point (which file, which function)
2. Each function call in order with file:line
3. Data transformations at each step
4. Side effects (API calls, state updates, DOM changes)
5. Exit / return value

### For API / Protocol
Show request/response cycle:
```
Browser                    Server                    External API
   |                         |                           |
   |-- GET /api/tokens ----->|                           |
   |                         |-- GraphQL query --------->|
   |                         |<-- { data: [...] } -------|
   |<-- 200 JSON ------------|                           |
```

## Guidelines
- Always explain the WHY, not just the what
- Use the codebase's actual file names and function names
- Read the relevant source files first - never guess at implementation
- For Spectre-specific code, reference the knowledge graph in `.claude/skills/spectre-graph/`
- Keep diagrams readable - max 80 chars wide for terminal display
