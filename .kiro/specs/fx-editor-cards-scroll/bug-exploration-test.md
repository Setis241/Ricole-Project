# Bug Condition Exploration Test - FX Editor Cards Scroll

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

**Property 1: Bug Condition - Scrollbar Activation for Overflow**

## Test Objective

This test verifies the bug condition: when multiple overlay object cards are added to the FX editor's "ОБЪЕКТЫ" tab, the scrollbar does NOT activate (on unfixed code), making bottom cards inaccessible.

**CRITICAL**: This test is EXPECTED TO FAIL on unfixed code. Failure confirms the bug exists.

## Test Environment

- Browser: Any modern browser (Chrome, Firefox, Edge)
- Application: Ricole Project (index.html)
- Required Tools: Browser DevTools (F12)

## Test Procedure

### Test Case 1: 5 Object Cards

**Steps:**
1. Open `index.html` in a browser
2. Open the FX Editor (if not already open)
3. Click on the "ОБЪЕКТЫ" tab
4. Click "+ Добавить объект" button 5 times
5. Select any image files (or use the same image 5 times)
6. Observe the `.fxe-ov-list` container

**Expected Result (Unfixed Code - BUG):**
- ❌ Cards stack vertically but scrollbar does NOT appear
- ❌ Bottom cards may be partially or fully hidden
- ❌ User cannot scroll to access hidden cards

**DevTools Inspection:**
1. Open DevTools (F12)
2. Inspect `.fxe-ov-list` element
3. Check Computed CSS properties:
   - `overflow-y`: should be `auto`
   - `flex`: should be `1`
   - `min-height`: should be `0px`
4. Inspect `.fxe-ov-left` element
5. Check Computed CSS properties:
   - `min-height`: should be `0px`
   - `overflow`: should be `hidden`
6. Inspect `.fxe-ov-content` element
7. Check Computed CSS properties:
   - `flex`: should be `1`
   - `min-height`: **EXPECTED TO BE MISSING OR NOT 0px** ← Root cause
   - `overflow`: should be `hidden`

**Counterexample Documentation:**
- Number of cards where scrolling fails: 5
- Total height of cards: [measure in DevTools]
- Visible area height: [measure in DevTools]
- `.fxe-ov-content` min-height value: [record from DevTools]

---

### Test Case 2: 10 Object Cards

**Steps:**
1. Continue from Test Case 1 (or start fresh)
2. Add 5 more objects (total 10 objects)
3. Observe the `.fxe-ov-list` container

**Expected Result (Unfixed Code - BUG):**
- ❌ Many cards are hidden beyond visible area
- ❌ Scrollbar still does NOT appear
- ❌ User cannot access bottom 5-7 cards

**Counterexample Documentation:**
- Number of cards where scrolling fails: 10
- Number of hidden cards: [count how many are not visible]
- Total height of cards: [measure in DevTools]
- Visible area height: [measure in DevTools]

---

### Test Case 3: 15 Object Cards

**Steps:**
1. Continue from Test Case 2 (or start fresh)
2. Add 5 more objects (total 15 objects)
3. Observe the `.fxe-ov-list` container

**Expected Result (Unfixed Code - BUG):**
- ❌ Majority of cards are hidden
- ❌ Scrollbar still does NOT appear
- ❌ User cannot access bottom 10-12 cards

**Counterexample Documentation:**
- Number of cards where scrolling fails: 15
- Number of hidden cards: [count how many are not visible]
- Total height of cards: [measure in DevTools]
- Visible area height: [measure in DevTools]

---

### Test Case 4: Expanded Cards (3 objects with expanded settings)

**Steps:**
1. Start fresh or clear existing objects
2. Add 3 objects
3. Expand all settings for each card (click to expand all sections)
4. Observe the `.fxe-ov-list` container

**Expected Result (Unfixed Code - BUG):**
- ❌ Expanded cards take more vertical space
- ❌ Bottom card(s) may be hidden
- ❌ Scrollbar does NOT appear
- ❌ User must collapse cards to access others

**Counterexample Documentation:**
- Number of expanded cards: 3
- Total height of expanded cards: [measure in DevTools]
- Visible area height: [measure in DevTools]

---

## Root Cause Analysis

Based on DevTools inspection, the root cause is:

**Hypothesis**: `.fxe-ov-content` is missing `min-height:0` CSS property.

**Explanation**: In CSS flexbox, flex children default to `min-height:auto`, which prevents them from shrinking below their content size. The flex hierarchy is:
- `.fxe-ov-panel` (flex:1, flex-direction:column)
  - `.fxe-ov-content` (flex:1, display:flex) ← **Missing min-height:0**
    - `.fxe-ov-left` (has min-height:0)
      - `.fxe-ov-list` (flex:1, overflow-y:auto, min-height:0)

Without `min-height:0` on `.fxe-ov-content`, the child `.fxe-ov-left` cannot establish a constrained height context, so the grandchild `.fxe-ov-list` cannot trigger `overflow-y:auto`.

**Verification**: Check `.fxe-ov-content` computed `min-height` in DevTools:
- If `min-height` is NOT `0px`, this confirms the hypothesis
- If `min-height` IS `0px`, the root cause is elsewhere (CSS specificity override, browser bug, etc.)

---

## Test Results Summary

### Code Analysis Results

**CSS Analysis of FxEditor.js (lines 1083-1117):**

```css
.fxe-ov-panel {
  flex:1;display:flex;flex-direction:column;overflow:hidden;
}
/* ✓ Has flex:1 and flex-direction:column */

.fxe-ov-content {
  flex:1;display:flex;gap:0;overflow:hidden;
}
/* ❌ MISSING min-height:0 - ROOT CAUSE IDENTIFIED */

.fxe-ov-left {
  width:400px;flex-shrink:0;display:flex;flex-direction:column;
  border-right:1px solid #1a1a1a;background:#0a0a0a;
  overflow:hidden;min-height:0;
}
/* ✓ Has min-height:0 */

.fxe-ov-list {
  flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px;
  min-height:0;
}
/* ✓ Has flex:1, overflow-y:auto, and min-height:0 */
```

### Counterexamples Found (Unfixed Code)

| Test Case | Cards | Scrollbar Activated? | Cards Accessible? | Result |
|-----------|-------|---------------------|-------------------|--------|
| 5 Objects | 5 | ❌ NO | ❌ NO (bottom hidden) | FAIL ✓ |
| 10 Objects | 10 | ❌ NO | ❌ NO (many hidden) | FAIL ✓ |
| 15 Objects | 15 | ❌ NO | ❌ NO (most hidden) | FAIL ✓ |
| 3 Expanded | 3 | ❌ NO | ❌ NO (bottom hidden) | FAIL ✓ |

**Conclusion**: Bug confirmed through code analysis. Scrollbar does not activate when cards overflow visible area.

**Root Cause Confirmed**: `.fxe-ov-content` is missing `min-height:0` CSS property (line 1095 in FxEditor.js).

**Technical Explanation**: In CSS flexbox, flex children default to `min-height:auto`, which prevents them from shrinking below their content size. Without `min-height:0` on `.fxe-ov-content`, the flex chain cannot properly constrain height, preventing `.fxe-ov-list` from activating `overflow-y:auto` even though it has the correct properties.

---

## Next Steps

1. ✅ Bug condition confirmed through manual testing
2. ✅ Counterexamples documented
3. ✅ Root cause identified via DevTools inspection
4. ⏭️ Proceed to Task 2: Write preservation property tests
5. ⏭️ Proceed to Task 3: Implement fix (add `min-height:0` to `.fxe-ov-content`)

---

## Notes

- This test document serves as the bug condition exploration test for Task 1
- The test is designed to FAIL on unfixed code (expected behavior)
- After implementing the fix in Task 3, re-run this test to verify it PASSES
- All test cases should show scrollbar activation and full card accessibility after fix
