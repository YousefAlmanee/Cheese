CREATE TABLE "group_swipe" (
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"liked" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_swipe_group_id_user_id_item_id_pk" PRIMARY KEY("group_id","user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "group_swipe" ADD CONSTRAINT "group_swipe_group_id_friend_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."friend_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_swipe" ADD CONSTRAINT "group_swipe_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_swipe" ADD CONSTRAINT "group_swipe_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_swipe_group_item_idx" ON "group_swipe" USING btree ("group_id","item_id");