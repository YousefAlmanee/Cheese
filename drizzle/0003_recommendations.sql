CREATE TABLE "recommendation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user" text NOT NULL,
	"to_user" text NOT NULL,
	"item_id" uuid NOT NULL,
	"note" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_not_self" CHECK ("recommendation"."from_user" <> "recommendation"."to_user")
);
--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_from_user_user_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_to_user_user_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_pair_item_uq" ON "recommendation" USING btree ("from_user","to_user","item_id");--> statement-breakpoint
CREATE INDEX "recommendation_to_idx" ON "recommendation" USING btree ("to_user","created_at");