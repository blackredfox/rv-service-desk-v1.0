-- AlterTable: Add inputLanguage, languageSource to Case; add language to Message
-- These fields were already used by storage.ts but missing from the schema.

-- Case: inputLanguage (Language enum, default EN)
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "inputLanguage" "Language" NOT NULL DEFAULT 'EN';

-- Case: languageSource (LanguageSource enum, default AUTO)
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "languageSource" "LanguageSource" NOT NULL DEFAULT 'AUTO';

-- Case: language default (was required without default)
ALTER TABLE "Case" ALTER COLUMN "language" SET DEFAULT 'EN';

-- Message: language (Language enum, nullable)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "language" "Language";
