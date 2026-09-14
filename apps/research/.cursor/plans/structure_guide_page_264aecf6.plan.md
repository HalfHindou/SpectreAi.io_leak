---
name: Structure Guide Page
overview: Create a new Structure Guide page that visually presents the app architecture, showing the welcome widget components (Fear & Greed, Alt Season, Market Dominance), top toggles (Crypto/Stocks), and screener functionality to help the team understand the build structure.
todos:
  - id: create-structure-guide-component
    content: "Create StructureGuidePage.jsx component with three main sections: Welcome Widget Components, Top Toggles, and Screener Flow"
    status: completed
  - id: create-structure-guide-styles
    content: Create StructureGuidePage.css with styling matching the app design system
    status: completed
  - id: add-navigation-item
    content: Add 'Structure Guide' navigation item to NavigationSidebar.jsx with appropriate icon
    status: completed
  - id: integrate-page-routing
    content: Update App.jsx to handle structure-guide page routing and rendering
    status: completed
  - id: create-component-previews
    content: Create visual preview cards for Fear & Greed, Alt Season, and Market Dominance components
    status: completed
  - id: create-flow-diagrams
    content: Create visual flow diagrams showing navigation paths and component relationships
    status: completed
isProject: false
---

# Structure Guide Page

Create a new page component that visually documents the app structure for the development team.

## Components to Create

### 1. StructureGuidePage Component

- **File**: `src/components/StructureGuidePage.jsx` and `src/components/StructureGuidePage.css`
- New page component showing:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Visual previews of welcome widget components
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Step-by-step descriptions
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Component hierarchy and relationships
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Navigation flow

### 2. Page Structure

The guide will have three main sections:

#### Section 1: Welcome Widget Structure

- Visual preview cards showing:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - **Fear & Greed Index** (compact design)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - **Alt Season Index** (compact design)  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - **Market Dominance Layer** (BTC, ETH, SOL, Alts)
- Each card shows:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Component name
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Visual preview (styled mockup)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Description of functionality
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Data sources/API integration points

#### Section 2: Top Toggles & Navigation

- Visual representation of:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - **Crypto/Stocks Toggle** (header market mode switcher)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Location: Header component
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Functionality: Switches between crypto and stocks market data
- Visual preview of header with toggle highlighted

#### Section 3: Screener Flow

- Visual flow showing:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - **SCREENER Button** in header
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Navigation to token detail view
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Screener functionality in token view
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Data tabs and filtering capabilities
- Step-by-step flow diagram

## Implementation Details

### StructureGuidePage Component Structure

```jsx
// Main sections:
1. Header with title "Build Structure Guide"
2. Welcome Widget Components section
   - Fear & Greed card preview
   - Alt Season card preview  
   - Market Dominance preview
3. Top Toggles section
   - Crypto/Stocks toggle explanation
4. Screener Flow section
   - Navigation flow diagram
5. Component Hierarchy tree
```

### Visual Elements

- **Component Preview Cards**: Mini versions of actual components with labels
- **Flow Diagrams**: Mermaid or visual flow showing navigation paths
- **Code References**: Links to actual component files
- **Status Indicators**: Show what's implemented vs. planned

### Integration

- Add new navigation item in `NavigationSidebar.jsx`:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - ID: `'structure-guide'`
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Label: 'Structure Guide'
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Icon: Documentation/guide icon

- Update `App.jsx` to handle the new page:
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Add conditional rendering for `currentPage === 'structure-guide'`
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Render `StructureGuidePage` component

### Styling

- Match existing design system (Apple-inspired, dark theme)
- Use same color scheme and typography
- Responsive layout
- Visual hierarchy with clear sections

## Files to Modify

1. **Create**: `src/components/StructureGuidePage.jsx`
2. **Create**: `src/components/StructureGuidePage.css`
3. **Modify**: `src/components/NavigationSidebar.jsx` - Add navigation item
4. **Modify**: `src/App.jsx` - Add page routing logic

## Visual Guide Content

### Welcome Widget Components

- Show actual component structure with labels
- Explain data flow and state management
- Show API integration points

### Top Toggles

- Explain market mode switching
- Show how it affects data display
- Visual highlight of toggle location

### Screener

- Show complete flow from button click to token view
- Explain filtering and data display
- Show integration with DataTabs component