CREATE INDEX "friend_group_owner_idx" ON "friend_group" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "night_host_idx" ON "night" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "night_item_idx" ON "night" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "night_vote_participant_idx" ON "night_vote" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "plan_session_due_idx" ON "plan_session" USING btree ("starts_at") WHERE "plan_session"."done" = false and "plan_session"."reminded_at" is null;--> statement-breakpoint
CREATE INDEX "progress_log_entry_idx" ON "progress_log" USING btree ("entry_id");