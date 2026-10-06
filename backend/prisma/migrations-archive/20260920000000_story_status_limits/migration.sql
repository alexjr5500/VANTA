-- Story/Status 2026 rebirth.
-- 1. TEXT (Status) stories carry a JSON styling payload so the viewer can render
--    the premium text canvas (font, size, color, alignment, background) exactly
--    as the creator designed it. Existing rows stay NULL (= classic rendering).
ALTER TABLE "Story" ADD COLUMN "textStyle" TEXT;