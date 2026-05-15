# FX Editor Cards Scroll Bugfix Design

## Overview

The bug occurs when users add multiple overlay objects in the FX editor's "ОБЪЕКТЫ" tab. The object cards list (`.fxe-ov-list`) cannot be scrolled because the parent container (`.fxe-ov-left`) lacks proper height constraints in the CSS flex layout. While `.fxe-ov-list` has `overflow-y:auto`, `flex:1`, and `min-height:0`, the parent `.fxe-ov-left` is missing the critical `min-height:0` property that enables flex children to shrink below their content size. This prevents the scrollbar from activating when cards exceed the visible area.

The fix involves adding `min-height:0` to `.fxe-ov-left` to establish proper flex constraints, allowing the child `.fxe-ov-list` to activate scrolling when content overflows.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when the object cards list cannot be scrolled despite having overflow-y:auto
- **Property (P)**: The desired behavior - the cards list should automatically activate vertical scrolling when cards exceed the visible area
- **Preservation**: Existing card interactions (collapse, edit, delete, z-order) and object management functionality that must remain unchanged
- **`.fxe-ov-list`**: The scrollable container in `FxEditor.js` that holds the object cards (already has `flex:1`, `overflow-y:auto`, `min-height:0`)
- **`.fxe-ov-left`**: The parent container of `.fxe-ov-list` that currently lacks `min-height:0`, preventing proper flex shrinking
- **`.fxe-ov-content`**: The grandparent flex container that has `flex:1` and `overflow:hidden`
- **`.fxe-ov-panel`**: The root panel container with `flex:1`, `display:flex`, `flex-direction:column`, `overflow:hidden`

## Bug Details

### Bug Condition

The bug manifests when a user adds multiple overlay objects to the FX editor and the total height of the object cards exceeds the visible area of the `.fxe-ov-list` container. The scrollbar does not activate because the parent container `.fxe-ov-left` does not have the `min-height:0` CSS property, which is required in flexbox layouts to allow flex children to shrink below their content size.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UIState
  OUTPUT: boolean
  
  RETURN input.objectCardsCount > 0
         AND input.totalCardsHeight > input.visibleAreaHeight
         AND NOT input.scrollbarActivated
         AND input.parentContainer === '.fxe-ov-left'
         AND NOT input.parentHasMinHeight0
END FUNCTION
```

### Examples

- User adds 5 overlay objects → cards stack vertically → total height exceeds 600px → scrollbar does not appear → bottom cards are inaccessible
- User adds 10 text overlays → cards overflow the visible area → user cannot scroll to access hidden cards → cannot edit or delete bottom cards
- User adds 3 large image objects with expanded settings → cards take up more space than available → no scrolling possible → user must collapse cards to access others
- Edge case: User adds 1-2 objects that fit in visible area → no scrollbar needed → display works correctly (expected behavior)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Card interactions (collapse/expand, edit parameters, delete) must continue to work exactly as before
- Adding new objects or text elements must continue to create new cards and display them in the list
- Tab switching between "ТЕКСТ" and "ОБЪЕКТЫ" must continue to preserve card states (collapsed/expanded)
- Z-order buttons (⬆/⬇) must continue to correctly move objects in the list
- Object parameter changes (position, size, effects, layer) must continue to update the preview panel
- When cards fit in visible area without scrolling, no scrollbar should appear

**Scope:**
All inputs that do NOT involve the vertical scrolling of the cards list should be completely unaffected by this fix. This includes:
- Mouse clicks on card controls (collapse, delete, z-order buttons)
- Editing object parameters (position, size, opacity, effects)
- Preview canvas rendering on the right panel
- Adding new objects via the toolbar buttons

## Hypothesized Root Cause

Based on the bug description and CSS analysis, the most likely issue is:

1. **Missing min-height:0 on Parent Container**: The `.fxe-ov-left` container has `display:flex`, `flex-direction:column`, and `overflow:hidden`, but lacks `min-height:0`. In CSS flexbox, flex children default to `min-height:auto`, which prevents them from shrinking below their content size. Without `min-height:0` on the parent, the child `.fxe-ov-list` cannot establish a constrained height context, so `overflow-y:auto` never triggers.

2. **Flex Layout Chain Issue**: The flex hierarchy is `.fxe-ov-panel` (flex:1) → `.fxe-ov-content` (flex:1) → `.fxe-ov-left` (no flex, fixed width) → `.fxe-ov-list` (flex:1). The `.fxe-ov-left` already has `overflow:hidden` and `min-height:0` according to the current code, but this may not be sufficient if the parent chain doesn't properly constrain height.

3. **Incorrect CSS Specificity or Override**: There may be a CSS rule with higher specificity that overrides the `min-height:0` property on `.fxe-ov-left` or `.fxe-ov-list`.

4. **Browser Rendering Bug**: Different browsers may handle nested flex containers differently, causing inconsistent scrolling behavior.

## Correctness Properties

Property 1: Bug Condition - Scrollbar Activation for Overflow

_For any_ UI state where the total height of object cards exceeds the visible area height of the `.fxe-ov-list` container, the fixed CSS SHALL activate the vertical scrollbar, allowing the user to scroll through all cards and access every card for editing or deletion.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Card Interaction Behavior

_For any_ user interaction that does NOT involve vertical scrolling (card collapse, parameter editing, deletion, z-order changes, adding objects), the fixed CSS SHALL produce exactly the same behavior as the original code, preserving all existing card management functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `FxEditor.js`

**Location**: CSS section within the `<style>` tag (around line 1097-1101)

**Specific Changes**:
1. **Verify min-height:0 on .fxe-ov-left**: Confirm that `.fxe-ov-left` has `min-height:0` in its CSS rule. According to the grep results, it already has this property (line 1101), so the issue may be elsewhere.

2. **Add min-height:0 to .fxe-ov-content**: The parent container `.fxe-ov-content` may need `min-height:0` to properly constrain the flex chain. Current CSS shows `flex:1;display:flex;gap:0;overflow:hidden;` but no `min-height:0`.

3. **Verify .fxe-ov-panel has proper flex constraints**: Ensure `.fxe-ov-panel` has `min-height:0` or that its parent containers properly constrain height.

4. **Test with explicit height constraints**: If adding `min-height:0` doesn't work, try adding explicit `height:0` to `.fxe-ov-left` or `.fxe-ov-content` to force flex shrinking.

5. **Check for CSS specificity issues**: Verify no other CSS rules are overriding the flex properties with higher specificity.

**Most Likely Fix**:
Add `min-height:0;` to the `.fxe-ov-content` CSS rule:
```css
.fxe-ov-content {
  flex:1;display:flex;gap:0;overflow:hidden;min-height:0;
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Manually test the FX editor by adding multiple overlay objects and observing whether the scrollbar activates. Use browser DevTools to inspect the computed CSS properties of `.fxe-ov-list`, `.fxe-ov-left`, and `.fxe-ov-content`. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **5 Objects Test**: Add 5 overlay objects → observe that cards overflow visible area → verify scrollbar does NOT activate (will fail on unfixed code)
2. **10 Objects Test**: Add 10 overlay objects → observe that many cards are hidden → verify user cannot scroll to access them (will fail on unfixed code)
3. **Expanded Cards Test**: Add 3 objects and expand all settings → observe that expanded cards take more space → verify scrollbar does NOT activate (will fail on unfixed code)
4. **DevTools Inspection**: Use browser DevTools to inspect `.fxe-ov-left` and `.fxe-ov-content` → verify which container lacks `min-height:0` → confirm root cause hypothesis

**Expected Counterexamples**:
- Scrollbar does not appear when cards overflow the visible area
- User cannot access cards beyond the visible area
- Possible causes: missing `min-height:0` on `.fxe-ov-content`, CSS specificity override, incorrect flex chain

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed CSS produces the expected behavior.

**Pseudocode:**
```
FOR ALL uiState WHERE isBugCondition(uiState) DO
  result := renderCardsWithFixedCSS(uiState)
  ASSERT scrollbarActivated(result)
  ASSERT allCardsAccessible(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed CSS produces the same result as the original CSS.

**Pseudocode:**
```
FOR ALL interaction WHERE NOT isScrollInteraction(interaction) DO
  ASSERT handleInteraction_original(interaction) = handleInteraction_fixed(interaction)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-scrolling interactions

**Test Plan**: Observe behavior on UNFIXED code first for card interactions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Card Collapse Preservation**: Observe that collapsing/expanding cards works correctly on unfixed code, then verify this continues after fix
2. **Parameter Edit Preservation**: Observe that editing object parameters (position, size, opacity) works correctly on unfixed code, then verify this continues after fix
3. **Delete Preservation**: Observe that deleting cards works correctly on unfixed code, then verify this continues after fix
4. **Z-Order Preservation**: Observe that z-order buttons (⬆/⬇) work correctly on unfixed code, then verify this continues after fix
5. **Add Object Preservation**: Observe that adding new objects creates cards correctly on unfixed code, then verify this continues after fix
6. **No Scrollbar When Not Needed**: Observe that when 1-2 cards fit in visible area, no scrollbar appears on unfixed code, then verify this continues after fix

### Unit Tests

- Test scrollbar activation with 5, 10, 15 object cards
- Test that all cards are accessible via scrolling
- Test edge case: 1-2 cards that fit in visible area (no scrollbar should appear)
- Test that card collapse/expand still works after fix
- Test that parameter editing still works after fix
- Test that z-order buttons still work after fix

### Property-Based Tests

- Generate random numbers of object cards (1-50) and verify scrollbar activates when total height exceeds visible area
- Generate random card configurations (collapsed/expanded) and verify scrolling works correctly
- Generate random user interactions (collapse, edit, delete, z-order) and verify behavior is preserved

### Integration Tests

- Test full workflow: open FX editor → switch to ОБЪЕКТЫ tab → add 10 objects → verify scrollbar appears → scroll to bottom → edit last card → verify changes apply
- Test tab switching: add objects → switch to ТЕКСТ tab → switch back to ОБЪЕКТЫ tab → verify scrollbar still works
- Test preview rendering: add objects → scroll through cards → verify preview canvas updates correctly
