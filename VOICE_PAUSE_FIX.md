# Voice Pause Fix - Word Boundary Awareness

## Problem
ElevenLabs was inserting `[voice pause]` markers mid-word (e.g., "co-creation [voice pause] itself", "doub[voice pause]ting") because the TTS sentence detection logic was splitting text at fixed character positions without respecting word boundaries.

## Root Cause
In `hooks/use-canvas-llm.ts`, the fallback strategy for long text without punctuation was:
```typescript
// OLD: Split at exactly 120 characters, even mid-word
if (remaining.length > 120) {
  onSentenceReady(remaining);  // ← Could split "doubting" as "doub" + "ting"
  currentIndex = text.length;
}
```

## Solution Applied
Added word-boundary-aware chunking:

1. **Helper function** (`findLastWordBoundary`): Finds the last whitespace before a given character position
2. **Updated fallback #1**: Now splits at word boundaries instead of fixed positions
3. **Increased thresholds**: 120 → 150 chars, 40 → 50 chars (reduces fallback frequency)

```typescript
// NEW: Split at last word boundary before 150 characters
if (remaining.length > 150) {
  const splitPoint = findLastWordBoundary(remaining, 150);
  const chunk = remaining.slice(0, splitPoint).trim();
  if (chunk.length > 10) {
    onSentenceReady(chunk);  // ← Always splits at complete words
    currentIndex += splitPoint;
  }
}
```

## Benefits
- ✅ No more mid-word pauses
- ✅ Natural speech continuity preserved
- ✅ Fast streaming still works (only 1-2 words of delay vs. character-based)
- ✅ Fallback strategies still handle edge cases (long unpunctuated text)

## Testing
Test with canvas queries that produce:
1. Long responses without punctuation (tests fallback #1)
2. Normal punctuated responses (tests primary sentence detection)
3. Mixed content with various structures

Listen for:
- No `[voice pause]` mid-word
- Natural pauses only at word boundaries
- Consistent voice quality across segments

## Implementation Date
2025-10-12

## File Modified
- `/hooks/use-canvas-llm.ts` (lines 161-206)
