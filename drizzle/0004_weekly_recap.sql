ALTER TABLE "profile" ADD COLUMN "recap_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "last_recap_at" timestamp with time zone;