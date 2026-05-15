# Preservation Property Tests - FX Editor Cards Scroll

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

**Property 2: Preservation - Card Interaction Behavior**

## Test Objective

This test verifies that card interaction behaviors remain unchanged after implementing the CSS fix. We follow the observation-first methodology: first observe and document behavior on UNFIXED code, then verify the same behavior persists after the fix.

**CRITICAL**: These tests are EXPECTED TO PASS on unfixed code. They document the baseline behavior that must be preserved.

## Test Environment

- Browser: Any modern browser (Chrome, Firefox, Edge)
- Application: Ricole Project (index.html)
- Required Tools: Browser DevTools (F12) for verification
- Test State: UNFIXED code (before implementing Task 3)

## Observation-First Methodology

For each test case below:
1. **Observe** the behavior on UNFIXED code
2. **Document** the exact behavior observed
3. **Verify** this behavior continues after the fix is implemented

---

## Test Case 1: Card Collapse/Expand Functionality

**Property**: For any card collapse/expand action, the card state changes correctly and the UI updates appropriately.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Add 3 overlay objects (images or text)

**Test Steps:**
1. Observe initial state: all cards are expanded (showing full controls)
2. Click the collapse button (▾) on the first card
3. Observe: card collapses, showing only header
4. Observe: collapse button changes to (▸)
5. Click the collapse button (▸) again
6. Observe: card expands, showing all controls
7. Observe: collapse button changes back to (▾)
8. Click anywhere in the card header (not on buttons/inputs)
9. Observe: card toggles collapse state
10. Repeat for all 3 cards

**Expected Behavior (Baseline to Preserve):**
- ✓ Clicking collapse button (▾) collapses the card
- ✓ Collapsed card shows only header (no body controls)
- ✓ Collapse button changes to (▸) when collapsed
- ✓ Clicking collapse button (▸) expands the card
- ✓ Expanded card shows all controls (sliders, inputs, buttons)
- ✓ Collapse button changes to (▾) when expanded
- ✓ Clicking card header (empty area) toggles collapse state
- ✓ Collapse state is independent for each card
- ✓ UI updates immediately without page refresh

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

Card 1 collapse/expand: [ ] PASS [ ] FAIL
Card 2 collapse/expand: [ ] PASS [ ] FAIL
Card 3 collapse/expand: [ ] PASS [ ] FAIL
Header click toggle:    [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 2: Parameter Editing - Position, Size, Opacity

**Property**: For any parameter edit (position, size, opacity), the preview canvas updates correctly and values persist.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Add 1 overlay object (image)
5. Ensure card is expanded

**Test Steps - Position:**
1. Locate the "X" slider (horizontal position)
2. Note initial value (e.g., 50)
3. Drag slider to a different value (e.g., 70)
4. Observe: preview canvas updates immediately
5. Observe: object moves horizontally on canvas
6. Observe: slider value display updates
7. Repeat for "Y" slider (vertical position)

**Test Steps - Size:**
1. Locate the "Размер" (size) slider
2. Note initial value (e.g., 100)
3. Drag slider to increase size (e.g., 150)
4. Observe: preview canvas updates immediately
5. Observe: object scales larger on canvas
6. Drag slider to decrease size (e.g., 50)
7. Observe: object scales smaller on canvas

**Test Steps - Opacity:**
1. Locate the "Прозрачность" (opacity) slider
2. Note initial value (e.g., 100)
3. Drag slider to decrease opacity (e.g., 50)
4. Observe: preview canvas updates immediately
5. Observe: object becomes semi-transparent on canvas
6. Drag slider to 0
7. Observe: object becomes invisible on canvas

**Expected Behavior (Baseline to Preserve):**
- ✓ X slider changes horizontal position immediately
- ✓ Y slider changes vertical position immediately
- ✓ Size slider scales object proportionally
- ✓ Opacity slider changes transparency (0 = invisible, 100 = opaque)
- ✓ Preview canvas updates in real-time (no lag)
- ✓ Slider value display shows current value
- ✓ Changes persist when collapsing/expanding card
- ✓ Changes persist when switching tabs

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

X position slider:      [ ] PASS [ ] FAIL
Y position slider:      [ ] PASS [ ] FAIL
Size slider:            [ ] PASS [ ] FAIL
Opacity slider:         [ ] PASS [ ] FAIL
Real-time preview:      [ ] PASS [ ] FAIL
Value persistence:      [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 3: Parameter Editing - Effects and Layer

**Property**: For any effect or layer parameter edit, the preview canvas updates correctly.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Add 1 overlay object (image)
5. Ensure card is expanded

**Test Steps - Effect:**
1. Locate the "Эффект" (effect) dropdown
2. Note initial value (likely "Статика" / static)
3. Change to "Покачивание" (sway)
4. Observe: preview canvas shows swaying animation
5. Change to "Пульс (бас)" (pulse)
6. Observe: preview canvas shows pulsing animation
7. Change to "Вращение" (spin)
8. Observe: preview canvas shows spinning animation
9. Change back to "Статика" (static)
10. Observe: animation stops

**Test Steps - Layer:**
1. Locate the "Слой" (layer) dropdown
2. Note initial value (likely "Поверх текста" / above)
3. Change to "Под текстом" (below)
4. Observe: layer order changes in preview
5. Change back to "Поверх текста" (above)
6. Observe: layer order reverts

**Expected Behavior (Baseline to Preserve):**
- ✓ Effect dropdown changes animation immediately
- ✓ "Статика" = no animation
- ✓ "Покачивание" = swaying motion
- ✓ "Пульс (бас)" = pulsing with bass
- ✓ "Вращение" = spinning rotation
- ✓ Other effects work as expected
- ✓ Layer dropdown changes z-order relative to text
- ✓ "Поверх текста" = object above text layer
- ✓ "Под текстом" = object below text layer
- ✓ Preview canvas updates immediately

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

Effect dropdown:        [ ] PASS [ ] FAIL
Static effect:          [ ] PASS [ ] FAIL
Sway effect:            [ ] PASS [ ] FAIL
Pulse effect:           [ ] PASS [ ] FAIL
Spin effect:            [ ] PASS [ ] FAIL
Layer dropdown:         [ ] PASS [ ] FAIL
Above text layer:       [ ] PASS [ ] FAIL
Below text layer:       [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 4: Card Deletion

**Property**: For any delete action, the card is removed from the list and the preview canvas updates correctly.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Add 5 overlay objects (images or text)
5. Note the total number of cards: 5

**Test Steps:**
1. Locate the "✕ удалить" (delete) button on the first card
2. Click the delete button
3. Observe: card is removed from the list immediately
4. Observe: remaining cards re-render (4 cards now)
5. Observe: preview canvas updates (deleted object disappears)
6. Observe: z-order badges update (z1, z2, z3, z4)
7. Delete the middle card (card 2 of 4)
8. Observe: card is removed, 3 cards remain
9. Delete the last card (bottom card)
10. Observe: card is removed, 2 cards remain
11. Delete all remaining cards one by one
12. Observe: list becomes empty, no cards displayed

**Expected Behavior (Baseline to Preserve):**
- ✓ Clicking "✕ удалить" removes the card immediately
- ✓ Card disappears from the list
- ✓ Object disappears from preview canvas
- ✓ Remaining cards re-render with updated z-order badges
- ✓ No errors in browser console
- ✓ Can delete any card (top, middle, bottom)
- ✓ Can delete all cards until list is empty
- ✓ Collapsed state is cleared for deleted card

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

Delete first card:      [ ] PASS [ ] FAIL
Delete middle card:     [ ] PASS [ ] FAIL
Delete last card:       [ ] PASS [ ] FAIL
Preview updates:        [ ] PASS [ ] FAIL
Z-order updates:        [ ] PASS [ ] FAIL
Delete all cards:       [ ] PASS [ ] FAIL
No console errors:      [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 5: Z-Order Buttons (⬆/⬇)

**Property**: For any z-order change, the card position in the list updates correctly and the preview canvas reflects the new layer order.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Add 3 overlay objects (images with different colors/content for easy identification)
5. Note initial order: Card A (z3, top), Card B (z2, middle), Card C (z1, bottom)

**Test Steps - Move Up (▲):**
1. Locate Card C (z1, bottom card)
2. Click the "▲" (up arrow) button
3. Observe: Card C moves up one position in the list
4. Observe: Card C now shows z2 badge
5. Observe: Card B now shows z1 badge
6. Observe: Preview canvas shows Card C now above Card B
7. Click "▲" on Card C again
8. Observe: Card C moves to top position (z3)
9. Observe: "▲" button becomes disabled (already at top)

**Test Steps - Move Down (▼):**
1. Locate Card C (now at top, z3)
2. Click the "▼" (down arrow) button
3. Observe: Card C moves down one position in the list
4. Observe: Card C now shows z2 badge
5. Observe: Card A now shows z3 badge
6. Observe: Preview canvas shows Card A now above Card C
7. Continue clicking "▼" until Card C reaches bottom
8. Observe: "▼" button becomes disabled (already at bottom)

**Test Steps - Edge Cases:**
1. Verify top card has "▲" button disabled
2. Verify bottom card has "▼" button disabled
3. Move middle card up and down multiple times
4. Verify z-order badges always reflect correct position

**Expected Behavior (Baseline to Preserve):**
- ✓ "▲" button moves card up one position (forward in z-order)
- ✓ "▼" button moves card down one position (backward in z-order)
- ✓ Z-order badges update immediately (z1, z2, z3, etc.)
- ✓ Card list re-renders with new order
- ✓ Preview canvas updates layer order immediately
- ✓ Top card has "▲" button disabled
- ✓ Bottom card has "▼" button disabled
- ✓ Middle cards have both buttons enabled
- ✓ Can move card from bottom to top and vice versa

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

Move up (▲):            [ ] PASS [ ] FAIL
Move down (▼):          [ ] PASS [ ] FAIL
Z-order badges update:  [ ] PASS [ ] FAIL
List re-renders:        [ ] PASS [ ] FAIL
Preview updates:        [ ] PASS [ ] FAIL
Top button disabled:    [ ] PASS [ ] FAIL
Bottom button disabled: [ ] PASS [ ] FAIL
Multiple moves:         [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 6: Adding New Objects

**Property**: For any add object action, a new card appears in the list and the preview canvas displays the new object.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Ensure list is empty or has few cards

**Test Steps - Add Image Object:**
1. Click "+ Добавить объект" button
2. Select an image file from file picker
3. Observe: new card appears at TOP of list (z1 position)
4. Observe: card shows thumbnail of selected image
5. Observe: card shows filename
6. Observe: card is expanded by default
7. Observe: preview canvas shows the new object
8. Add another image object
9. Observe: new card appears at TOP, previous card moves down
10. Observe: z-order badges update (new = z2, previous = z1)

**Test Steps - Add Text Object:**
1. Click "+ Добавить текст" button (if available)
2. Observe: new card appears at TOP of list
3. Observe: card shows "T" icon instead of thumbnail
4. Observe: card shows "(пусто)" or empty text placeholder
5. Observe: card is expanded by default
6. Observe: card has textarea for text input
7. Type some text in the textarea
8. Observe: card name updates to show text preview
9. Observe: preview canvas shows the text overlay

**Test Steps - Multiple Additions:**
1. Add 5 objects in sequence (mix of images and text)
2. Observe: each new card appears at top
3. Observe: previous cards shift down
4. Observe: z-order badges update correctly (z5, z4, z3, z2, z1)
5. Observe: all objects appear on preview canvas

**Expected Behavior (Baseline to Preserve):**
- ✓ "+ Добавить объект" button opens file picker
- ✓ Selecting image creates new card at top of list
- ✓ New card shows thumbnail and filename
- ✓ New card is expanded by default
- ✓ New object appears on preview canvas
- ✓ "+ Добавить текст" button creates text card (if available)
- ✓ Text card shows "T" icon
- ✓ Text card has textarea for input
- ✓ Typing text updates card name and preview
- ✓ Each new card gets highest z-order (top position)
- ✓ Previous cards shift down in z-order
- ✓ Z-order badges update correctly

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

Add image object:       [ ] PASS [ ] FAIL
Image thumbnail:        [ ] PASS [ ] FAIL
Image on canvas:        [ ] PASS [ ] FAIL
Add text object:        [ ] PASS [ ] FAIL
Text icon display:      [ ] PASS [ ] FAIL
Text input works:       [ ] PASS [ ] FAIL
Text on canvas:         [ ] PASS [ ] FAIL
New card at top:        [ ] PASS [ ] FAIL
Z-order updates:        [ ] PASS [ ] FAIL
Multiple additions:     [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 7: No Scrollbar When Cards Fit in Visible Area

**Property**: When 1-2 cards fit in the visible area without overflow, no scrollbar should appear.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Ensure list is empty

**Test Steps - 1 Card:**
1. Add 1 overlay object (image)
2. Ensure card is expanded
3. Observe the `.fxe-ov-list` container
4. Check for scrollbar presence
5. Open DevTools (F12)
6. Inspect `.fxe-ov-list` element
7. Check computed `overflow-y` property
8. Measure container height vs content height

**Test Steps - 2 Cards:**
1. Add a second overlay object
2. Ensure both cards are expanded
3. Observe the `.fxe-ov-list` container
4. Check for scrollbar presence
5. Measure container height vs content height

**Test Steps - 1 Card Collapsed:**
1. Remove second card (only 1 card remains)
2. Collapse the card
3. Observe: no scrollbar should appear
4. Expand the card
5. Observe: still no scrollbar (card fits in visible area)

**Expected Behavior (Baseline to Preserve):**
- ✓ 1 expanded card: no scrollbar appears
- ✓ 2 expanded cards: no scrollbar appears (if they fit)
- ✓ 1 collapsed card: no scrollbar appears
- ✓ Container height is sufficient for content
- ✓ No unnecessary whitespace or overflow
- ✓ `overflow-y: auto` is set but not triggered

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

1 card, no scrollbar:   [ ] PASS [ ] FAIL
2 cards, no scrollbar:  [ ] PASS [ ] FAIL (if they fit)
1 collapsed, no scroll: [ ] PASS [ ] FAIL
Container height OK:    [ ] PASS [ ] FAIL

Container height: _______ px
Content height:   _______ px
Scrollbar visible: [ ] YES [ ] NO

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 8: Tab Switching Preserves Card State

**Property**: When switching between "ТЕКСТ" and "ОБЪЕКТЫ" tabs, card states (collapsed/expanded) are preserved.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Add 3 overlay objects

**Test Steps:**
1. Expand all 3 cards (if not already expanded)
2. Collapse Card 1 (top card)
3. Collapse Card 3 (bottom card)
4. Leave Card 2 (middle card) expanded
5. Note the state: Card 1 collapsed, Card 2 expanded, Card 3 collapsed
6. Switch to "ТЕКСТ" tab
7. Observe: text editor appears
8. Switch back to "ОБЪЕКТЫ" tab
9. Observe: Card 1 is still collapsed
10. Observe: Card 2 is still expanded
11. Observe: Card 3 is still collapsed
12. Repeat tab switching multiple times
13. Verify state persists across all switches

**Expected Behavior (Baseline to Preserve):**
- ✓ Collapsed cards remain collapsed after tab switch
- ✓ Expanded cards remain expanded after tab switch
- ✓ Card state persists across multiple tab switches
- ✓ No cards reset to default state
- ✓ Z-order remains unchanged
- ✓ Parameter values remain unchanged
- ✓ Preview canvas state persists

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

Collapsed state persists: [ ] PASS [ ] FAIL
Expanded state persists:  [ ] PASS [ ] FAIL
Multiple switches OK:     [ ] PASS [ ] FAIL
Z-order unchanged:        [ ] PASS [ ] FAIL
Parameters unchanged:     [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Test Case 9: Enable/Disable Toggle

**Property**: For any enable/disable toggle action, the object visibility on canvas updates correctly.

### Test Procedure (UNFIXED Code)

**Setup:**
1. Open `index.html` in a browser
2. Open the FX Editor
3. Click on the "ОБЪЕКТЫ" tab
4. Add 2 overlay objects (images with distinct appearance)

**Test Steps:**
1. Observe both objects are visible on preview canvas
2. Observe both cards show "ВКЛ" (enabled) button in green/active state
3. Click "ВКЛ" button on Card 1
4. Observe: button changes to "ВЫКЛ" (disabled)
5. Observe: button style changes (no longer active/green)
6. Observe: Card 1 gets "disabled" class (may appear dimmed)
7. Observe: Object 1 disappears from preview canvas
8. Observe: Object 2 remains visible on preview canvas
9. Click "ВЫКЛ" button on Card 1 again
10. Observe: button changes back to "ВКЛ"
11. Observe: Object 1 reappears on preview canvas
12. Disable both objects
13. Observe: preview canvas shows no overlay objects
14. Enable both objects
15. Observe: both objects reappear on preview canvas

**Expected Behavior (Baseline to Preserve):**
- ✓ "ВКЛ" button shows object is enabled (visible)
- ✓ "ВЫКЛ" button shows object is disabled (hidden)
- ✓ Clicking "ВКЛ" disables object (hides from canvas)
- ✓ Clicking "ВЫКЛ" enables object (shows on canvas)
- ✓ Button style changes to reflect state
- ✓ Card may get "disabled" class when disabled
- ✓ Preview canvas updates immediately
- ✓ Can disable/enable any card independently
- ✓ Can disable all cards (canvas shows no overlays)
- ✓ Can re-enable all cards (canvas shows all overlays)

**Observed Behavior (Document on UNFIXED Code):**
```
Date: ___________
Browser: ___________

Enable button works:    [ ] PASS [ ] FAIL
Disable button works:   [ ] PASS [ ] FAIL
Button style changes:   [ ] PASS [ ] FAIL
Card style changes:     [ ] PASS [ ] FAIL
Canvas updates:         [ ] PASS [ ] FAIL
Independent toggle:     [ ] PASS [ ] FAIL
Disable all works:      [ ] PASS [ ] FAIL
Enable all works:       [ ] PASS [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
```

**Verification After Fix:**
- [ ] Re-run this test after implementing Task 3
- [ ] Confirm all behaviors remain identical
- [ ] Mark PASS if behavior unchanged, FAIL if any regression

---

## Summary Checklist

### Baseline Observation (UNFIXED Code)

Complete all test cases above on UNFIXED code and document observed behavior:

- [ ] Test Case 1: Card Collapse/Expand - OBSERVED
- [ ] Test Case 2: Parameter Editing (Position, Size, Opacity) - OBSERVED
- [ ] Test Case 3: Parameter Editing (Effects, Layer) - OBSERVED
- [ ] Test Case 4: Card Deletion - OBSERVED
- [ ] Test Case 5: Z-Order Buttons - OBSERVED
- [ ] Test Case 6: Adding New Objects - OBSERVED
- [ ] Test Case 7: No Scrollbar When Cards Fit - OBSERVED
- [ ] Test Case 8: Tab Switching Preserves State - OBSERVED
- [ ] Test Case 9: Enable/Disable Toggle - OBSERVED

### Expected Outcome (UNFIXED Code)

**ALL TESTS SHOULD PASS** - These tests document the baseline behavior that must be preserved. If any test fails on unfixed code, it indicates a pre-existing bug unrelated to the scrolling issue.

### Post-Fix Verification (After Task 3)

After implementing the CSS fix in Task 3, re-run all test cases:

- [ ] Test Case 1: Card Collapse/Expand - VERIFIED
- [ ] Test Case 2: Parameter Editing (Position, Size, Opacity) - VERIFIED
- [ ] Test Case 3: Parameter Editing (Effects, Layer) - VERIFIED
- [ ] Test Case 4: Card Deletion - VERIFIED
- [ ] Test Case 5: Z-Order Buttons - VERIFIED
- [ ] Test Case 6: Adding New Objects - VERIFIED
- [ ] Test Case 7: No Scrollbar When Cards Fit - VERIFIED
- [ ] Test Case 8: Tab Switching Preserves State - VERIFIED
- [ ] Test Case 9: Enable/Disable Toggle - VERIFIED

### Expected Outcome (FIXED Code)

**ALL TESTS SHOULD STILL PASS** - If any test fails after the fix, it indicates a regression. The fix should ONLY affect scrollbar activation when cards overflow, not any other card interaction behavior.

---

## Property-Based Testing Approach

While this document provides manual test procedures, the underlying properties can be expressed formally for automated property-based testing:

### Property 1: Collapse State Consistency
```
∀ card ∈ cards, ∀ action ∈ {collapse, expand}:
  applyAction(card, action) ⟹ 
    card.isCollapsed = (action === 'collapse') ∧
    card.collapseButton.text = (action === 'collapse' ? '▸' : '▾')
```

### Property 2: Parameter Update Consistency
```
∀ card ∈ cards, ∀ param ∈ {x, y, size, opacity, effect, layer}:
  updateParameter(card, param, newValue) ⟹
    card.param = newValue ∧
    previewCanvas.reflects(card.param)
```

### Property 3: Deletion Consistency
```
∀ card ∈ cards:
  deleteCard(card) ⟹
    card ∉ cards ∧
    card.object ∉ previewCanvas ∧
    ∀ remainingCard ∈ cards: remainingCard.zOrder.isCorrect()
```

### Property 4: Z-Order Consistency
```
∀ card ∈ cards, ∀ direction ∈ {up, down}:
  moveCard(card, direction) ⟹
    card.zOrder = card.zOrder ± 1 ∧
    adjacentCard.zOrder = adjacentCard.zOrder ∓ 1 ∧
    previewCanvas.layerOrder.reflects(cards.zOrder)
```

### Property 5: Addition Consistency
```
∀ newObject ∈ {image, text}:
  addObject(newObject) ⟹
    newCard ∈ cards ∧
    newCard.zOrder = max(cards.zOrder) + 1 ∧
    newCard.isExpanded = true ∧
    newObject ∈ previewCanvas
```

### Property 6: No Scrollbar When Content Fits
```
∀ cards WHERE totalHeight(cards) ≤ visibleAreaHeight:
  scrollbar.visible = false
```

### Property 7: State Persistence Across Tab Switches
```
∀ card ∈ cards, ∀ state ∈ {collapsed, expanded, parameters}:
  switchTab('ТЕКСТ') ⟹ switchTab('ОБЪЕКТЫ') ⟹
    card.state = card.state_before_switch
```

### Property 8: Enable/Disable Consistency
```
∀ card ∈ cards:
  toggleEnabled(card) ⟹
    card.enabled = ¬card.enabled ∧
    card.object.visibleOnCanvas = card.enabled
```

---

## Notes

- This test document serves as the preservation property test for Task 2
- All tests are designed to PASS on unfixed code (baseline behavior)
- After implementing the fix in Task 3, re-run all tests to verify no regressions
- The fix should ONLY affect scrollbar activation, not any other functionality
- If any test fails after the fix, investigate and correct the regression before proceeding

---

**Requirements Validated**: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

**Task Status**: Ready for baseline observation on UNFIXED code
